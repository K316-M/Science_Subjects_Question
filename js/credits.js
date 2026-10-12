/* 首页最底下的制作名单（类似一般网站的 CC）。
 * 名单在 data/credits.json：[{ role: '制作', name: '…' }, …]，到 /dev「制作名单」增减，不用改程式。
 * 读不到、或里面没有有效的一行，就整块不显示。文字一律用 textContent 放进去。
 */
(function () {
  'use strict';

  const MAX_ROWS = 10;   // 同 api/dev-credits.js 的 MAX_ROWS
  const box = document.getElementById('siteCredits');
  if (!box) return;

  const text = v => (typeof v === 'string' ? v.trim() : '');

  fetch('/data/credits.json', { cache: 'no-cache' })
    .then(res => (res.ok ? res.json() : null))
    .then(data => {
      const rows = (data && Array.isArray(data.credits) ? data.credits : [])
        .map(c => ({ role: text(c && c.role), name: text(c && c.name) }))
        .filter(c => c.role && c.name)
        .slice(0, MAX_ROWS);
      if (!rows.length) return;
      rows.forEach(c => {
        const item = document.createElement('span');
        item.className = 'credit-item';
        const role = document.createElement('span');
        role.className = 'credit-role';
        role.textContent = c.role;
        const name = document.createElement('span');
        name.className = 'credit-name';
        name.textContent = c.name;
        item.append(role, name);
        box.appendChild(item);
      });
      box.hidden = false;
    })
    .catch(() => {});
})();
