// 开发者工作台的共用认证工具（以 _ 开头的目录不会被 Vercel 当成独立接口部署）
const crypto = require('crypto');

const COOKIE_NAME = 'uec_dev_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const MIN_SECRET_LENGTH = 16;

// 环境变量从 Vercel 后台粘贴进来时，常常会带上看不见的换行、首尾空格或 BOM，
// 导致「明明填对了却登录不了」。这里统一清洗，避免这种极难自查的坑。
function cleanEnv(name) {
  return String(process.env[name] || '')
    .replace(/^﻿/, '')
    .replace(/[\r\n]+/g, '')
    .trim();
}

function authConfig() {
  const username = cleanEnv('DEV_USERNAME');
  const password = cleanEnv('DEV_PASSWORD');
  const secret = cleanEnv('DEV_SESSION_SECRET');
  return {
    username,
    password,
    secret,
    ready: Boolean(username && password && secret.length >= MIN_SECRET_LENGTH),
  };
}

// 只回报「有没有、够不够长」，永远不回传变量的内容本身。
// 供登录页在「尚未配置」时给出精确的自查清单。
function setupStatus() {
  const cfg = authConfig();
  return {
    DEV_USERNAME: cfg.username ? 'ok' : 'missing',
    DEV_PASSWORD: cfg.password ? 'ok' : 'missing',
    DEV_SESSION_SECRET: !cfg.secret ? 'missing' : (cfg.secret.length >= MIN_SECRET_LENGTH ? 'ok' : 'short'),
    minSecretLength: MIN_SECRET_LENGTH,
  };
}

function publishingConfig() {
  return {
    token: cleanEnv('GITHUB_TOKEN'),
    repo: cleanEnv('GITHUB_REPO') || 'K316-M/Science_Subjects_Question',
    branch: cleanEnv('GITHUB_BRANCH') || 'main',
  };
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  Object.entries(extraHeaders).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}

async function readJsonBody(req) {
  // Vercel 会预先解析 req.body；本地 Node 服务器则需要自己读流
  try {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
      if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
      return req.body;
    }
  } catch (e) {
    return {};
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) return {};
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch (e) {
    return {};
  }
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const key = part.slice(0, i).trim();
    const val = part.slice(i + 1).trim();
    if (!key) return;
    try {
      out[key] = decodeURIComponent(val);
    } catch (e) {
      out[key] = val;
    }
  });
  return out;
}

// 先各自哈希成等长再比较，避免字符串长度差异带来的时序泄漏
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// 签名密钥混入密码的哈希：改密码后，所有旧的登录会话自动失效
function signingKey(cfg) {
  const pwHash = crypto.createHash('sha256').update(cfg.password).digest('hex');
  return `${cfg.secret}|${pwHash}`;
}

function sign(payload, cfg) {
  return crypto.createHmac('sha256', signingKey(cfg)).update(payload).digest('base64url');
}

function createSessionToken(cfg) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${Buffer.from(cfg.username, 'utf8').toString('base64url')}.${exp}`;
  return `${payload}.${sign(payload, cfg)}`;
}

function verifySession(req) {
  const cfg = authConfig();
  if (!cfg.ready) return null;
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userB64, expStr, sig] = parts;
  if (!safeEqual(sig, sign(`${userB64}.${expStr}`, cfg))) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return null;
  const username = Buffer.from(userB64, 'base64url').toString('utf8');
  if (username !== cfg.username) return null;
  return { username, exp };
}

function isLocalRequest(req) {
  const host = String(req.headers.host || '').split(':')[0];
  return host === 'localhost' || host === '127.0.0.1';
}

function sessionCookie(token, req) {
  const secure = isLocalRequest(req) ? '' : '; Secure';
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

function clearedSessionCookie(req) {
  const secure = isLocalRequest(req) ? '' : '; Secure';
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

// 会改动数据的请求必须来自本站页面（配合 SameSite=Strict 做多重 CSRF 防护）。
// 浏览器无法伪造 Origin 与 Sec-Fetch-Site，因此两者只要有一个说「跨站」就拒绝。
function sameOrigin(req) {
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;

  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const expected = req.headers['x-forwarded-host'] || req.headers.host;
    return new URL(origin).host === expected;
  } catch (e) {
    return false;
  }
}

/* ---------- 登录失败节流 ----------
   Serverless 实例随时会被回收、也可能同时存在多个，所以这只是「尽力而为」的
   减速带，不是严密的全局计数器；真正的防线仍然是够长够随机的密码。 */
const FAILED = new Map();
const LOCK_AFTER = 5;               // 同一来源连续失败 5 次
const LOCK_MS = 10 * 60 * 1000;     // 就锁 10 分钟
const WINDOW_MS = 15 * 60 * 1000;   // 失败计数 15 分钟内有效
const GLOBAL_BURST = 20;            // 全站 15 分钟内失败超过 20 次
const GLOBAL_EXTRA_DELAY_MS = 3000; // 所有登录一律再慢 3 秒
let globalFails = [];

function clientKey(req) {
  const edgeIp = req.headers['x-vercel-forwarded-for'];
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = edgeIp || fwd || (req.socket && req.socket.remoteAddress) || 'unknown';
  return String(raw).slice(0, 64);
}

function prune(now) {
  for (const [k, v] of FAILED) {
    if (v.expires <= now) FAILED.delete(k);
  }
  if (FAILED.size > 5000) FAILED.clear();
  globalFails = globalFails.filter(t => t > now - WINDOW_MS);
}

function loginGate(req) {
  const now = Date.now();
  prune(now);
  const rec = FAILED.get(clientKey(req));
  if (rec && rec.lockedUntil > now) {
    return { blocked: true, retryAfter: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  return { blocked: false, extraDelay: globalFails.length >= GLOBAL_BURST ? GLOBAL_EXTRA_DELAY_MS : 0 };
}

function noteLoginFailure(req) {
  const now = Date.now();
  const key = clientKey(req);
  const rec = FAILED.get(key) || { count: 0, lockedUntil: 0, expires: 0 };
  rec.count += 1;
  if (rec.count >= LOCK_AFTER) {
    rec.lockedUntil = now + LOCK_MS;
    rec.count = 0;
  }
  rec.expires = Math.max(now + WINDOW_MS, rec.lockedUntil);
  FAILED.set(key, rec);
  globalFails.push(now);
  prune(now);
}

function clearLoginFailures(req) {
  FAILED.delete(clientKey(req));
}

module.exports = {
  authConfig,
  setupStatus,
  publishingConfig,
  sendJson,
  readJsonBody,
  safeEqual,
  createSessionToken,
  verifySession,
  sessionCookie,
  clearedSessionCookie,
  sameOrigin,
  loginGate,
  noteLoginFailure,
  clearLoginFailures,
};
