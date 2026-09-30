// 网页推播（Web Push）：把一则讯息加密後交给学生装置的推播服务
// （Chrome、Android 走 Google，Firefox 走 Mozilla，iPhone／Mac 走 Apple，电脑版 Edge 走 Microsoft），
// 装置收到後由网站的 service worker（sw.js）跳出通知 —— 网站关着也收得到。
// 只用 Node 内建的 crypto，不装套件：加密照 RFC 8291（aes128gcm），伺服器身分照 RFC 8292（VAPID）。
const crypto = require('crypto');

const b64u = buf => Buffer.from(buf).toString('base64url');
const fromB64u = str => Buffer.from(String(str || ''), 'base64url');
const pad32 = buf => Buffer.concat([Buffer.alloc(Math.max(0, 32 - buf.length)), buf]);

// 只送到这几家推播服务：订阅资料是浏览器传来的，不设限的话，伺服器会替人去打任意网址
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com'];

// 浏览器 subscription.toJSON() 的格式：{ endpoint, keys: { p256dh, auth } }。不合格回 null
function cleanSubscription(raw) {
  if (!raw || typeof raw !== 'object' || !raw.keys || typeof raw.endpoint !== 'string' || raw.endpoint.length > 1024) return null;
  let url;
  try { url = new URL(raw.endpoint); } catch (e) { return null; }
  const host = url.hostname;
  if (url.protocol !== 'https:' || !(PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some(s => host.endsWith(s)))) return null;
  const p256dh = fromB64u(raw.keys.p256dh), auth = fromB64u(raw.keys.auth);
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
  return { endpoint: url.href, keys: { p256dh: b64u(p256dh), auth: b64u(auth) } };
}

// 伺服器身分（VAPID）：一组 P-256 钥匙。公钥给浏览器订阅时用，私钥签每一次推播
function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(pad32(ecdh.getPrivateKey())) };
}

// RFC 8292：用 ES256 签一张给这家推播服务的 JWT，12 小时内有效
function vapidHeader(endpoint, vapid, subject, now = Date.now()) {
  const pub = fromB64u(vapid.publicKey);
  const key = crypto.createPrivateKey({ format: 'jwk', key: {
    kty: 'EC', crv: 'P-256', d: vapid.privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)),
  } });
  const unsigned = `${b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${b64u(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject,
  }))}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${vapid.publicKey}`;
}

// RFC 8291：用装置的公钥（p256dh）和 auth 密钥，替这一则讯息推出专用的钥匙，AES-128-GCM 加密。
// salt 与 ecdh 平常随机产生；测试时传入 RFC 附录的固定值，结果要和附录一字不差
function encrypt(payload, keys, { salt = crypto.randomBytes(16), ecdh } = {}) {
  const uaPublic = fromB64u(keys.p256dh);
  const authSecret = fromB64u(keys.auth);
  if (!ecdh) { ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys(); }
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  // 整则讯息是一个记录：内容後面接 0x02（最後一个记录的分隔符号），不另外补白
  const sealed = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, sealed]);
}

// 送出一则推播，回传推播服务的 HTTP 状态码：201 成功；404／410 代表这个订阅已经失效（取消了通知、清了网站资料）
async function sendPush(subscription, data, vapid, { subject, ttl }) {
  const res = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      TTL: String(ttl),
      Urgency: 'high',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      Authorization: vapidHeader(subscription.endpoint, vapid, subject),
    },
    body: encrypt(JSON.stringify(data), subscription.keys),
  });
  return res.status;
}

module.exports = { cleanSubscription, generateVapidKeys, vapidHeader, encrypt, sendPush };
