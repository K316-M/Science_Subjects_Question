/* ui-check 的共用工具：静态伺服器、找 Chromium、对比度取样。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(__dirname, 'out');

/* ---------- 静态伺服器：直接服务 repo 根目录，/api 一律 404（与没有後端时一致） ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8',
};
function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || p.startsWith('/api/')) { res.writeHead(404); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () =>
    resolve({ server, url: `http://127.0.0.1:${server.address().port}/index.html` })));
}

/* ---------- 找 Chromium：CHROME_PATH → Playwright 快取 → 交给 playwright-core 预设 ---------- */
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const bases = [
    path.join(os.homedir(), '.cache', 'ms-playwright'),
    path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
  ];
  const rel = [
    ['chrome-linux64', 'chrome'], ['chrome-linux', 'chrome'], ['chrome-win64', 'chrome.exe'], ['chrome-win', 'chrome.exe'],
    ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ];
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const dirs = fs.readdirSync(base).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
    for (const d of dirs) for (const r of rel) {
      const f = path.join(base, d, ...r);
      if (fs.existsSync(f)) return f;
    }
  }
  return undefined;
}

/* ---------- 对比度：把文字设成透明後截图，取「真实合成出来的底色」 ----------
 * 毛玻璃、半透明卡片叠在渐层上，底色不能假设是白的；这是第三轮评审量出 33 组失败的方法。 */
const lum = (r, g, b) => { const f = c => { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
const ratio = (a, b) => { const x = lum(...a), y = lum(...b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
const parse = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };

async function contrast(page, label, scope, R) {
  const items = await page.evaluate((scope) => {
    const root = scope ? document.querySelector(scope) : document.body; if (!root) return [];
    const out = []; const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let t;
    while ((t = w.nextNode())) {
      const txt = t.nodeValue.replace(/\s+/g, ' ').trim(); if (!txt) continue;
      const el = t.parentElement; if (!el || ['SCRIPT', 'STYLE'].includes(el.tagName)) continue;
      let a = el, hid = false, op = 1;
      while (a && a !== document.documentElement) { const c = getComputedStyle(a); if (c.display === 'none' || c.visibility === 'hidden') { hid = true; break; } op *= parseFloat(c.opacity); a = a.parentElement; }
      if (hid || op < .05) continue;
      if (el.closest('.sr-only,.skip-link,[aria-hidden="true"]:not(.orbit-core)')) continue;
      const r = document.createRange(); r.selectNodeContents(t); const raw = [...r.getClientRects()].find(x => x.width > 2 && x.height > 2);
      if (!raw) continue;
      // 只取「真正看得到」的那一段：与视窗、以及每一层会裁切的祖先（overflow 不是 visible）取交集。
      // 否则横向滑轨里被切掉一半的卡片，会取到裁切线外面的背景像素。
      let L = Math.max(raw.left, 0), T = Math.max(raw.top, 0), Rt = Math.min(raw.right, innerWidth), B = Math.min(raw.bottom, innerHeight);
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const c = getComputedStyle(p);
        if (c.overflowX !== 'visible' || c.overflowY !== 'visible') {
          const b = p.getBoundingClientRect();
          L = Math.max(L, b.left); T = Math.max(T, b.top); Rt = Math.min(Rt, b.right); B = Math.min(B, b.bottom);
        }
      }
      if (Rt - L < 4 || B - T < 4) continue;
      // 7×3 个取样点，逐点检查有没有被盖住：黏在顶部的导航、压在标签上的面板……
      // 盖住的那几点取到的是上层的像素，不算（以前只看中心点，半边被盖住的字会误报）
      const pts = [];
      for (let i = 0; i < 7; i++) for (let j = 0; j < 3; j++) {
        const x = Math.min(innerWidth - 1, Math.max(0, L + (Rt - L) * (i + .5) / 7));
        const y = Math.min(innerHeight - 1, Math.max(0, T + (B - T) * (j + .5) / 3));
        const hit = document.elementFromPoint(x, y);
        if (!hit || el.contains(hit) || hit.contains(el)) pts.push([x, y]);
      }
      if (!pts.length) continue;
      const cs = getComputedStyle(el);
      const sel = el.id ? '#' + el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '');
      out.push({ sel, txt: txt.slice(0, 16), color: cs.color, op, fs: parseFloat(cs.fontSize), fw: parseInt(cs.fontWeight), pts });
    }
    return out;
  }, scope);
  // transition 也要关掉：带 transition 的元素会「慢慢」变透明，截到一半会把字的像素当成底色
  const st = await page.addStyleTag({ content: '*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;transition:none!important}' });
  await page.waitForTimeout(80);
  const png = PNG.sync.read(await page.screenshot());
  await st.evaluate(n => n.remove());
  await page.waitForTimeout(300);
  const dpr = png.width / page.viewportSize().width;
  for (const it of items) {
    const fg = parse(it.color); if (!fg) continue;
    const a = fg[3] * it.op; let worst = null;
    for (const [px, py] of it.pts) {
      const x = Math.min(png.width - 1, Math.max(0, Math.round(px * dpr)));
      const y = Math.min(png.height - 1, Math.max(0, Math.round(py * dpr)));
      const o = (y * png.width + x) * 4; const bg = [png.data[o], png.data[o + 1], png.data[o + 2]];
      const eff = [0, 1, 2].map(k => Math.round(fg[k] * a + bg[k] * (1 - a)));
      const r = ratio(eff, bg); if (!worst || r < worst.r) worst = { r, bg, eff };
    }
    const large = it.fs >= 18.66 || (it.fs >= 14 && it.fw >= 700);
    R.push({ view: label, sel: it.sel, txt: it.txt, r: Math.round(worst.r * 100) / 100, need: large ? 3 : 4.5, fg: worst.eff.join(','), bg: worst.bg.join(',') });
  }
}

module.exports = { ROOT, OUT, serve, findChrome, contrast };
