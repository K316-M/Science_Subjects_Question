// 首页底部的制作名单：在 /dev「制作名单」增减，存到 data/credits.json（存档後约一分钟自动部署）。
//   GET ：直接从 GitHub 读最新的名单（网站上的 /data 要等部署完才更新，刚存的会「消失」一下）
//   POST：{ credits: [{ role, name }, …] } 整份换掉；全部验证过才存
const { publishingConfig, verifySession, sendJson, readJsonBody, sameOrigin } = require('./_lib/devauth');
const { snapshot, readJson, commitFiles, sendError } = require('./_lib/github');
const { InputError } = require('./_lib/questions');

const CREDITS_PATH = 'data/credits.json';
const MAX_ROWS = 10;      // 同 js/credits.js 的 MAX_ROWS
const MAX_ROLE = 12;
const MAX_NAME = 40;

// 空白压成一格、去掉控制字元；网站用 textContent 放进去，所以不必挡 < >，但不让它超长
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function cleanCredits(list) {
  if (!Array.isArray(list)) throw new InputError('名单格式不对。');
  if (list.length > MAX_ROWS) throw new InputError(`最多 ${MAX_ROWS} 行。`);
  return list.map((c, i) => {
    const role = clean(c && c.role, MAX_ROLE);
    const name = clean(c && c.name, MAX_NAME);
    if (!role || !name) throw new InputError(`第 ${i + 1} 行有空白：身份和名字都要填（不要的行请按删除）。`);
    return { role, name };
  });
}

module.exports = async (req, res) => {
  if (!verifySession(req)) {
    return sendJson(res, 401, { ok: false, error: 'unauthenticated', message: '请先登录开发者工作台' });
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'GET, POST' });
  }
  if (req.method === 'POST' && !sameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: 'bad_origin' });
  }
  const pub = publishingConfig();
  if (!pub.token) {
    return sendJson(res, 501, {
      ok: false, error: 'publishing_not_configured', message: '尚未配置一键发布：请在 Vercel 环境变数里加入 GITHUB_TOKEN。',
    });
  }

  try {
    const snap = await snapshot(pub);
    if (req.method === 'GET') {
      const file = await readJson(pub, snap, CREDITS_PATH);
      return sendJson(res, 200, { ok: true, credits: file && Array.isArray(file.credits) ? file.credits : [] });
    }
    const body = await readJsonBody(req);
    const credits = cleanCredits(body.credits);
    await commitFiles(pub, snap, [{ path: CREDITS_PATH, json: { credits } }], '📝 修改首页制作名单');
    return sendJson(res, 200, { ok: true, credits });
  } catch (err) {
    return sendError(res, err, 'dev-credits');
  }
};

module.exports.cleanCredits = cleanCredits;
