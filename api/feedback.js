// 申诉转寄：学生站 → 这里 → Formspree（寄一封信到管理员信箱）。
// 以前浏览器直接打 Formspree，表单编号写在前端，谁都能拿去一直灌信，把每月的免费额度用光、
// 真正的申诉就寄不出去。现在先在这里挡洗版，再由伺服器转寄：
//   - 只收本站页面送来的（别的网站不能借访客的浏览器帮它灌）
//   - 每台装置、每个网络每小时有次数上限（同 AI 讲解的算法：全校共用一个 IP，所以装置另外算）
//   - 同一台装置送出一模一样的内容，一天内只寄一次
//   - 字数有上下限
const crypto = require('crypto');
const { sendJson, readJsonBody, sameOrigin } = require('./_lib/devauth');
const { useQuota } = require('./_lib/ai');
const store = require('./_lib/store');

// Formspree 表单编号只放 Vercel 环境变数 FEEDBACK_FORMSPREE_ID，程式里不留备用：
// 旧表单已经删了，留着只会在环境变数不见时把申诉送进不存在的表单、没人发现
// 每台装置每小时最多送几则；同一个网络（全校 Wi-Fi）合计几则
const PER_DEVICE_PER_HOUR = 3;
const PER_NETWORK_PER_HOUR = 10;
// 问题描述的字数（MAX_TEXT 要和 index.html 两个申诉文字框的 maxlength 一样）、联络方式的字数
const MIN_TEXT = 5;
const MAX_TEXT = 2000;
const MAX_CONTACT = 100;
// 同样内容多久内不重寄
const DUPLICATE_SECONDS = 24 * 60 * 60;
const FORWARD_TIMEOUT_MS = 10000;

const ID_RE = /^fb_[a-z0-9]{6,20}$/;
const DEV_CODE_RE = /^UECFB:[A-Za-z0-9_-]{1,2000}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hash = s => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 32);

// 没有 Upstash 时，同一台伺服器记得住就好
const memSent = new Map();
async function alreadySent(key) {
  if (store.config().ready) {
    try { return Boolean(await store.command(['GET', key])); } catch (e) { /* 挂了就当没寄过 */ }
  }
  return (memSent.get(key) || 0) > Date.now();
}
async function rememberSent(key) {
  if (store.config().ready) {
    try { await store.command(['SET', key, '1', 'EX', String(DUPLICATE_SECONDS)]); return; } catch (e) { /* 改记在记忆体 */ }
  }
  if (memSent.size > 5000) memSent.clear();
  memSent.set(key, Date.now() + DUPLICATE_SECONDS * 1000);
}

// 浏览器送来的栏位：只收认得的、长度有上限的
function clean(body) {
  const text = String(body.text || '').trim();
  const contact = String(body.contact || '').trim();
  if (text.length < MIN_TEXT) return { error: `请再写清楚一点（至少 ${MIN_TEXT} 个字）。` };
  if (text.length > MAX_TEXT) return { error: `问题描述最多 ${MAX_TEXT} 个字，请精简一下。` };
  if (contact.length > MAX_CONTACT) return { error: `联络方式最多 ${MAX_CONTACT} 个字。` };
  const id = String(body.id || '');
  const devCode = String(body.devCode || '');
  if (!ID_RE.test(id) || !DEV_CODE_RE.test(devCode)) return { error: '申诉格式不对，请重新整理页面再送一次。' };
  return { id, text, contact, devCode, where: String(body.where || '未指定').trim().slice(0, 100) };
}

async function forward(formId, r) {
  const payload = {
    _subject: `独中理科网站问题申诉 ${r.id}`,
    问题编号: r.id,
    出问题的位置: r.where,
    问题描述: r.text,
    联络方式: r.contact || '（未填写）',
    开发者处理码: r.devCode,
  };
  // Formspree 会把 email 栏位当回信地址，格式不对会整笔拒收，所以只在像信箱时才带
  if (EMAIL_RE.test(r.contact)) payload.email = r.contact;
  try {
    const res = await fetch(`https://formspree.io/f/${formId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: 'forbidden', message: '请从网站的申诉页送出。' });
  const formId = (process.env.FEEDBACK_FORMSPREE_ID || '').trim();
  if (!formId) {
    console.error('申诉收不到：Vercel 没有设 FEEDBACK_FORMSPREE_ID（见 docs/OPERATIONS.md 第九节）');
    return sendJson(res, 503, { ok: false, error: 'not_configured', message: '申诉信箱暂时没有设定好，可以晚点再按「重新发送」。' });
  }

  const r = clean(await readJsonBody(req));
  if (r.error) return sendJson(res, 400, { ok: false, error: 'invalid', message: r.error });

  const device = String(req.headers['x-uec-device'] || '');
  const ip = String(req.headers['x-vercel-forwarded-for']
    || String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'unknown').trim();
  const dupKey = `uec:fb:sent:${hash(`${/^[A-Za-z0-9_-]{16,64}$/.test(device) ? device : 'ip:' + ip}\n${r.text}`)}`;
  // 一样的内容已经寄过：当作送出成功，不再寄、也不扣次数（例如按了「重新发送」）
  if (await alreadySent(dupKey)) return sendJson(res, 200, { ok: true, duplicate: true });

  const q = await useQuota(req, 'feedback', PER_DEVICE_PER_HOUR, PER_NETWORK_PER_HOUR);
  if (q.over) {
    return sendJson(res, 429, { ok: false, error: 'rate_limited', message: q.shared
      ? `你们这个网络这一小时已经送出很多则申诉了，${q.resetMin} 分钟後再按「重新发送」。`
      : `这一小时已经送出 ${PER_DEVICE_PER_HOUR} 则申诉了，${q.resetMin} 分钟後再按「重新发送」。` });
  }

  if (!(await forward(formId, r))) {
    await q.refund();
    return sendJson(res, 502, { ok: false, error: 'upstream', message: '暂时没能送出（可能是网络问题）。' });
  }
  await rememberSent(dupKey);
  return sendJson(res, 200, { ok: true });
};
