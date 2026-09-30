// 统考闹钟的「每分钟检查」：cron-job.org 每分钟打一次这个网址（?key= 後面接 ALARM_CRON_SECRET），
// 把到期的闹钟推播到学生的装置。Vercel 免费版的排程一天只能跑一次，所以借外面的免费定时器。
// 设定步骤见 docs/OPERATIONS.md「统考闹钟」。
const { config } = require('./_lib/store');
const { sendJson, safeEqual, cleanEnv } = require('./_lib/devauth');
const { tick } = require('./_lib/alarms');

module.exports = async (req, res) => {
  const secret = cleanEnv('ALARM_CRON_SECRET');
  if (!secret || !config().ready) return sendJson(res, 503, { ok: false, error: 'not_configured' });
  const key = new URL(req.url, 'http://x').searchParams.get('key') || '';
  if (!safeEqual(key, secret)) return sendJson(res, 401, { ok: false, error: 'bad_key' });
  try {
    const stats = await tick(`https://${req.headers['x-forwarded-host'] || req.headers.host}`);
    return sendJson(res, 200, { ok: true, ...stats });
  } catch (err) {
    console.error('alarm tick failed:', err.message, err.detail || '');
    return sendJson(res, 502, { ok: false, error: 'upstream' });
  }
};
