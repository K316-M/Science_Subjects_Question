// 跨装置同步：GET 拉取、POST 推送。
// 刻意不做帐号 —— 使用者是中学生，收 email／密码有个资义务，也多一层安全风险。
// 改用「同步码」：一串够长的随机码就是这份资料的钥匙，不含任何个人资料。
const { config, readDoc, writeDoc } = require('./_lib/store');
const { sendJson, readJsonBody, sameOrigin } = require('./_lib/devauth');

const CODE_RE = /^[A-Z2-9]{20}$/;            // 与前端产生的格式一致，约 100 bits
const MAX_BYTES = 512 * 1024;                // 单次同步的上限
const SYNC_KEYS = [
  'UEC_PROGRESS_v1',
  'UEC_NOTES_v1',
  'UEC_FEEDBACK_v1',
  'UEC_LAST_VISIT_v1',
  'UEC_REVIEW_v1',
  'UEC_BIO_HL_STORE_OFFICIAL_19',
];

/* 简易节流：同步码本身够长、猜不到，但还是别让人无限制地打 */
const HITS = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 60;

function throttled(req) {
  const ip = String(req.headers['x-vercel-forwarded-for']
    || String(req.headers['x-forwarded-for'] || '').split(',')[0]
    || 'unknown').trim().slice(0, 64);
  const now = Date.now();
  const rec = HITS.get(ip) || { count: 0, until: now + WINDOW_MS };
  if (rec.until < now) { rec.count = 0; rec.until = now + WINDOW_MS; }
  rec.count += 1;
  HITS.set(ip, rec);
  if (HITS.size > 5000) HITS.clear();
  return rec.count > MAX_PER_WINDOW;
}

function normalizeCode(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z2-9]/g, '');
  return CODE_RE.test(code) ? code : null;
}

// 只收认得的键，而且每一项都必须是物件或字串 —— 不让任意内容被塞进同步桶
function sanitizePayload(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of SYNC_KEYS) {
    const entry = raw[key];
    if (!entry || typeof entry !== 'object') continue;
    const { ts, value } = entry;
    if (value === undefined || value === null) continue;
    if (typeof value !== 'object' && typeof value !== 'string') continue;
    out[key] = { ts: Number(ts) || 0, value };
  }
  return out;
}

module.exports = async (req, res) => {
  // 前端只想知道「有没有启用」。回 200 而不是 503，浏览器就不会在 console 报红字；
  // 也不碰 Redis、不算节流，免得吃免费额度。
  if (req.method === 'GET' && new URL(req.url, 'http://x').searchParams.get('probe') === '1') {
    return sendJson(res, 200, { ok: true, configured: Boolean(config().ready) });
  }
  if (!config().ready) {
    return sendJson(res, 503, {
      ok: false, error: 'not_configured',
      message: '跨装置同步尚未启用：请在 Vercel 环境变数加入 UPSTASH_REDIS_REST_URL 与 UPSTASH_REDIS_REST_TOKEN。',
    });
  }
  if (throttled(req)) {
    return sendJson(res, 429, { ok: false, error: 'too_many_requests', message: '同步太频繁，请稍后再试。' });
  }

  try {
    if (req.method === 'GET') {
      const code = normalizeCode(new URL(req.url, 'http://x').searchParams.get('code'));
      if (!code) return sendJson(res, 400, { ok: false, error: 'bad_code', message: '同步码格式不对' });
      const doc = await readDoc(code);
      return sendJson(res, 200, { ok: true, doc: doc || { ver: 0, updatedAt: 0, payload: {} } });
    }

    if (req.method !== 'POST') {
      return sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'GET, POST' });
    }
    if (!sameOrigin(req)) {
      return sendJson(res, 403, { ok: false, error: 'bad_origin' });
    }

    const body = await readJsonBody(req);
    const code = normalizeCode(body.code);
    if (!code) return sendJson(res, 400, { ok: false, error: 'bad_code', message: '同步码格式不对' });

    const payload = sanitizePayload(body.payload);
    const size = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    if (size > MAX_BYTES) {
      return sendJson(res, 413, {
        ok: false, error: 'too_large',
        message: `资料 ${Math.round(size / 1024)} KB，超过 ${MAX_BYTES / 1024} KB 上限（多半是笔记太多，先清掉一些）。`,
      });
    }

    // 乐观锁：两台装置同时推送时，版本对不上的那一方会拿回最新内容重新合并
    const current = await readDoc(code);
    const currentVer = (current && current.ver) || 0;
    if (Number(body.baseVer) !== currentVer) {
      return sendJson(res, 409, { ok: false, error: 'version_conflict', doc: current || { ver: 0, updatedAt: 0, payload: {} } });
    }

    const doc = { ver: currentVer + 1, updatedAt: Date.now(), payload };
    await writeDoc(code, doc);
    return sendJson(res, 200, { ok: true, doc });
  } catch (err) {
    if (err.code === 'not_configured') {
      return sendJson(res, 503, { ok: false, error: 'not_configured' });
    }
    console.error('sync failed:', err.message, err.detail || '');
    return sendJson(res, 502, { ok: false, error: 'upstream', message: '同步服务暂时无法使用，稍后再试。' });
  }
};
