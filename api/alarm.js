// 统考闹钟：网站登记这台装置的闹钟，或要一则测试通知。
//   GET                                → { configured, publicKey, tickAge }：打开闹钟面板时问一次
//                                          tickAge＝距离上一次每分钟检查几毫秒（伺服器自己算，学生装置的时钟不准也没关系）
//   POST { subscription, alarms }      → 整批换掉这台装置的闹钟（alarms 给空阵列＝全部删掉）
//   POST { subscription, test: true }  → 马上送一则测试通知
// 按时送出的是 api/alarm-tick.js（cron-job.org 每分钟叫一次）。没设 ALARM_CRON_SECRET 就当作没启用，
// 网站会退回「开着网站才响」。
const { config } = require('./_lib/store');
const { sendJson, readJsonBody, sameOrigin, cleanEnv } = require('./_lib/devauth');
const { cleanSubscription } = require('./_lib/webpush');
const { vapidKeys, lastTick, cleanAlarms, saveDevice, sendTest } = require('./_lib/alarms');

/* 简易节流（同 sync.js） */
const HITS = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 30;

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

const siteOf = req => `https://${req.headers['x-forwarded-host'] || req.headers.host}`;

module.exports = async (req, res) => {
  const ready = config().ready && Boolean(cleanEnv('ALARM_CRON_SECRET'));
  try {
    if (req.method === 'GET') {
      if (!ready) return sendJson(res, 200, { ok: true, configured: false });
      const [vapid, tickAt] = await Promise.all([vapidKeys(), lastTick()]);
      return sendJson(res, 200, { ok: true, configured: true, publicKey: vapid.publicKey, tickAge: tickAt ? Date.now() - tickAt : null });
    }
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'GET, POST' });
    if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'bad_origin' });
    if (!ready) return sendJson(res, 503, { ok: false, error: 'not_configured' });
    if (throttled(req)) return sendJson(res, 429, { ok: false, error: 'too_many_requests', message: '操作太频繁，请稍后再试。' });

    const body = await readJsonBody(req);
    const sub = cleanSubscription(body.subscription);
    if (!sub) return sendJson(res, 400, { ok: false, error: 'bad_subscription' });
    if (body.test === true) {
      const status = await sendTest(sub, siteOf(req));
      const ok = status >= 200 && status < 300;
      return sendJson(res, ok ? 200 : 502, { ok, status });
    }
    const alarms = cleanAlarms(body.alarms, Date.now());
    if (!alarms) return sendJson(res, 400, { ok: false, error: 'bad_alarms' });
    await saveDevice(sub, alarms);
    return sendJson(res, 200, { ok: true, saved: alarms.length });
  } catch (err) {
    console.error('alarm failed:', err.message, err.detail || '');
    return sendJson(res, 502, { ok: false, error: 'upstream', message: '闹钟服务暂时无法使用，稍后再试。' });
  }
};
