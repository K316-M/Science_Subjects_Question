// 首页底部的制作名单（data/credits.json）的共用规则。读写走 api/dev-edit.js（target: 'credits'）：
// Vercel 免费方案一次部署最多 12 个 /api 函数，已经满了，所以不另开一支接口（scripts/check_repo.py 会数）。
const { InputError } = require('./questions');

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

module.exports = { CREDITS_PATH, MAX_ROWS, cleanCredits };
