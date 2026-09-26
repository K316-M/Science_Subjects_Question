// Upstash Redis 的 REST 封装。
// 用 REST 而不是一般的 Redis 连线，是因为 Vercel 的 serverless 函式没有常驻的 TCP，
// REST 打得通、也不必管连线池。免费额度：每月 50 万次命令、256 MB。
const crypto = require('crypto');

function config() {
  const url = (process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  return { url, token, ready: Boolean(url && token) };
}

// 存进资料库的是同步码的杂凑值，不是同步码本身 ——
// 万一资料库内容外流，也无法反推出任何人的同步码。
function keyFor(code) {
  return 'uec:sync:' + crypto.createHash('sha256').update(String(code)).digest('hex');
}

async function command(args) {
  const cfg = config();
  if (!cfg.ready) throw Object.assign(new Error('not_configured'), { code: 'not_configured' });
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw Object.assign(new Error(`upstash_${res.status}`), { code: 'upstream', status: res.status, detail });
  }
  const body = await res.json();
  return body.result;
}

async function readDoc(code) {
  const raw = await command(['GET', keyFor(code)]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

// 半年没动就自动过期，免得免费额度被废弃的资料占满
const TTL_SECONDS = 180 * 24 * 60 * 60;

async function writeDoc(code, doc) {
  await command(['SET', keyFor(code), JSON.stringify(doc), 'EX', String(TTL_SECONDS)]);
}

module.exports = { config, command, readDoc, writeDoc };
