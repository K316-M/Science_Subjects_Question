/* 教学地图插画：把绘图 AI 给的「拼图」（透明底、多个贴纸排在一张图里）切成一个个小图，缩成 WebP 放进 assets/teach/，并登记到 manifest.json。
 * 用 Chromium 的 canvas 做（不需要 PIL／ffmpeg），所以只要装了 playwright-core（scripts/ui-check 里有）就能跑：
 *   CHROME_PATH=/path/to/chrome node scripts/teach/art-slice.js source/teach/batch1-sheet.webp source/teach/batch1-sheet.json
 * 做了什么：
 *   1. 按「实心像素（alpha ≥ 100）」找连通块；每件取中心点落在 spec 里 region 框内的块，淡边往外多带 3 像素，更淡的杂边切掉
 *   2. 被围住的半透明洞（例如苯环中间的发光）补成奶白底，不然深色背景上会变黑洞
 *   3. square：缩成 size×size；banner：往里缩 inset 去掉圆角，再裁成 ratio
 * 两种特殊情况（写在 spec 里）：
 *   "key": "checker"  原图是 JPG／没有透明通道、棋盘格是画进像素里的（贴纸外面一圈奶白边）：先把棋盘格抠掉再切。
 *                     棋盘格的两种灰自动从四边数出来（深灰、浅灰的都行；数错了才在 spec 顶层写 "tones": [172, 222]）。
 *                     抠法：从四边往里涂满「中性灰」；被贴纸围住的灰块洞（手脚之间的空隙）也算——整块几乎都是那两种灰，
 *                     或四周一圈是奶白贴纸边（角色自己的灰零件外面是深色描边，不会被误删）；
 *                     贴纸边外缘混了灰的那一圈像素，用「棋盘灰 → 奶白」这条线算出混了多少，还原成半透明。
 *                     真透明的 PNG／WebP 永远比这个干净，能重发就重发。
 *   kind "photo"      整张图不抠、只缩小（封面这种铺满的图）：size = 宽度，高度按比例。
 */
const fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('playwright')); }
const ROOT = path.join(__dirname, '..', '..');
const [src, specPath] = process.argv.slice(2);
if (!src || !specPath) { console.log('用法：node scripts/teach/art-slice.js <拼图> <spec.json>'); process.exit(1); }
const specFile = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const spec = specFile.items, KEY = specFile.key || '', TONES = specFile.tones || null;
const OUT = path.join(ROOT, 'assets', 'teach');
(async () => {
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const p = await b.newPage();
  const data = fs.readFileSync(src).toString('base64');
  const out = await p.evaluate(async ({ d, spec, KEY, TONES: specTones, mime }) => {
    const img = new Image(); img.src = `data:${mime};base64,` + d; await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const idata = x.getImageData(0, 0, W, H); const id = idata.data;
    const photoOut = [];
    for (const sp of spec.filter(s => s.kind === 'photo')) {   // 整张只缩小
      const f = document.createElement('canvas'); f.width = sp.size; f.height = Math.round(sp.size * H / W);
      const fx = f.getContext('2d'); fx.imageSmoothingQuality = 'high'; fx.drawImage(img, 0, 0, f.width, f.height);
      const blob = await new Promise(r => f.toBlob(r, 'image/webp', sp.quality || 0.86));
      const buf = new Uint8Array(await blob.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      photoOut.push({ name: sp.name, bytes: buf.length, b64: btoa(bin), w: f.width, h: f.height });
    }
    if (KEY === 'checker') {
      const N0 = W * H, neutral = i => Math.max(id[i * 4], id[i * 4 + 1], id[i * 4 + 2]) - Math.min(id[i * 4], id[i * 4 + 1], id[i * 4 + 2]) <= 10;
      // 棋盘格的两种灰：spec 的 tones 有写就用；没写就从四边 40 像素里数「中性灰」最多的两种（相差要 ≥ 16）
      let tones = specTones;
      if (!tones) {
        const hist = {}; const add = (xx, yy) => { const i = yy * W + xx; if (neutral(i)) { const k = Math.round(id[i * 4] / 4) * 4; hist[k] = (hist[k] || 0) + 1; } };
        for (let t = 0; t < 40; t++) for (let u = 0; u < W; u++) { add(u, t); add(u, H - 1 - t); }
        const top = Object.entries(hist).map(([k, v]) => [+k, v]).sort((a, b) => b[1] - a[1]);
        tones = [top[0][0], (top.find(e => Math.abs(e[0] - top[0][0]) >= 16) || top[0])[0]];
      }
      const lo = Math.min(...tones) - 12, hi = Math.max(...tones) + 12, near = (v, c) => Math.abs(v - c) <= 10;
      const gray = i => neutral(i) && id[i * 4] >= lo && id[i * 4] <= hi;
      // 洞里的灰块靠近奶白边时 JPG 会带一点暖色（max-min 到 20 上下），所以找洞时用放宽的 gray2
      const gray2 = i => { const r = id[i * 4], g = id[i * 4 + 1], bl = id[i * 4 + 2], L = (r + g + bl) / 3; return Math.max(r, g, bl) - Math.min(r, g, bl) <= 22 && L >= lo - 14 && L <= hi; };
      const bg = new Uint8Array(N0), st = [];
      const seed = i => { if (!bg[i] && gray(i)) { bg[i] = 1; st.push(i); } };
      for (let xx = 0; xx < W; xx++) { seed(xx); seed((H - 1) * W + xx); } for (let yy = 0; yy < H; yy++) { seed(yy * W); seed(yy * W + W - 1); }
      while (st.length) { const q = st.pop(), qx = q % W, qy = (q / W) | 0; if (qx > 0) seed(q - 1); if (qx < W - 1) seed(q + 1); if (qy > 0) seed(q - W); if (qy < H - 1) seed(q + W); }
      // 被围住的灰块洞（手脚之间的空隙）：两种情况才算背景——
      //   ① 整块几乎都是那两种棋盘灰（≥ 150 像素、92% 以上；大块的两种灰都有就放宽到 68%）；
      //   ② 面积小一点也行，但四周一圈是贴纸的奶白边（角色自己的灰色零件外面是深色描边，不会被误删）
      const seen = new Uint8Array(N0), creamish = i => { const r = id[i * 4], g = id[i * 4 + 1], bl = id[i * 4 + 2]; return r >= 228 && g >= 218 && bl >= 188 && r - bl >= 12; };
      for (let s = 0; s < N0; s++) {
        if (bg[s] || seen[s] || !gray2(s)) continue;
        const comp = [s]; seen[s] = 1; let k = 0, ok = 0, n0 = 0, n1 = 0;
        while (k < comp.length) { const q = comp[k++], qx = q % W, qy = (q / W) | 0; const v = id[q * 4]; if (near(v, tones[0])) { ok++; n0++; } else if (near(v, tones[1])) { ok++; n1++; }
          for (const t of [qx > 0 ? q - 1 : -1, qx < W - 1 ? q + 1 : -1, qy > 0 ? q - W : -1, qy < H - 1 ? q + W : -1]) if (t >= 0 && !seen[t] && !bg[t] && gray2(t)) { seen[t] = 1; comp.push(t); } }
        // 大块的空隙：两种灰都占一定比例就算（格子交界处 JPG 会糊出中间灰，所以门槛比小块低）
        let isBg = (comp.length >= 150 && ok / comp.length >= 0.92) || (comp.length >= 300 && ok / comp.length >= 0.68 && n0 / comp.length >= 0.15 && n1 / comp.length >= 0.15);
        if (!isBg && comp.length >= 8 && ok / comp.length >= 0.5) {
          const mark = new Set(comp); let tot = 0, cr = 0;
          for (const q of comp) { const qx = q % W, qy = (q / W) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x2 = qx + 2 * dx, y2 = qy + 2 * dy; if (x2 < 0 || y2 < 0 || x2 >= W || y2 >= H) continue; const t = y2 * W + x2; if (mark.has(t) || gray2(t)) continue; tot++; if (creamish(t)) cr++; } }
          isBg = tot >= 6 && cr / tot >= 0.6;
        }
        if (isBg) comp.forEach(q => { bg[q] = 1; });
      }
      // 贴纸外缘 2 像素：奶白混了灰 → 用「附近棋盘灰 → 奶白」这条线算出混了多少，还原成半透明、颜色定成奶白
      const edge = new Uint8Array(N0), CREAM = [251, 243, 223];
      for (let yy = 2; yy < H - 2; yy++) for (let xx = 2; xx < W - 2; xx++) { const i = yy * W + xx; if (bg[i]) continue;
        let near_bg = false; for (let dy = -2; dy <= 2 && !near_bg; dy++) for (let dx = -2; dx <= 2; dx++) if (bg[i + dy * W + dx]) { near_bg = true; break; } if (near_bg) edge[i] = 1; }
      const alphaOf = (xx, yy) => {   // 这个像素里奶白占几成（0～1）；附近没有背景灰就当整个是奶白
        let n = 0, g = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const j = (yy + dy) * W + xx + dx; if (bg[j]) { n++; g += id[j * 4]; } }
        if (!n) return 1; g /= n; const k = (yy * W + xx) * 4;
        const vx = CREAM[0] - g, vy = CREAM[1] - g, vz = CREAM[2] - g;
        return Math.max(0, Math.min(1, ((id[k] - g) * vx + (id[k + 1] - g) * vy + (id[k + 2] - g) * vz) / (vx * vx + vy * vy + vz * vz)));
      };
      const alpha = new Float32Array(N0).fill(1);
      for (let yy = 2; yy < H - 2; yy++) for (let xx = 2; xx < W - 2; xx++) { const i = yy * W + xx; if (edge[i]) alpha[i] = alphaOf(xx, yy); }
      for (let i = 0; i < N0; i++) { const k = i * 4;
        if (bg[i]) { id[k + 3] = 0; continue; }
        id[k + 3] = 255;
        if (edge[i] && alpha[i] < 0.98) { id[k] = CREAM[0]; id[k + 1] = CREAM[1]; id[k + 2] = CREAM[2]; id[k + 3] = Math.round(alpha[i] * 255); }
      }
    }
    // 连通块（alpha > 8）
    const lab = new Int32Array(W * H), comps = []; let n = 0;
    for (let s = 0; s < W * H; s++) {
      if (lab[s] || id[s * 4 + 3] < 100) continue;
      n++; const stack = [s]; lab[s] = n; let x0 = W, y0 = H, x1 = 0, y1 = 0, cnt = 0, sx = 0, sy = 0;
      while (stack.length) { const q = stack.pop(), qx = q % W, qy = (q / W) | 0; cnt++; sx += qx; sy += qy; if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = qx + dx, ny = qy + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const t = ny * W + nx; if (!lab[t] && id[t * 4 + 3] >= 100) { lab[t] = n; stack.push(t); } } }
      comps.push({ n, x0, y0, x1, y1, cnt, cx: sx / cnt, cy: sy / cnt });
    }
    for (let it = 0; it < 3; it++) { const nl = lab.slice(); for (let yy = 1; yy < H - 1; yy++) for (let xx = 1; xx < W - 1; xx++) { const i = yy * W + xx; if (lab[i] || id[i * 4 + 3] < 28) continue; const nb = lab[i - 1] || lab[i + 1] || lab[i - W] || lab[i + W]; if (nb) nl[i] = nb; } lab.set(nl); }
    const big = comps.filter(k => k.cnt > 400);
    const result = [...photoOut];
    for (const sp of spec.filter(s => s.kind !== 'photo')) {
      const [rx0, ry0, rx1, ry1] = sp.region;
      const mine = big.filter(k => k.cx >= rx0 && k.cx <= rx1 && k.cy >= ry0 && k.cy <= ry1);
      if (!mine.length) { result.push({ name: sp.name, error: '没有找到' }); continue; }
      const keep = new Set(mine.map(k => k.n));
      let bx0 = W, by0 = H, bx1 = 0, by1 = 0;
      for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) { const si = yy * W + xx; if (keep.has(lab[si]) && id[si * 4 + 3] > 28) { if (xx < bx0) bx0 = xx; if (xx > bx1) bx1 = xx; if (yy < by0) by0 = yy; if (yy > by1) by1 = yy; } }
      bx1 += 1; by1 += 1;
      // 只保留属于这几块的像素（别的贴纸的边缘不会带进来）
      const w = bx1 - bx0, h = by1 - by0, tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h; const tx = tmp.getContext('2d');
      const o = tx.createImageData(w, h);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) { const si = (by0 + yy) * W + bx0 + xx; if (keep.has(lab[si])) { o.data.set(id.subarray(si * 4, si * 4 + 4), (yy * w + xx) * 4); } }
      // 清理：把几乎看不见的淡边（拼图里别的贴纸的影子）切掉；贴纸里被围住的半透明洞（例如苯环中间的发光）补成奶白底，
      // 不然在深色背景上会变成黑洞
      const D = o.data, CUT = 28, N = w * h;
      for (let i = 0; i < N; i++) if (D[i * 4 + 3] < CUT) D[i * 4 + 3] = 0;
      if (sp.kind === 'square') {
        const outside = new Uint8Array(N), st = [];
        const push = q => { if (!outside[q] && D[q * 4 + 3] < 128) { outside[q] = 1; st.push(q); } };
        for (let xx = 0; xx < w; xx++) { push(xx); push((h - 1) * w + xx); }
        for (let yy = 0; yy < h; yy++) { push(yy * w); push(yy * w + w - 1); }
        while (st.length) { const q = st.pop(), qx = q % w, qy = (q / w) | 0; if (qx > 0) push(q - 1); if (qx < w - 1) push(q + 1); if (qy > 0) push(q - w); if (qy < h - 1) push(q + w); }
        let filled = 0;
        for (let i = 0; i < N; i++) { if (outside[i] || D[i * 4 + 3] >= 250) continue; const a = D[i * 4 + 3] / 255, k = i * 4; D[k] = D[k] * a + 251 * (1 - a); D[k + 1] = D[k + 1] * a + 243 * (1 - a); D[k + 2] = D[k + 2] * a + 223 * (1 - a); D[k + 3] = 255; filled++; }
        sp.filled = filled;
      }
      tx.putImageData(o, 0, 0);
      const f = document.createElement('canvas');
      let sw, sh, sxs = 0, sys = 0, sww = w, shh = h;
      if (sp.kind === 'square') { sw = sh = sp.size; }
      else { // banner：先往里缩 inset 去掉圆角，再裁成 ratio
        const ins = sp.inset || 0; sxs = ins; sys = ins; sww = w - 2 * ins; shh = h - 2 * ins;
        const r = sp.ratio; if (sww / shh > r) { const nw = shh * r; sxs += (sww - nw) / 2; sww = nw; } else { const nh = sww / r; sys += (shh - nh) / 2; shh = nh; }
        sw = sp.size; sh = Math.round(sp.size / r);
      }
      f.width = sw; f.height = sh; const fx = f.getContext('2d'); fx.imageSmoothingQuality = 'high';
      if (sp.kind === 'square') { const s = Math.min(sw / w, sh / h) * (1 - 2 * (sp.pad || 0.02)); const dw = w * s, dh = h * s; fx.drawImage(tmp, 0, 0, w, h, (sw - dw) / 2, (sh - dh) / 2, dw, dh); }
      else fx.drawImage(tmp, sxs, sys, sww, shh, 0, 0, sw, sh);
      const blob = await new Promise(r => f.toBlob(r, 'image/webp', 0.92));
      const buf = new Uint8Array(await blob.arrayBuffer()); let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      result.push({ name: sp.name, filled: sp.filled || 0, box: [bx0, by0, bx1, by1], comps: mine.length, bytes: buf.length, b64: btoa(bin), w: sw, h: sh });
    }
    return { W, H, comps: big.map(k => [k.x0, k.y0, k.x1, k.y1, k.cnt]), result };
  }, { d: data, spec, KEY, TONES, mime: /\.jpe?g$/i.test(src) ? 'image/jpeg' : /\.png$/i.test(src) ? 'image/png' : 'image/webp' });
  console.log('拼图', out.W, '×', out.H);
  fs.mkdirSync(OUT, { recursive: true });
  const made = [];
  for (const r of out.result) {
    if (r.error) { console.log('✗', r.name, r.error); process.exitCode = 1; continue; }
    fs.writeFileSync(path.join(OUT, r.name + '.webp'), Buffer.from(r.b64, 'base64'));
    made.push(r.name + '.webp');
    console.log('✓', r.name, `${r.w}×${r.h}`, `${(r.bytes / 1024).toFixed(1)}KB`);
  }
  // 登记：manifest 里只留 assets/teach/ 真的有的档案
  const mp = path.join(OUT, 'manifest.json');
  let m = { note: '放进 assets/teach/ 的插画文件名（<cover|node|boss>-<id>.webp）。登记了的才会载入，没登记的用内置图案。清单见 docs/ART_BRIEF.md', files: [] };
  try { m = { ...m, ...JSON.parse(fs.readFileSync(mp, 'utf8')) }; } catch (e) { /* 第一次 */ }
  m.files = [...new Set([...(m.files || []), ...made])].filter(f => fs.existsSync(path.join(OUT, f))).sort();
  fs.writeFileSync(mp, JSON.stringify(m, null, 1) + '\n');
  await b.close();
})();
