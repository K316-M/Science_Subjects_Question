// 开发者工作台的共用认证工具（以 _ 开头的目录不会被 Vercel 当成独立接口部署）
const crypto = require('crypto');

const COOKIE_NAME = 'uec_dev_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;

function authConfig() {
  const username = process.env.DEV_USERNAME || '';
  const password = process.env.DEV_PASSWORD || '';
  const secret = process.env.DEV_SESSION_SECRET || '';
  return {
    username,
    password,
    secret,
    ready: Boolean(username && password && secret.length >= 16),
  };
}

function publishingConfig() {
  return {
    token: process.env.GITHUB_TOKEN || '',
    repo: process.env.GITHUB_REPO || 'K316-M/Science_Subjects_Question',
    branch: process.env.GITHUB_BRANCH || 'main',
  };
}

function sendJson(res, status, body, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
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

// 会改动数据的请求必须来自本站页面（配合 SameSite=Strict 做双重 CSRF 防护）
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const expected = req.headers['x-forwarded-host'] || req.headers.host;
    return new URL(origin).host === expected;
  } catch (e) {
    return false;
  }
}

module.exports = {
  authConfig,
  publishingConfig,
  sendJson,
  readJsonBody,
  safeEqual,
  createSessionToken,
  verifySession,
  sessionCookie,
  clearedSessionCookie,
  sameOrigin,
};
