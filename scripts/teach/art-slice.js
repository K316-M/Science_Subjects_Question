/* 教学地图插画：把绘图 AI 给的「拼图」（透明底、多个贴纸排在一张图里）切成一个个小图，缩成 WebP 放进 assets/teach/，并登记到 manifest.json。
 * 用 Chromium 的 canvas 做（不需要 PIL／ffmpeg），所以只要装了 playwright-core（scripts/ui-check 里有）就能跑：
 *   CHROME_PATH=/path/to/chrome node scripts/teach/art-slice.js source/teach/batch1-sheet.webp source/teach/batch1-sheet.json
 * 做了什么：
 *   1. 按「实心像素（alpha ≥ 100）」找连通块；每件取中心点落在 spec 里 region 框内的块，淡边往外多带 3 像素，更淡的杂边切掉
 *   2. 被围住的半透明洞（例如苯环中间的发光）补成奶白底，不然深色背景上会变黑洞
 *   3. square：缩成 size×size；banner：往里缩 inset 去掉圆角，再裁成 ratio
 * 原图必须是真正透明的 PNG／WebP（灰白棋盘格不行）。
 */
const fs = require('fs'), path = require('path');
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('playwright')); }
const ROOT = path.join(__dirname, '..', '..');
const [src, specPath] = process.argv.slice(2);
if (!src || !specPath) { console.log('用法：node scripts/teach/art-slice.js <拼图> <spec.json>'); process.exit(1); }
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')).items;
const OUT = path.join(ROOT, 'assets', 'teach');
(async () => {
  const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const p = await b.newPage();
  const data = fs.readFileSync(src).toString('base64');
  const out = await p.evaluate(async ({ d, spec }) => {
    const img = new Image(); img.src = 'data:image/webp;base64,' + d; await img.decode();
    const W = img.naturalWidth, H = img.naturalHeight;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const id = x.getImageData(0, 0, W, H).data;
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
    const result = [];
    for (const sp of spec) {
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
  }, { d: data, spec });
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
