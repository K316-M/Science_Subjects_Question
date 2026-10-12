/* 教学模式：点首页的化学球 →「教学」，三张思维导图式的闯关地图（无机／有机／物化）。
 * ----------------------------------------------------------------------------------
 * 资料全在 data/teach/<科目>.json（地图 → 小节 → 关卡 → 题目），加关卡、改题目不用改这个档案。
 * 怎么玩：
 *   - 每一关先看「知识卡」（要点＋按类别分组的反应式），再闯 3 题：名词题（四选一）、计算题（填数字）、论述题（自评要点）；
 *   - 地图由易到难，父关通过才解锁下一关；
 *   - 每个小节尽头有「魔王关」：随时可以直接挑战，过关就免修整个小节（想跳级的人用）。
 * 进度只存本机：localStorage 的 UEC_TEACH_v1 = { 科目: { 关卡id: { s: 星数, k: 'p'（亲手通关）|'s'（跳级） } } }
 * 文字一律用 textContent 放进网页，资料里的字串不会被当成 HTML。
 * 对外只有 window.TeachMode.open(科目)；_test 是给自动测试用的。
 */
(function () {
  'use strict';

  /* ============ 可以改的设定 ============ */
  const PASS_RATIO = 0.6;        // 一般关卡：答对这个比例才过关
  const BOSS_RATIO = 0.8;        // 魔王关：门槛比较高（5 题要对 4 题）
  const BOSS_POOL = 4;           // 魔王关从本小节所有题目里抽几题（外加 1 道专属终局题）
  const DEFAULT_TOL = 0.02;      // 计算题容许的相对误差（资料里的 tol 优先）
  const SHOW_DRAFT_BADGE = true; // 题目还是草稿时，在教学页顶端显示「草稿」提醒；审完把它改成 false
  const STORE_KEY = 'UEC_TEACH_v1';
  /* ====================================== */

  // 地图画布（卡片大小、间距在下面 DIM；缩放与镜头在这里）
  const ZOOM_MIN = 0.3, ZOOM_MAX = 1.8, ZOOM_STEP = 1.25;   // 缩放范围与每按一下放大／缩小几倍
  const ZOOM_FAR = 0.5, ZOOM_NEAR = 0.85;                    // 缩得比 FAR 小：只留图标和标题；比 NEAR 大：显示一句话重点和星星
  const FLY_MS = 480;            // 镜头飞到某一关要多久（毫秒）；系统开了「减少动态」就直接跳过去
  const DRAG_PX = 6;             // 手指／鼠标移动超过几像素才算「拖动」，没超过算点击
  const HORIZONTAL_MIN = 720;    // 画面宽度 ≥ 这个值用左→右排；窄的（手机竖拿）用上→下
  const FIT_PAD = 28;            // 「适配」时四周留多宽
  const REGION_GAP = 110;        // 小节与小节之间（沿前进方向）隔多远

  const KIND_LABEL = { calc: '计算', term: '名词', essay: '理论' };
  const KIND_ORDER = ['calc', 'term', 'essay'];
  const TIER_LABEL = { 1: '入门', 2: '进阶', 3: '挑战', 4: '终局' };
  const SUBJECT_NAME = { chemistry: '化学' };

  /* ---------- 小工具 ---------- */
  const root = () => document.getElementById('teachRoot');
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.append(rich(v));
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    kids.flat().forEach(k => { if (k != null && k !== false) el.append(k.nodeType ? k : rich(k)); });
    return el;
  }
  // DOM 的 append 会把 null 写成文字「null」；这个版本跳过 null／false，也接受数组
  function put(el, ...kids) {
    kids.flat().forEach(k => { if (k != null && k !== false) el.append(k.nodeType ? k : rich(k)); });
    return el;
  }
  // 上下标：资料里写 _{c}（下标）、^{2+}（上标），这里用 <sub>／<sup> 元素画出来（createElement＋textContent，不经过 innerHTML）。
  // Unicode 没有 b c d f g q w y z 和大写字母的下标，K_{c}、ΔH_{f} 只能这样写；已经是 Unicode 的（H₂O、mol⁻¹）照样能用
  const MARK_TEST = /[_^]\{/, MARK_ALL = /([_^])\{([^{}]*)\}/g;
  function rich(text) {
    const s = String(text);
    if (!MARK_TEST.test(s)) return document.createTextNode(s);
    const frag = document.createDocumentFragment();
    let at = 0, m;
    MARK_ALL.lastIndex = 0;
    while ((m = MARK_ALL.exec(s))) {
      if (m.index > at) frag.append(s.slice(at, m.index));
      const el = document.createElement(m[1] === '_' ? 'sub' : 'sup');
      el.textContent = m[2];
      frag.append(el);
      at = m.index + m[0].length;
    }
    if (at < s.length) frag.append(s.slice(at));
    return frag;
  }
  const plain = text => String(text).replace(/[_^]\{([^{}]*)\}/g, '$1');   // aria-label 用，不能放元素
  const clear = el => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  const sound = t => { if (typeof window.playSound === 'function') { try { window.playSound(t); } catch (e) { /* 没有音效也没关系 */ } } };

  /* ---------- 进度（只存本机） ---------- */
  function readStore() {
    try { const v = JSON.parse(localStorage.getItem(STORE_KEY)); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
  }
  function writeStore(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (e) { /* 存不进去就算了 */ } }
  const progressOf = subject => { const s = readStore(); return s[subject] && typeof s[subject] === 'object' ? s[subject] : {}; };
  const starsOf = (subject, id) => { const p = progressOf(subject)[id]; return p && Number.isInteger(p.s) ? p.s : 0; };
  // 星数只增不减；跳级（k:'s'）不会盖掉亲手通关的纪录
  function award(subject, id, stars, kind) {
    const store = readStore();
    const mine = store[subject] = store[subject] && typeof store[subject] === 'object' ? store[subject] : {};
    const old = mine[id];
    if (old && old.s >= stars) return;
    mine[id] = { s: stars, k: kind };
    writeStore(store);
  }

  /* ---------- 计分规则（纯函数，给测试用） ---------- */
  function parseNumber(text) {
    if (typeof text !== 'string') return NaN;
    let s = text.trim().replace(/[−–—﹣－]/g, '-').replace(/[，,\s]/g, '');
    s = s.replace(/[×xX*]10\^?\(?([+-]?\d+)\)?$/, 'e$1');   // 1.2×10^-3、1.2x10-3、1.2*10^(-3)
    const frac = /^([+-]?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(s);
    if (frac) return Number(frac[2]) === 0 ? NaN : Number(frac[1]) / Number(frac[2]);
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return NaN;
    return Number(s);
  }
  function isCorrect(value, answer, tol) {
    if (!Number.isFinite(value)) return false;
    const t = typeof tol === 'number' ? tol : DEFAULT_TOL;
    return answer === 0 ? Math.abs(value) <= 1e-9 : Math.abs(value - answer) <= Math.abs(answer) * t;
  }
  const needed = (n, ratio) => Math.ceil(n * ratio - 1e-9);
  // 全对 3 星；过关（够比例）2 星；没过 0 星
  function starsFor(correct, total, ratio) {
    if (correct >= total) return 3;
    return correct >= needed(total, ratio) ? 2 : 0;
  }
  function shuffle(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  const numText = (n, unit) => {
    const s = Math.abs(n) >= 1e5 || (Math.abs(n) < 1e-3 && n !== 0) ? n.toExponential(2) : String(Number(n.toPrecision(5)));
    return unit ? `${s} ${unit}` : s;
  };

  /* ---------- SVG 图案（深色墨线＋平涂，颜色走 CSS 变数；全部是程式里的常数，资料只能用名字挑） ---------- */
  const MOTIFS = {
    flask: '<path class="ink fc" d="M26 8h12v14l14 28q3 7-4 7H16q-7 0-4-7l14-28z"/><path class="ink fa" d="M20 38h24l8 12q3 7-4 7H16q-7 0-4-7z"/><circle class="bub b1 ink fc" cx="28" cy="46" r="3"/><circle class="bub b2 ink fc" cx="38" cy="44" r="2.2"/><circle class="bub b3 ink fc" cx="33" cy="49" r="1.8"/><path class="ink" d="M24 8h16"/>',
    beaker: '<path class="ink fc" d="M15 10h34v42q0 5-5 5H20q-5 0-5-5z"/><path class="ink fa" d="M15 30h34v22q0 5-5 5H20q-5 0-5-5z"/><path class="ink" d="M15 18h8M15 24h5M15 36h8M15 42h5"/><circle class="bub b1 ink fc" cx="30" cy="46" r="2.6"/><circle class="bub b2 ink fc" cx="40" cy="42" r="2"/>',
    balloon: '<ellipse class="ink fa" cx="32" cy="24" rx="16" ry="19"/><path class="ink fa" d="M29 43h6l-3 5z"/><path class="ink" d="M32 48q-6 4 0 8t0 6"/><path class="ink" d="M24 16q2-5 7-6"/>',
    tubes: '<g class="swing"><path class="ink fc" d="M14 10h12v34a6 6 0 0 1-12 0z"/><path class="ink fa" d="M14 30h12v14a6 6 0 0 1-12 0z"/></g><path class="ink fc" d="M36 14h12v30a6 6 0 0 1-12 0z"/><path class="ink fb" d="M36 34h12v10a6 6 0 0 1-12 0z"/><path class="ink" d="M10 10h20M32 14h20"/><circle class="bub b1 ink fc" cx="20" cy="38" r="2"/>',
    factory: '<path class="ink fb" d="M8 56V32l13 8V32l13 8V24h18v32z"/><path class="ink fc" d="M40 24V10h9v14"/><path class="ink" d="M14 48h6M26 48h6M38 36h8M38 44h8"/><circle class="smoke s1 ink fc" cx="44" cy="8" r="4"/><circle class="smoke s2 ink fc" cx="50" cy="3" r="3"/>',
    electrolysis: '<path class="ink fc" d="M12 22h40v30q0 5-5 5H17q-5 0-5-5z"/><path class="ink fd" d="M12 30h40v22q0 5-5 5H17q-5 0-5-5z"/><path class="ink fb" d="M22 8h6v34h-6zM38 8h6v34h-6z"/><circle class="bub b1 ink fc" cx="25" cy="30" r="2.4"/><circle class="bub b2 ink fc" cx="41" cy="34" r="2.4"/><circle class="bub b3 ink fc" cx="25" cy="40" r="1.8"/><path class="ink" d="M25 8V3h16v5"/>',
    molecule: '<path class="ink" d="M16 44l16-22 16 22M16 44h32"/><circle class="ink fa" cx="32" cy="20" r="9"/><circle class="ink fb" cx="14" cy="46" r="8"/><circle class="ink fc" cx="50" cy="46" r="8"/>',
    tetra: '<path class="ink" d="M32 30L14 46M32 30L50 46M32 30L32 10M32 30l8 22"/><circle class="ink fa" cx="32" cy="30" r="9"/><circle class="ink fc" cx="13" cy="47" r="6"/><circle class="ink fc" cx="51" cy="47" r="6"/><circle class="ink fc" cx="32" cy="9" r="6"/><circle class="ink fb" cx="41" cy="54" r="5"/>',
    bubbles: '<circle class="ink fa" cx="14" cy="22" r="9"/><circle class="ink fc" cx="6" cy="34" r="4.5"/><circle class="ink fc" cx="22" cy="34" r="4.5"/><circle class="ink fa" cx="48" cy="40" r="9"/><circle class="ink fc" cx="40" cy="28" r="4.5"/><circle class="ink fc" cx="56" cy="28" r="4.5"/><path class="ink dash" d="M24 30q10 6 14 0"/>',
    crystal: '<path class="ink" d="M14 14h36M14 32h36M14 50h36M14 14v36M32 14v36M50 14v36"/><circle class="ink fa" cx="14" cy="14" r="6"/><circle class="ink fb" cx="32" cy="14" r="6"/><circle class="ink fa" cx="50" cy="14" r="6"/><circle class="ink fb" cx="14" cy="32" r="6"/><circle class="ink fa" cx="32" cy="32" r="6"/><circle class="ink fb" cx="50" cy="32" r="6"/><circle class="ink fa" cx="14" cy="50" r="6"/><circle class="ink fb" cx="32" cy="50" r="6"/><circle class="ink fa" cx="50" cy="50" r="6"/>',
    energy: '<path class="ink" d="M8 52V8M8 52h48"/><path class="ink fa" d="M8 44q10 0 14-16t14-14 8 24 14 10v-4H8z"/><path class="ink" d="M14 6l-6-4-2 8"/>',
    stopwatch: '<circle class="ink fc" cx="32" cy="35" r="20"/><path class="ink" d="M28 9h8M32 9v6M48 17l4-4"/><path class="ink" d="M32 35V23"/><path class="hand ink" d="M32 35l9 5"/><circle class="ink fa" cx="32" cy="35" r="3"/>',
    equilibrium: '<path class="ink fa" d="M8 24h38v-8l12 12-12 12v-8H8z"/><path class="ink fb" d="M56 48H18v-8L6 52l12 12v-8h38z" transform="translate(0 -12)"/>',
    chain: '<path class="ink" d="M8 44l12-18 12 18 12-18 12 18"/><circle class="ink fa" cx="8" cy="44" r="6"/><circle class="ink fb" cx="20" cy="26" r="6"/><circle class="ink fa" cx="32" cy="44" r="6"/><circle class="ink fb" cx="44" cy="26" r="6"/><circle class="ink fa" cx="56" cy="44" r="6"/>',
    flame: '<path class="ink fc" d="M20 58h24l-3-14H23z"/><path class="ink" d="M32 44V40"/><path class="flick ink fb" d="M32 40c-10-6-12-16-6-28 4 6 6 8 10 6 2 8 8 12 2 20-1 2-3 3-6 2z"/><path class="flick2 ink fa" d="M32 38c-4-3-4-8-1-13 3 3 6 6 1 13z"/>',
    ladder: '<path class="ink fb" d="M6 56V44h14V32h14V20h14V8h10v48z"/><path class="ink" d="M20 44v12M34 32v24M48 20v36"/><circle class="ink fa" cx="52" cy="8" r="0"/><path class="ink fa" d="M44 6h14M51 -1v14"/>',
    nitrogen: '<path class="ink" d="M32 28L14 44M32 28L50 44M32 28V12"/><circle class="ink fa" cx="32" cy="30" r="11"/><circle class="ink fc" cx="13" cy="46" r="6"/><circle class="ink fc" cx="51" cy="46" r="6"/><circle class="ink fc" cx="32" cy="10" r="6"/><circle class="bub b1 ink fd" cx="52" cy="14" r="3"/><circle class="bub b2 ink fd" cx="58" cy="24" r="2"/>',
    testtube: '<g class="swing"><path class="ink fc" d="M26 6h12v38a6 6 0 0 1-12 0z"/><path class="ink fb" d="M26 34h12v10a6 6 0 0 1-12 0z"/></g><path class="ink" d="M22 6h20"/><circle class="ink fb" cx="14" cy="52" r="3"/><circle class="ink fb" cx="50" cy="54" r="2.4"/><circle class="ink fb" cx="52" cy="46" r="2"/>',
    route: '<path class="ink dash" d="M8 54q22-4 14-18T40 28t14-14"/><circle class="ink fb" cx="8" cy="54" r="5"/><circle class="ink fc" cx="22" cy="36" r="4"/><circle class="ink fc" cx="40" cy="28" r="4"/><path class="ink" d="M54 14V2"/><path class="ink fa" d="M54 2l10 4-10 4z"/>',
    balance: '<path class="ink" d="M32 10v44M20 54h24"/><path class="ink" d="M10 22h44"/><path class="ink fa" d="M4 34q6 8 12 0z"/><path class="ink" d="M10 22l-6 12M10 22l6 12"/><path class="ink fb" d="M48 34q6 8 12 0z"/><path class="ink" d="M54 22l-6 12M54 22l6 12"/><circle class="ink fc" cx="32" cy="10" r="3"/>',
    flag: '<path class="ink" d="M14 60V6"/><g class="wave"><path class="ink fa" d="M14 8q12-6 20 0t20 0v22q-10 6-20 0t-20 0z"/></g><path class="ink fb" d="M32 14l2.4 5 5.4.7-4 3.7 1 5.3-4.8-2.6-4.8 2.6 1-5.3-4-3.7 5.4-.7z"/><circle class="ink fc" cx="14" cy="6" r="3"/>',
    benzene: '<path class="ink fc" d="M32 6l22 13v26L32 58 10 45V19z"/><path class="ink" d="M32 14l15 9v18l-15 9-15-9V23z"/><path class="ink fa" d="M32 22l8 5v10l-8 5-8-5V27z"/><path class="ink" d="M32 6V0M54 19l6-3M10 19l-6-3"/>',
    refinery: '<path class="ink fc" d="M24 6h16v50H24z"/><path class="ink fa" d="M24 18h16v9H24z"/><path class="ink fb" d="M24 34h16v9H24z"/><path class="ink" d="M40 22h12v-8M24 12h-10v14M40 38h10"/><path class="ink fa" d="M52 42q7 9 0 14t-7-6z"/><circle class="bub b1 ink fc" cx="32" cy="5" r="2.4"/>',
    torch: '<path class="ink fc" d="M4 34h24v11H4z"/><path class="ink fb" d="M28 36h10v7H28z"/><path class="ink fa" d="M9 45v12h9V45"/><path class="flick ink fd" d="M38 39.5c8-5 15-3 22 0-7 4-14 5-22 0z"/><path class="flick2 ink fc" d="M40 39.5c6-2 10-1 14 0-4 2-9 3-14 0z"/>',
    lamp: '<path class="ink fc" d="M12 38q0-9 20-9t20 9v11q0 8-20 8t-20-8z"/><path class="ink fa" d="M14 43q18 6 36 0v6q0 7-18 7t-18-7z"/><path class="ink fb" d="M26 29h12l2-7H24z"/><path class="ink" d="M32 22v-4"/><path class="flick ink fb" d="M32 18c-6-4-5-10 0-15 5 5 6 11 0 15z"/><path class="flick2 ink fd" d="M32 16c-3-2-3-5 0-8 3 3 3 6 0 8z"/><path class="ink" d="M20 36q2-3 6-3"/>',
    magnifier: '<circle class="ink fc" cx="26" cy="26" r="17"/><circle class="ink fd" cx="26" cy="26" r="11"/><path class="ink" d="M18 22q3-6 9-6"/><path class="ink fb" d="M39 39l7-7 12 12q3 3 0 6t-6 0z"/><circle class="bub b1 ink fa" cx="29" cy="30" r="2.6"/>',
    polymer: '<path class="ink" d="M10 12H5v40h5M54 12h5v40h-5"/><path class="ink" d="M12 40q10-22 20-8t20-14"/><circle class="ink fa" cx="12" cy="40" r="6"/><circle class="ink fc" cx="22" cy="28" r="6"/><circle class="ink fa" cx="32" cy="32" r="6"/><circle class="ink fc" cx="42" cy="23" r="6"/><circle class="ink fa" cx="52" cy="18" r="6"/>',
    syringe: '<rect class="ink fc" x="12" y="24" width="34" height="18" rx="3"/><path class="ink" d="M12 33H3M3 26v14M46 33h13"/><rect class="ink fb" x="14" y="26" width="7" height="14" rx="1.5"/><circle class="bub b1 ink fa" cx="29" cy="33" r="2.6"/><circle class="bub b2 ink fa" cx="37" cy="30" r="2.6"/><circle class="bub b3 ink fa" cx="35" cy="38" r="2.6"/><circle class="ink fc" cx="32" cy="10" r="8"/><path class="ink" d="M32 10l4-4M32 18v6"/>',
    cylinder: '<path class="ink fc" d="M19 14q0-8 13-8t13 8v38q0 6-13 6t-13-6z"/><circle class="bub b1 ink fa" cx="27" cy="22" r="4.4"/><circle class="bub b2 ink fb" cx="37" cy="32" r="4.4"/><circle class="bub b3 ink fd" cx="27" cy="43" r="4.4"/><path class="ink fb" d="M27 6V2h10v4"/><path class="ink" d="M45 18h8"/><circle class="ink fc" cx="55" cy="18" r="4"/>',
  };
  const ICON = {
    lock: '<rect class="ink fb" x="14" y="28" width="36" height="28" rx="5"/><path class="ink" d="M21 28V20a11 11 0 0 1 22 0v8"/><circle class="ink fc" cx="32" cy="41" r="3.5"/>',
    star: '<path class="ink fb" d="M32 6l7.5 15.5 17 2.4-12.3 11.9 2.9 16.9L32 44.8l-15.1 7.9 2.9-16.9L7.5 23.9l17-2.4z"/>',
    starOff: '<path class="ink fc" d="M32 6l7.5 15.5 17 2.4-12.3 11.9 2.9 16.9L32 44.8l-15.1 7.9 2.9-16.9L7.5 23.9l17-2.4z"/>',
  };
  const svgOf = (body, cls) => {
    const wrap = document.createElement('span');
    wrap.innerHTML = `<svg class="tm-svg ${cls || ''}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">${body}</svg>`;
    return wrap.firstChild;
  };
  const motifSvg = (name, cls) => svgOf(has(MOTIFS, name) ? MOTIFS[name] : MOTIFS.flask, cls);

  // 你给的插画：放进 assets/teach/（<种类>-<id>.webp，种类 = cover／node／boss），名字登记在 assets/teach/manifest.json，
  // 登记了的才会去载入；没登记的关卡继续用上面的内置 SVG。清单与提示词见 docs/ART_BRIEF.md
  async function loadArt() {
    if (state.art) return state.art;
    let files = [];
    try {
      const res = await fetch('/assets/teach/manifest.json', { cache: 'no-cache' });
      const j = res.ok ? await res.json() : null;
      if (j && Array.isArray(j.files)) files = j.files.filter(f => typeof f === 'string');
    } catch (e) { /* 没有清单或没网络：全部用内置图案 */ }
    state.art = new Set(files);
    return state.art;
  }
  function artImg(kind, id, cls) {
    const file = `${kind}-${id}.webp`;
    if (!state.art || !state.art.has(file)) return null;
    const img = h('img', { class: `tm-art-img ${cls || ''}`, src: `/assets/teach/${file}`, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => img.remove());
    return img;
  }

  /* ---------- 资料 ---------- */
  const cache = {};
  async function loadData(subject) {
    if (cache[subject]) return cache[subject];
    const res = await fetch(`/data/teach/${subject}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (!data || !Array.isArray(data.maps)) throw new Error('format');
    cache[subject] = data;
    return data;
  }
  const nodeIndex = map => Object.fromEntries(map.nodes.map(n => [n.id, n]));
  const sectionOfNode = (map, nodeId) => map.sections.find(s => s.nodes.includes(nodeId));
  const sectionOfBoss = (map, bossId) => map.sections.find(s => s.boss === bossId);
  const bossOf = (map, id) => (map.bosses || []).find(b => b.id === id);
  const kindsOf = challenges => KIND_ORDER.filter(k => challenges.some(c => c.type === k));

  // 一个小节的魔王关视为「已通关」：魔王关本身过了，或该小节每一关都过了
  function bossCleared(subject, map, boss) {
    if (starsOf(subject, boss.id) > 0) return true;
    const sec = sectionOfBoss(map, boss.id);
    return !!sec && sec.nodes.every(id => starsOf(subject, id) > 0);
  }
  function clearedId(subject, map, id) {
    const boss = bossOf(map, id);
    return boss ? bossCleared(subject, map, boss) : starsOf(subject, id) > 0;
  }
  // 有星的关永远可以进（亲手通关、跳级都算）：越级打赢某个小节的魔王後，那个小节的每一关都开放，不管前面的小节过没过
  const isLocked = (subject, map, node) => starsOf(subject, node.id) === 0 && !node.parents.every(p => clearedId(subject, map, p));
  function lockReason(subject, map, node) {
    const names = node.parents.filter(p => !clearedId(subject, map, p)).map(p => {
      const b = bossOf(map, p); const n = b || nodeIndex(map)[p];
      return n ? `「${n.title}」` : '';
    }).filter(Boolean);
    return `先通过 ${names.join('、')}，或直接挑战魔王关跳级。`;
  }
  function mapStats(subject, map) {
    const total = map.nodes.length;
    const done = map.nodes.filter(n => starsOf(subject, n.id) > 0).length;
    const stars = map.nodes.reduce((a, n) => a + starsOf(subject, n.id), 0) + (map.bosses || []).reduce((a, b) => a + starsOf(subject, b.id), 0);
    return { total, done, stars };
  }

  /* ---------- 画面状态 ---------- */
  let state = { subject: null, data: null, mapId: null, cams: {}, view: null, celebrate: null, art: null, msg: null };
  let sheet = null;   // 目前开着的面板

  function setCrumbs(items) {
    const nav = document.getElementById('breadcrumbNav');
    if (!nav) return;
    clear(nav);
    items.forEach((it, i) => {
      if (i) nav.append(' > ');
      nav.append(it.onClick
        ? h('button', { type: 'button', class: 'breadcrumb-item', onclick: it.onClick, text: it.label })
        : h('span', { class: 'breadcrumb-item active', 'aria-current': 'page', text: it.label }));
    });
  }
  const goHome = () => { if (typeof window.navigateHome === 'function') window.navigateHome(); };

  function draftBanner() {
    return SHOW_DRAFT_BADGE ? h('p', { class: 'tm-draft', text: '草稿版：题目是照老师的 PPT 笔记整理的，还在审核中，欢迎告诉我哪里不对。' }) : null;
  }

  /* ---------- 地图选择页 ---------- */
  function renderHome() {
    const { subject, data } = state;
    state.mapId = null;
    state.view = null;
    setCrumbs([{ label: '主页', onClick: goHome }, { label: `${SUBJECT_NAME[subject] || subject} · 教学` }]);
    const box = clear(root());
    box.className = 'tm-root';
    box.style.removeProperty('--tm-accent');
    const cards = data.maps.map(m => {
      const st = mapStats(subject, m);
      const card = h('button', { type: 'button', class: 'tm-card', style: `--tm-accent:${m.accent}`, onclick: () => { sound('pop'); openMap(m.id); } },
        h('span', { class: 'tm-card-art' }, artImg('cover', m.id, 'tm-cover') || motifSvg(m.cover || 'flask', 'tm-art')),
        h('span', { class: 'tm-card-body' },
          h('span', { class: 'tm-card-title', text: m.title }),
          h('span', { class: 'tm-card-tag', text: m.tagline }),
          h('span', { class: 'tm-card-blurb', text: m.blurb }),
          h('span', { class: 'tm-card-prog' },
            h('span', { class: 'tm-bar', 'aria-hidden': 'true' }, h('i', { style: `width:${st.total ? Math.round(st.done / st.total * 100) : 0}%` })),
            h('span', { text: `已通关 ${st.done} / ${st.total} 关 · 累计 ${st.stars} 颗星` })),
          h('span', { class: 'tm-go', text: st.done ? '继续闯关' : '出发' })));
      return card;
    });
    put(box, 
      h('h2', { class: 'page-heading tm-title', text: `${SUBJECT_NAME[subject] || subject} · 教学` }),
      h('p', { class: 'page-hint', text: '三张地图，从简单走到难。每一关先看知识卡再闯关；想跳级，就去挑战每个小节尽头的魔王关。' }),
      draftBanner(),
      h('div', { class: 'tm-cards' }, cards));
  }

  /* ---------- 地图页（可拖拽、可缩放的思维导图画布） ---------- */
  // 宽屏左→右：起点在最左，每个小节是一块底板，关卡依 row 往右排、依 col 分上中下三条泳道；
  // 窄屏（手机竖拿）整张图转成上→下。小节可以折叠成一座「小岛」：进来只展开你现在在学的那一区，其余收起，整张图一眼看得完。
  // 各数字的意义见 docs/CUSTOMIZE.md「教学地图的画布」。
  const DIM = {
    h: { cw: 188, ch: 108, rank: 64, lane: 28, root: 200, island: [236, 120] },   // 宽屏：卡片宽高、前後关间距、并排关间距、起点、小岛
    v: { cw: 132, ch: 128, rank: 60, lane: 14, root: 160, island: [252, 104] },   // 手机竖拿
  };
  const HEAD_H = 44, PAD = 24;

  // 现在该玩哪一关：依小节顺序、依 row，第一个没星又没锁的
  function nextNode(subject, map) {
    const idx = nodeIndex(map);
    for (const sec of map.sections) {
      const n = sec.nodes.map(id => idx[id]).sort((a, b) => a.row - b.row || a.col - b.col)
        .find(x => starsOf(subject, x.id) === 0 && !isLocked(subject, map, x));
      if (n) return n;
    }
    return null;
  }
  // 卡片上的一句话重点：资料里有 gist 就用 gist，没有就用知识卡的「记住」那句
  const gistOf = it => it.gist || (it.lesson && it.lesson.tip ? it.lesson.tip.replace(/[。.]$/, '') : '')
    || `${BOSS_POOL + 1} 题答对 ${needed(BOSS_POOL + 1, BOSS_RATIO)} 题，整个小节免修`;
  const sectionNo = i => `第 ${'一二三四五六七八'[i] || i + 1} 区`;
  const sectionDone = (subject, map, sec) => sec.nodes.filter(id => starsOf(subject, id) > 0).length;

  function layout(map, expanded, horiz) {
    const D = horiz ? DIM.h : DIM.v;
    const along = (w, h) => (horiz ? w : h);                  // 「往前走」那个方向的长度
    const rankStep = along(D.cw, D.ch) + D.rank;
    const laneStep = (horiz ? D.ch : D.cw) + D.lane;
    const off = horiz ? HEAD_H + 32 : PAD;                     // 泳道从哪里开始（宽屏上方放小节标题，再留一段给「你在这里」小精灵）
    const head = horiz ? 0 : HEAD_H + 24;                      // 窄屏：小节标题占一行在开头
    const place = (a, c, w, h) => (horiz ? { x: a, y: c - h / 2, w, h } : { x: c - w / 2, y: a, w, h });
    const mid = off + laneStep * 1.5;                          // 中线：起点和小岛放这里
    const rects = {};
    const regions = [];
    rects.root = place(0, mid, D.root, D.root);
    let cursor = D.root + REGION_GAP;
    const idx = nodeIndex(map);
    map.sections.forEach((sec, si) => {
      const boss = bossOf(map, sec.boss);
      const items = [...sec.nodes.map(id => idx[id]), boss];
      const minRow = Math.min(...items.map(i => i.row));
      if (expanded.has(sec.id)) {
        const maxRank = Math.max(...items.map(i => i.row - minRow));
        items.forEach(it => {
          const isBoss = it.id === sec.boss;
          const w = D.cw + (isBoss ? 24 : 0), h = D.ch + (isBoss ? 12 : 0);
          rects[it.id] = place(cursor + PAD + head + (it.row - minRow) * rankStep, off + it.col * laneStep, w, h);
        });
        const len = PAD * 2 + head + maxRank * rankStep + along(D.cw + 24, D.ch + 12);
        const span = laneStep * 3;
        const plate = horiz ? { x: cursor, y: 0, w: len, h: off + span + 14 } : { x: 0, y: cursor, w: span + PAD * 2, h: len };
        regions.push({ sec, si, open: true, plate, head: { x: plate.x + 12, y: plate.y + 8 } });
        cursor += len + REGION_GAP;
      } else {
        const [iw, ih] = D.island;
        const r = place(cursor, mid, iw, ih);
        rects[`region:${sec.id}`] = r;
        regions.push({ sec, si, open: false, island: r });
        cursor += along(r.w, r.h) + REGION_GAP;
      }
    });
    const all = [...Object.values(rects), ...regions.filter(r => r.plate).map(r => r.plate)];
    return { rects, regions, W: Math.max(...all.map(r => r.x + r.w)) + PAD, H: Math.max(...all.map(r => r.y + r.h)) + PAD };
  }

  function edgePath(a, b, horiz) {
    if (horiz) {
      const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, dx = Math.max(36, (x2 - x1) / 2);
      return `M${x1} ${y1} C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
    }
    const x1 = a.x + a.w / 2, y1 = a.y + a.h, x2 = b.x + b.w / 2, y2 = b.y, dy = Math.max(30, (y2 - y1) / 2);
    return `M${x1} ${y1} C${x1} ${y1 + dy} ${x2} ${y2 - dy} ${x2} ${y2}`;
  }

  /* ---- 镜头：拖拽、缩放、飞行 ---- */
  const clampK = k => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, k));
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  function applyCam() {
    const v = state.view; if (!v) return;
    const c = v.cam;
    v.world.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.k})`;
    v.stage.dataset.zoom = c.k < ZOOM_FAR ? 'far' : c.k < ZOOM_NEAR ? 'mid' : 'near';
    v.stage.style.backgroundPosition = `${c.x}px ${c.y}px`;                       // 点阵底纹跟着镜头走
    v.stage.style.backgroundSize = `${16 * c.k}px ${16 * c.k}px, auto`;
    state.cams[state.mapId] = { x: c.x, y: c.y, k: c.k, expanded: [...v.expanded] };
  }
  function clampCam() {   // 图至少要留一角在画面里，不会被拖丢
    const v = state.view, c = v.cam, m = 80;
    c.x = Math.min(v.stage.clientWidth - m, Math.max(m - v.W * c.k, c.x));
    c.y = Math.min(v.stage.clientHeight - m, Math.max(m - v.H * c.k, c.y));
  }
  function stopFly() { const v = state.view; if (v && v.fly) { cancelAnimationFrame(v.fly); v.fly = 0; } }
  function zoomAt(px, py, k2) {
    const v = state.view, c = v.cam; k2 = clampK(k2);
    const r = k2 / c.k; c.x = px - (px - c.x) * r; c.y = py - (py - c.y) * r; c.k = k2;
    clampCam(); applyCam();
  }
  const zoomBy = f => { stopFly(); const s = state.view.stage; zoomAt(s.clientWidth / 2, s.clientHeight / 2, state.view.cam.k * f); };
  // 把世界坐标 (wx, wy) 放到画面中央，缩放到 k；ms = 0 就是瞬移
  function flyTo(wx, wy, k, ms = FLY_MS) {
    const v = state.view; if (!v) return;
    stopFly();
    k = clampK(k);
    const c = v.cam, to = { x: v.stage.clientWidth / 2 - wx * k, y: v.stage.clientHeight / 2 - wy * k, k };
    if (!ms || reduced()) { Object.assign(c, to); clampCam(); applyCam(); return; }
    const from = { ...c }, t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / ms), e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      c.x = from.x + (to.x - from.x) * e; c.y = from.y + (to.y - from.y) * e; c.k = from.k + (to.k - from.k) * e;
      clampCam(); applyCam();
      v.fly = t < 1 ? requestAnimationFrame(step) : 0;
    };
    v.fly = requestAnimationFrame(step);
  }
  function flyToRect(r, maxK, ms) {   // 缩放到刚好装下这个矩形（不超过 maxK、不小于 0.5）
    const v = state.view, pad = FIT_PAD * 2;
    if (!v.stage.clientWidth) return;
    const k = Math.max(0.5, Math.min(maxK, (v.stage.clientWidth - pad) / r.w, (v.stage.clientHeight - pad) / r.h));
    flyTo(r.x + r.w / 2, r.y + r.h / 2, k, ms);
  }
  function fitAll(ms) {
    const v = state.view, pad = FIT_PAD * 2;
    if (!v.stage.clientWidth) return;
    const k = Math.min(1, (v.stage.clientWidth - pad) / v.W, (v.stage.clientHeight - pad) / v.H);
    flyTo(v.W / 2, v.H / 2, Math.max(ZOOM_MIN, k), ms);
  }
  function revealRect(r) {   // 键盘 Tab 到画面外的关卡时，镜头平移过去（不改缩放）
    const v = state.view, c = v.cam, m = 28;
    const x = r.x * c.k + c.x, y = r.y * c.k + c.y, w = r.w * c.k, h = r.h * c.k;
    let dx = 0, dy = 0;
    if (x < m) dx = m - x; else if (x + w > v.stage.clientWidth - m) dx = v.stage.clientWidth - m - (x + w);
    if (y < m) dy = m - y; else if (y + h > v.stage.clientHeight - m) dy = v.stage.clientHeight - m - (y + h);
    if (dx || dy) flyTo((v.stage.clientWidth / 2 - c.x - dx) / c.k, (v.stage.clientHeight / 2 - c.y - dy) / c.k, c.k, 220);
  }

  function wireStage(stage) {
    const ptrs = new Map();
    let drag = null, pinch = null, moved = false, suppress = false;
    const v = () => state.view;
    const pinchStart = () => {
      const [a, b] = [...ptrs.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: v().cam.k };
    };
    stage.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      stopFly();
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) { drag = { sx: e.clientX, sy: e.clientY, cx: v().cam.x, cy: v().cam.y }; moved = false; }
      else if (ptrs.size === 2) { pinchStart(); moved = true; }
    });
    stage.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const c = v().cam;
      if (ptrs.size === 2 && pinch) {
        const [a, b] = [...ptrs.values()], r = stage.getBoundingClientRect();
        zoomAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top, pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
        return;
      }
      if (!drag || ptrs.size !== 1) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (!moved) {
        if (Math.hypot(dx, dy) < DRAG_PX) return;
        moved = true; stage.classList.add('is-dragging');
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 抓不到也能拖 */ }
      }
      c.x = drag.cx + dx; c.y = drag.cy + dy; clampCam(); applyCam();
    });
    const end = e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (ptrs.size === 0) { suppress = moved; drag = null; stage.classList.remove('is-dragging'); setTimeout(() => { suppress = false; }, 0); }
      else if (ptrs.size === 1) { const p = [...ptrs.values()][0]; drag = { sx: p.x, sy: p.y, cx: v().cam.x, cy: v().cam.y }; moved = true; }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('click', e => { if (suppress) { e.stopPropagation(); e.preventDefault(); } }, true);   // 拖完松手不算点了关卡
    stage.addEventListener('wheel', e => {   // 只在 Ctrl／⌘（含触控板捏合）时缩放；单纯滚轮不拦截，页面照常滚动
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault(); stopFly();
      const r = stage.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, v().cam.k * Math.exp(-e.deltaY * 0.0022));
    }, { passive: false });
    stage.addEventListener('dblclick', e => {
      if (e.target.closest('button, .tm-hud')) return;
      const r = stage.getBoundingClientRect(); stopFly();
      zoomAt(e.clientX - r.left, e.clientY - r.top, v().cam.k * ZOOM_STEP);
    });
    stage.addEventListener('keydown', e => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const c = v().cam, s = (e.shiftKey ? 3 : 1) * 90;
      const pan = (dx, dy) => { e.preventDefault(); stopFly(); c.x += dx; c.y += dy; clampCam(); applyCam(); };
      if (e.key === 'ArrowLeft') pan(s, 0); else if (e.key === 'ArrowRight') pan(-s, 0);
      else if (e.key === 'ArrowUp') pan(0, s); else if (e.key === 'ArrowDown') pan(0, -s);
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(ZOOM_STEP); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / ZOOM_STEP); }
      else if (e.key === '0') { e.preventDefault(); fitAll(); }
    });
    stage.addEventListener('focusin', e => {
      const el = e.target.closest && e.target.closest('[data-rect]');
      const r = el && v().rects[el.dataset.rect];
      if (r) revealRect(r);
    });
  }

  /* ---- 画出整张图 ---- */
  function buildWorld() {
    const v = state.view, { subject } = state, map = v.map;
    const horiz = !v.stage.clientWidth || v.stage.clientWidth >= HORIZONTAL_MIN;
    const L = layout(map, v.expanded, horiz);
    Object.assign(v, { horiz, rects: L.rects, W: L.W, H: L.H, plates: {} });
    const world = clear(v.world);
    world.dataset.axis = horiz ? 'h' : 'v';
    world.style.width = `${L.W}px`; world.style.height = `${L.H}px`;
    const box = r => `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
    const idx = nodeIndex(map);
    const st = mapStats(subject, map);

    // 小节底板（展开的）
    L.regions.forEach(rg => {
      if (!rg.open) return;
      v.plates[rg.sec.id] = rg.plate;
      world.append(h('div', { class: 'tm-plate', 'aria-hidden': 'true', style: box(rg.plate) }));
    });

    // 连线：画在节点後面；还没通的虚线，通了的实线。小节折叠时，里面的线接到小岛上
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'tm-edges');
    svg.setAttribute('width', L.W); svg.setAttribute('height', L.H);
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    const anchor = id => { const sec = sectionOfNode(map, id) || sectionOfBoss(map, id); return sec && !v.expanded.has(sec.id) ? `region:${sec.id}` : id; };
    const edges = new Map();
    [...map.nodes, ...(map.bosses || [])].forEach(it => {
      const to = anchor(it.id);
      (it.parents.length ? it.parents : ['root']).forEach(pid => {
        const from = pid === 'root' ? 'root' : anchor(pid);
        if (from === to || !L.rects[from] || !L.rects[to]) return;
        const key = `${from}>${to}`, open = pid === 'root' || clearedId(subject, map, pid);
        edges.set(key, { from, to, open: open || (edges.get(key) || {}).open });
      });
    });
    edges.forEach(e => {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', edgePath(L.rects[e.from], L.rects[e.to], horiz));
      path.setAttribute('class', `tm-edge${e.open ? ' is-open' : ''}`);
      svg.appendChild(path);
    });
    world.append(svg);

    // 起点：地图封面＋通关进度环
    const rr = L.rects.root, pct = st.total ? st.done / st.total : 0, R = 46, C = 2 * Math.PI * R;
    const rootArt = artImg('cover', map.id, 'tm-art') || motifSvg(map.cover || 'flask', 'tm-art');
    const ring = svgOf(`<circle class="rg-bg" cx="50" cy="50" r="${R}"/><circle class="rg-fg" cx="50" cy="50" r="${R}" stroke-dasharray="${(C * pct).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 50 50)"/>`, 'tm-ring');
    ring.setAttribute('viewBox', '0 0 100 100');
    world.append(h('div', { class: 'tm-rootnode', 'data-rect': 'root', style: box(rr), role: 'group', 'aria-label': `${map.title}，已通关 ${st.done} / ${st.total} 关` },
      h('span', { class: 'tm-root-ring' }, ring, h('span', { class: 'tm-root-art' }, rootArt)),
      h('span', { class: 'tm-root-name', text: map.title }),
      h('span', { class: 'tm-root-prog', text: `${st.done} / ${st.total} 关 · ${st.stars} 颗星` })));

    // 小节标题（展开的）与小岛（折叠的）
    L.regions.forEach(rg => {
      const { sec, si } = rg, done = sectionDone(subject, map, sec), total = sec.nodes.length;
      const boss = bossOf(map, sec.boss), cleared = bossCleared(subject, map, boss);
      if (rg.open) {
        world.append(h('button', { type: 'button', class: `tm-region-head${cleared ? ' is-done' : ''}`, 'data-sec': sec.id, 'aria-expanded': 'true', 'aria-label': `${sectionNo(si)} ${plain(sec.title)}，已通关 ${done} / ${total} 关，点一下收起`,
          style: `left:${rg.head.x}px;top:${rg.head.y}px`, onclick: () => { sound('pop'); toggleRegion(sec.id); } },
        h('span', { class: 'tm-section-no', text: sectionNo(si) }), h('span', { class: 'tm-section-name', text: sec.title }),
        h('span', { class: 'tm-region-prog', text: `${done}/${total}` }), h('span', { class: 'tm-fold', 'aria-hidden': 'true', text: '收起' })));
        return;
      }
      const locked = sec.nodes.every(id => isLocked(subject, map, idx[id]));
      world.append(h('div', { class: `tm-island${locked ? ' is-locked' : ''}${cleared ? ' is-done' : ''}`, 'data-rect': `region:${sec.id}`, style: box(rg.island) },
        h('button', { type: 'button', class: 'tm-island-main', 'data-sec': sec.id, 'aria-expanded': 'false', 'aria-label': `${sectionNo(si)} ${plain(sec.title)}，已通关 ${done} / ${total} 关${locked ? '，还没解锁' : ''}，点一下展开`,
          onclick: () => { sound('pop'); toggleRegion(sec.id); } },
        h('span', { class: 'tm-section-no', text: sectionNo(si) }),
        h('span', { class: 'tm-island-name', text: sec.title }),
        h('span', { class: 'tm-island-prog' }, h('span', { class: 'tm-bar', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.round(done / total * 100)}%` })), h('span', { text: `${done}/${total}` })),
        h('span', { class: 'tm-fold', 'aria-hidden': 'true', text: locked ? '展开看看' : '展开' })),
        h('button', { type: 'button', class: `tm-node tm-island-boss${cleared ? ' is-done' : ''}`, 'data-id': boss.id, 'data-state': cleared ? 'done' : 'open', 'aria-label': `挑战${plain(boss.title)}，答对门槛后整个小节免修`,
          onclick: e => { sound('pop'); state.msg.textContent = ''; openBoss(map, boss, e.currentTarget); } },
        svgOf(MOTIFS.flag, 'tm-art'), h('span', { text: cleared ? '已免修' : '魔王' }))));
    });

    // 展开的小节里的关卡
    L.regions.forEach(rg => {
      if (!rg.open) return;
      [...rg.sec.nodes.map(id => idx[id]), bossOf(map, rg.sec.boss)].forEach(it => world.append(nodeCard(map, it, L.rects[it.id])));
    });

    // 「你在这里」：小精灵停在下一个可玩的关
    const nxt = nextNode(subject, map);
    if (nxt) {
      const key = v.expanded.has((sectionOfNode(map, nxt.id) || {}).id) ? nxt.id : `region:${(sectionOfNode(map, nxt.id) || {}).id}`;
      const r = L.rects[key];
      if (r) {
        const img = h('img', { src: '/assets/sprite/idle.webp', alt: '', width: '48', height: '48', decoding: 'async' });
        img.addEventListener('error', () => img.remove());
        world.append(h('div', { class: 'tm-pin', 'aria-hidden': 'true', style: `left:${horiz ? r.x + 10 : r.x + r.w - 62}px;top:${r.y - 58}px` }, img, h('span', { class: 'tm-pin-tag', text: '你在这里' })));
      }
    }
    v.nxt = nxt;
    if (v.next) {
      v.next.hidden = !nxt;
      if (nxt) v.next.textContent = `下一步：${plain(nxt.title)}`;
    }
    if (v.allBtn) v.allBtn.textContent = L.regions.every(rg => rg.open) ? '全部收起' : '全部展开';
    if (v.chips) refreshChips();
  }

  function nodeCard(map, it, r) {
    const { subject } = state, v = state.view;
    const isBoss = !!bossOf(map, it.id);
    const locked = !isBoss && isLocked(subject, map, it);
    const stars = starsOf(subject, it.id);
    const rec = progressOf(subject)[it.id];
    const bossDone = isBoss && bossCleared(subject, map, it);
    const done = isBoss ? bossDone : stars > 0;
    const skipped = !isBoss && rec && rec.k === 's';
    const stateName = locked ? 'locked' : done ? 'done' : 'open';
    const kinds = isBoss ? [] : kindsOf(it.challenges);
    const aria = isBoss
      ? `${it.title}，魔王关，${bossDone ? '已通关' : '随时可以挑战，通过可免修本小节'}`
      : `${it.title}，${kinds.map(k => KIND_LABEL[k]).join('、')}，${locked ? '未解锁' : done ? `已通关，${stars} 颗星${skipped ? '（跳级）' : ''}` : '可以挑战'}`;
    const art = locked ? svgOf(ICON.lock, 'tm-art') : (artImg(isBoss ? 'boss' : 'node', it.id, 'tm-art') || motifSvg(it.motif, 'tm-art'));
    const btn = h('button', { type: 'button', class: `tm-node tm-ncard${isBoss ? ' is-boss' : ''}`, 'data-state': stateName, 'data-id': it.id, 'data-rect': it.id,
      'aria-label': plain(aria), title: plain(it.title), 'aria-disabled': locked ? 'true' : null, style: `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px` },
    h('span', { class: 'tm-disc' }, h('span', { class: 'tm-disc-art' }, art)),
    h('span', { class: 'tm-text' },
      h('span', { class: 'tm-name', text: it.title }),
      h('span', { class: 'tm-gist', text: gistOf(it) }),
      h('span', { class: 'tm-meta' },
        h('span', { class: `tm-chip ${isBoss ? 'tm-chip-boss' : 'tm-chip-tier'}`, text: isBoss ? '魔王关' : TIER_LABEL[it.tier] || '' }),
        isBoss
          ? h('span', { class: 'tm-sub', text: bossDone ? starsText(stars) || '已免修' : '免修本小节' })
          : h('span', { class: 'tm-stars', 'aria-hidden': 'true' }, [1, 2, 3].map(i => svgOf(i <= stars ? ICON.star : ICON.starOff, 'tm-star'))))),
    skipped ? h('span', { class: 'tm-skip', text: '跳级' }) : null);
    btn.addEventListener('click', () => {
      if (locked) { sound('wrong'); state.msg.textContent = lockReason(subject, map, it); return; }
      state.msg.textContent = '';
      sound('pop');
      if (isBoss) openBoss(map, it, btn); else openLesson(map, it, btn);
    });
    return btn;
  }

  function toggleRegion(secId, force) {
    const v = state.view, open = v.expanded.has(secId), want = force === undefined ? !open : force;
    if (want === open) { focusRegion(secId, 360); return; }
    if (want) v.expanded.add(secId); else v.expanded.delete(secId);
    buildWorld();
    focusRegion(secId, 360);
    const el = v.world.querySelector(want ? `.tm-region-head[data-sec="${secId}"]` : `.tm-island-main[data-sec="${secId}"]`);
    if (el) el.focus({ preventScroll: true });   // 键盘用户按完 Enter，焦点留在刚才那个位置
  }
  function focusRegion(secId, ms) {
    const v = state.view, r = v.plates[secId] || v.rects[`region:${secId}`];
    if (r) flyToRect(r, 1, ms);
  }
  function refreshChips() {
    const v = state.view, { subject } = state, map = v.map;
    [...v.chips.children].forEach((b, i) => {
      const sec = map.sections[i], boss = bossOf(map, sec.boss);
      b.classList.toggle('is-open', v.expanded.has(sec.id));
      b.classList.toggle('is-done', bossCleared(subject, map, boss));
    });
  }

  // 通关回到地图：镜头飞到刚解锁的关，那几关弹一下
  function runCelebrate() {
    const c = state.celebrate; state.celebrate = null;
    const v = state.view;
    if (!c || !v || !c.ids.length || !document.contains(v.stage)) return false;
    const sec = sectionOfNode(v.map, c.ids[0]);
    if (sec && !v.expanded.has(sec.id)) { v.expanded.add(sec.id); buildWorld(); }
    const r = v.rects[c.ids[0]];
    if (r) flyTo(r.x + r.w / 2, r.y + r.h / 2, Math.max(v.cam.k, 0.9));
    c.ids.forEach(id => {
      const n = v.world.querySelector(`.tm-node[data-id="${id}"]`);
      if (n) { n.classList.add('is-new'); setTimeout(() => n.classList.remove('is-new'), 4200); }
    });
    const first = v.world.querySelector(`.tm-node[data-id="${c.ids[0]}"]`);
    if (first) first.focus({ preventScroll: true });
    return true;
  }

  function goNext() {
    const v = state.view, nxt = v.nxt; if (!nxt) return;
    const sec = sectionOfNode(v.map, nxt.id);
    if (sec && !v.expanded.has(sec.id)) { v.expanded.add(sec.id); buildWorld(); }
    const r = v.rects[nxt.id];
    flyTo(r.x + r.w / 2, r.y + r.h / 2, Math.max(v.cam.k, 0.9));
    const btn = v.world.querySelector(`.tm-node[data-id="${nxt.id}"]`);
    setTimeout(() => { if (state.view === v && btn && document.contains(btn)) btn.click(); }, reduced() ? 0 : FLY_MS + 60);
  }

  function openMap(mapId, opts = {}) {
    const { subject, data } = state;
    const map = data.maps.find(m => m.id === mapId);
    if (!map) return renderHome();
    state.mapId = mapId;
    setCrumbs([{ label: '主页', onClick: goHome },
      { label: `${SUBJECT_NAME[subject] || subject} · 教学`, onClick: () => { sound('pop'); renderHome(); } },
      { label: map.title }]);
    const box = clear(root());
    box.className = 'tm-root';
    box.style.setProperty('--tm-accent', map.accent);
    const st = mapStats(subject, map);
    state.msg = h('p', { class: 'tm-msg', role: 'status', 'aria-live': 'polite' });
    const saved = opts.keep ? state.cams[mapId] : null;
    const first = nextNode(subject, map);
    const firstSec = first ? sectionOfNode(map, first.id) : null;
    const expanded = new Set(saved ? saved.expanded : firstSec ? [firstSec.id] : []);

    const stage = h('div', { class: 'tm-stage', tabindex: '0', role: 'application', 'aria-label': '教学地图。用鼠标或手指拖动，Ctrl 加滚轮或双指捏合缩放；键盘用方向键移动、加减号缩放、0 看全图；Tab 逐个走关卡。' });
    const world = h('div', { class: 'tm-world' });
    stage.append(world);
    const tool = (text, label, fn, extra = '') => h('button', { type: 'button', class: `tm-tool ${extra}`, 'aria-label': label, title: label, text, onclick: () => { sound('pop'); fn(); } });
    const next = h('button', { type: 'button', class: 'btn-nav tm-next', onclick: () => { sound('pop'); goNext(); } });
    const allBtn = h('button', { type: 'button', class: 'tm-tool tm-tool-wide', onclick: () => {
      const v = state.view, all = !map.sections.every(s => v.expanded.has(s.id));
      map.sections.forEach(s => (all ? v.expanded.add(s.id) : v.expanded.delete(s.id)));
      sound('pop'); buildWorld(); fitAll(360);
    } });
    const hud = h('div', { class: 'tm-hud' },
      h('div', { class: 'tm-hud-l' }, next),
      h('div', { class: 'tm-hud-r' }, allBtn, tool('适配', '整张图缩放到刚好看完', () => fitAll(360)), tool('−', '缩小', () => zoomBy(1 / ZOOM_STEP), 'tm-zoombtn'), tool('+', '放大', () => zoomBy(ZOOM_STEP), 'tm-zoombtn')));
    hud.addEventListener('pointerdown', e => e.stopPropagation());
    hud.addEventListener('dblclick', e => e.stopPropagation());
    stage.append(hud);

    const chips = h('div', { class: 'tm-regions', role: 'group', 'aria-label': '小节' }, map.sections.map((sec, i) => h('button', { type: 'button', class: 'tm-chip-region', 'data-sec': sec.id,
      onclick: () => { sound('pop'); toggleRegion(sec.id, true); } },
    h('b', { text: sectionNo(i) }), ` ${sec.title} `, h('span', { text: `${sectionDone(subject, map, sec)}/${sec.nodes.length}` }))));

    const book = h('button', { type: 'button', class: 'btn-nav tm-book', onclick: e => { sound('pop'); openReactionBook(map, e.currentTarget); } }, '反应册（按类别汇总）');
    put(box,
      h('div', { class: 'tm-head' },
        h('button', { type: 'button', class: 'btn-nav tm-back', onclick: () => { sound('pop'); renderHome(); } }, '← 选地图'),
        h('div', { class: 'tm-head-main' },
          h('h2', { class: 'page-heading tm-title', text: map.title }),
          h('p', { class: 'tm-prog', text: `已通关 ${st.done} / ${st.total} 关 · 累计 ${st.stars} 颗星` })),
        book),
      draftBanner(), state.msg, chips,
      h('div', { class: 'tm-legend', 'aria-hidden': 'true' },
        h('span', { text: '锁住：先通过前面的关' }), h('span', { text: '亮着：可以挑战' }), h('span', { text: '旗帜：魔王关，直接挑战可跳级' }), h('span', { text: '拖动画面、Ctrl＋滚轮缩放；点小节标题收起／展开' })),
      stage);

    state.view = { stage, world, map, expanded, cam: saved ? { x: saved.x, y: saved.y, k: saved.k } : { x: 0, y: 0, k: 1 }, rects: {}, plates: {}, W: 1, H: 1, fly: 0, nxt: null, next, allBtn, chips };
    wireStage(stage);
    buildWorld();
    if (saved) { clampCam(); applyCam(); }
    else if (firstSec) {
      // 第一次进来：现在在学的那一区放进画面；如果就是第一区，连起点一起放进来
      const r = state.view.plates[firstSec.id], root = state.view.rects.root;
      const box = firstSec === map.sections[0]
        ? { x: Math.min(r.x, root.x), y: Math.min(r.y, root.y), w: Math.max(r.x + r.w, root.x + root.w) - Math.min(r.x, root.x), h: Math.max(r.y + r.h, root.y + root.h) - Math.min(r.y, root.y) }
        : r;
      flyToRect(box, 1, 0);
    } else fitAll(0);
  }
  const starsText = n => (n > 0 ? '★'.repeat(n) : '');

  /* ---------- 面板（知识卡、闯关、结果、反应册共用） ---------- */
  function closeSheet(restore = true) {
    if (!sheet) return;
    document.removeEventListener('keydown', sheet.onKey, true);
    sheet.mask.remove();
    document.body.classList.remove('tm-lock');
    const from = sheet.from, fromId = from && from.dataset ? from.dataset.id : null;
    sheet = null;
    const celebrated = runCelebrate();   // 刚解锁了新关：镜头飞过去（同时负责把焦点放到新关上）
    if (restore && !celebrated) {
      // 通关後地图重画过，原来那个按钮已经不在了：按 id 找回新的
      const back = from && document.contains(from) ? from : (fromId && state.view ? state.view.world.querySelector(`.tm-node[data-id="${fromId}"]`) : null);
      if (back) back.focus({ preventScroll: true });
    }
  }
  function openSheet(from, build) {
    closeSheet(false);
    const body = h('div', { class: 'tm-sheet-body' });
    const top = h('div', { class: 'tm-top' });   // 顶栏左边：小标签／题号与进度条（每个画面自己放）；右边永远是 ×，两者不会叠在一起
    const closeBtn = h('button', { type: 'button', class: 'tm-x', 'aria-label': '关闭', text: '×', onclick: () => requestClose() });
    const bar = h('div', { class: 'tm-sheet-top' }, top, closeBtn);
    const box = h('div', { class: 'tm-sheet', role: 'dialog', 'aria-modal': 'true', style: `--tm-accent:${(state.mapAccent || '#0f766e')}` }, bar, body);
    const mask = h('div', { class: 'tm-mask' }, box);
    mask.addEventListener('mousedown', e => { if (e.target === mask) requestClose(); });
    const s = { mask, box, body, top, bar, from, busy: false, onKey: null, confirmClose: false, leave: null, prevFocus: null };
    s.onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); requestClose(); return; }
      if (e.key !== 'Tab') return;
      // 确认条开着时，焦点只在确认条的两个按钮之间转
      const scope = s.leave || box;
      const f = [...scope.querySelectorAll('button, input, textarea, [tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    sheet = s;
    document.addEventListener('keydown', s.onKey, true);
    document.body.classList.add('tm-lock');
    document.body.append(mask);
    build(body, s);
    const focusTarget = body.querySelector('[data-autofocus]') || closeBtn;
    focusTarget.focus();
    return s;
  }
  function requestClose() {
    if (!sheet) return;
    if (sheet.leave) { stayInSheet(); return; }          // 确认条开着时再按一次 Esc／×／点外面 = 继续闯关
    if (sheet.confirmClose) { askLeave(); return; }       // 答题到一半关掉：问一次，免得误触
    closeSheet();
  }
  // 用面板内的确认条，不用 window.confirm：原生对话框会把主线程卡到你点完为止（浏览器会报「INP Issue」），手机上也很突兀
  function askLeave() {
    const s = sheet;
    s.prevFocus = document.activeElement;
    const stay = h('button', { type: 'button', class: 'btn-nav tm-primary', text: '继续闯关', onclick: () => stayInSheet() });
    const leave = h('button', { type: 'button', class: 'btn-nav tm-ghost tm-leave-go', text: '退出', onclick: () => closeSheet() });
    s.leave = h('div', { class: 'tm-leave', role: 'alertdialog', 'aria-label': '确认退出' },
      h('p', { text: '现在退出，这次闯关不会记录。确定退出吗？' }),
      h('div', { class: 'tm-actions' }, stay, leave));
    s.bar.after(s.leave);
    s.body.classList.add('is-asking');
    s.body.setAttribute('aria-hidden', 'true');
    stay.focus();
  }
  function stayInSheet() {
    const s = sheet;
    if (!s || !s.leave) return;
    s.leave.remove();
    s.leave = null;
    s.body.classList.remove('is-asking');
    s.body.removeAttribute('aria-hidden');
    if (s.prevFocus && s.box.contains(s.prevFocus)) s.prevFocus.focus();
  }
  const refreshMap = () => { if (state.mapId) openMap(state.mapId, { keep: true }); };

  /* ---------- 知识卡 ---------- */
  function renderReactions(list) {
    const cats = state.data.reaction_categories || [];
    const wrap = h('div', { class: 'tm-rx' });
    cats.forEach(cat => {
      const inCat = list.filter(r => r.category === cat.id);
      if (!inCat.length) return;
      const group = h('section', { class: 'tm-rx-group', 'data-cat': cat.id }, h('h4', { class: 'tm-rx-cat', text: cat.name }));
      const levels = cat.levels || [null];
      levels.forEach(lv => {
        const rows = inCat.filter(r => (lv ? r.level === lv : true));
        if (!rows.length) return;
        if (lv) group.append(h('p', { class: 'tm-rx-level', 'data-level': lv, text: lv === '简单' ? '简单（一步就完成）' : '复杂（要连续好几步）' }));
        rows.forEach(r => group.append(h('div', { class: 'tm-rx-row' },
          h('div', { class: 'tm-rx-name', text: r.name }),
          h('div', { class: 'tm-rx-eq', text: r.equation }),
          r.conditions ? h('div', { class: 'tm-rx-cond', text: `条件：${r.conditions}` }) : null,
          r.note ? h('div', { class: 'tm-rx-note', text: `待确认：${r.note}` }) : null)));
      });
      wrap.append(group);
    });
    return wrap;
  }

  function openLesson(map, node, from) {
    state.mapAccent = map.accent;
    openSheet(from, (body, s) => {
      const L = node.lesson || {};
      put(s.top, h('div', { class: 'tm-eyebrow' },
        h('span', { class: 'tm-chip tm-chip-tier', text: TIER_LABEL[node.tier] || '' }),
        kindsOf(node.challenges).map(k => h('span', { class: 'tm-chip', text: KIND_LABEL[k] }))));
      put(body, 
        h('h3', { class: 'tm-sheet-title', 'data-autofocus': '', tabindex: '-1', text: node.title }),
        h('p', { class: 'tm-lead', text: L.summary || '' }),
        h('ul', { class: 'tm-points' }, (L.points || []).map(p => h('li', { text: p }))),
        L.tip ? h('p', { class: 'tm-tip' }, h('b', { text: '记住：' }), L.tip) : null,
        (L.reactions || []).length ? h('div', { class: 'tm-rx-wrap' }, h('h4', { class: 'tm-sub-title', text: '这一关的反应式' }), renderReactions(L.reactions)) : null,
        (node.sources || []).length ? h('p', { class: 'tm-src', text: `资料来源：${node.sources.join('；')}` }) : null,
        h('div', { class: 'tm-actions' },
          h('button', { type: 'button', class: 'btn-nav tm-primary', onclick: () => {
            sound('pop');
            startQuiz({ map, title: node.title, kind: 'node', id: node.id, ratio: PASS_RATIO, from,
              items: node.challenges.map(prepare) });
          } }, '开始闯关（共 ' + node.challenges.length + ' 题）')));
    });
  }

  /* ---------- 魔王关 ---------- */
  function openBoss(map, boss, from) {
    state.mapAccent = map.accent;
    const sec = sectionOfBoss(map, boss.id);
    const pool = sec ? sec.nodes.flatMap(id => nodeIndex(map)[id].challenges) : [];
    const done = bossCleared(state.subject, map, boss);
    openSheet(from, (body, s) => {
      put(s.top, h('div', { class: 'tm-eyebrow' }, h('span', { class: 'tm-chip tm-chip-boss', text: '魔王关' })));
      put(body, 
        h('h3', { class: 'tm-sheet-title', 'data-autofocus': '', tabindex: '-1', text: boss.title }),
        h('p', { class: 'tm-lead', text: boss.blurb || '' }),
        h('ul', { class: 'tm-points' },
          h('li', { text: `共 ${Math.min(BOSS_POOL, pool.length) + 1} 题：从「${sec ? sec.title : ''}」所有关卡的题目里随机抽 ${Math.min(BOSS_POOL, pool.length)} 题，外加 1 道专属终局题。` }),
          h('li', { text: `门槛比较高：要答对 ${needed(Math.min(BOSS_POOL, pool.length) + 1, BOSS_RATIO)} 题以上才算通关。` }),
          h('li', { text: '通关後，本小节所有关卡一次标成「跳级」（不会降低你原来的星数），下一个小节解锁；没过不扣任何进度，可以再挑战。' }),
          done ? h('li', { text: '你已经通关过这个小节了，再打一次可以刷新星数。' }) : null),
        h('div', { class: 'tm-actions' },
          h('button', { type: 'button', class: 'btn-nav tm-primary', onclick: () => {
            sound('pop');
            const picked = shuffle(pool).slice(0, BOSS_POOL).map(prepare);
            startQuiz({ map, title: boss.title, kind: 'boss', id: boss.id, ratio: BOSS_RATIO, from, sectionId: sec && sec.id,
              items: [...picked, prepare(boss.extra)] });
          } }, '挑战魔王')));
    });
  }

  // 题目拷贝一份；名词题选项打乱（答案跟着换位置）
  function prepare(c) {
    const q = JSON.parse(JSON.stringify(c));
    if (q.type === 'term') {
      const order = shuffle(q.options.map((text, i) => ({ text, ok: i === q.answer })));
      q.options = order.map(o => o.text);
      q.answer = order.findIndex(o => o.ok);
    }
    return q;
  }

  /* ---------- 闯关 ---------- */
  function startQuiz(ctx) {
    const run = { ...ctx, index: 0, correct: 0 };
    openSheet(ctx.from, (body, s) => { s.confirmClose = true; showQuestion(body, s, run); });
  }

  function progressBar(run) {
    return h('div', { class: 'tm-qhead' },
      h('span', { class: 'tm-qtitle', text: run.title }),
      h('span', { class: 'tm-qno', text: `第 ${run.index + 1} / ${run.items.length} 题` }),
      h('span', { class: 'tm-bar tm-bar-q', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.round(run.index / run.items.length * 100)}%` })));
  }

  function showQuestion(body, s, run) {
    clear(body);
    put(clear(s.top), progressBar(run));
    const q = run.items[run.index];
    put(body,
      h('div', { class: 'tm-eyebrow' }, h('span', { class: 'tm-chip', text: KIND_LABEL[q.type] || '' })),
      h('p', { class: 'tm-q', 'data-autofocus': '', tabindex: '-1', text: q.q }));
    const feedback = h('div', { class: 'tm-feedback', role: 'status', 'aria-live': 'polite' });
    const nextBtn = () => h('button', { type: 'button', class: 'btn-nav tm-primary', onclick: () => {
      run.index += 1;
      if (run.index >= run.items.length) showResult(body, s, run); else showQuestion(body, s, run);
    } }, run.index + 1 >= run.items.length ? '看结果' : '下一题');
    const settle = (ok, extra) => {
      if (ok) run.correct += 1;
      sound(ok ? 'correct' : 'wrong');
      feedback.className = `tm-feedback ${ok ? 'is-ok' : 'is-bad'}`;
      put(clear(feedback), h('p', { class: 'tm-verdict', text: ok ? '答对了' : '再想想' }), ...extra, h('div', { class: 'tm-actions' }, nextBtn()));
      const nb = feedback.querySelector('.tm-primary'); if (nb) nb.focus();
    };

    if (q.type === 'term') {
      const list = h('div', { class: 'tm-options' });
      q.options.forEach((text, i) => {
        list.append(h('button', { type: 'button', class: 'tm-option', 'data-i': String(i), onclick: () => {
          list.querySelectorAll('.tm-option').forEach((b, j) => {
            b.disabled = true;
            if (j === q.answer) b.classList.add('is-right');
            else if (j === i) b.classList.add('is-wrong');
          });
          settle(i === q.answer, [h('p', { class: 'tm-explain', text: q.explain || '' })]);
        } }, h('span', { class: 'tm-opt-badge', text: 'ABCD'[i] }), h('span', { class: 'tm-opt-text', text: text })));
      });
      put(body, list, feedback);
    } else if (q.type === 'calc') {
      const input = h('input', { class: 'tm-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': `答案${q.unit ? `（单位：${plain(q.unit)}）` : ''}`, placeholder: '填数字，例如 4.48 或 1.2×10^-3' });
      const warn = h('p', { class: 'tm-warn', role: 'alert' });
      const submit = h('button', { type: 'button', class: 'btn-nav tm-primary', text: '提交答案' });
      const giveUp = h('button', { type: 'button', class: 'btn-nav tm-ghost', text: '不会，看解法' });
      const finish = ok => {
        input.disabled = true; submit.disabled = true; giveUp.disabled = true;
        settle(ok, [h('p', { class: 'tm-answer', text: `标准答案：${numText(q.answer, q.unit)}` }), h('p', { class: 'tm-steps', text: q.steps || '' })]);
      };
      const check = () => {
        const v = parseNumber(input.value);
        if (!Number.isFinite(v)) { warn.textContent = '请输入一个数字（只填数字，单位已经写在旁边；可以写 1.2×10^-3 这样的科学记数法）。'; input.focus(); return; }
        warn.textContent = '';
        finish(isCorrect(v, q.answer, q.tol));
      };
      submit.addEventListener('click', check);
      giveUp.addEventListener('click', () => finish(false));
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
      put(body, h('div', { class: 'tm-answer-row' }, input, q.unit ? h('span', { class: 'tm-unit', text: q.unit }) : null), warn,
        q.hint ? h('p', { class: 'tm-hint', text: `提示：${q.hint}` }) : null,
        h('div', { class: 'tm-actions' }, submit, giveUp), feedback);
    } else {
      const area = h('textarea', { class: 'tm-textarea', rows: '4', 'aria-label': '你的答案（可以略过，在心里答也行）', placeholder: '先自己写（也可以只在心里想），写完再看参考答案。' });
      const reveal = h('button', { type: 'button', class: 'btn-nav tm-primary', text: '看参考答案' });
      const boxArea = h('div', { class: 'tm-essay-box' });
      reveal.addEventListener('click', () => {
        reveal.disabled = true; area.readOnly = true;
        const checks = q.points.map((p, i) => h('label', { class: 'tm-check' }, h('input', { type: 'checkbox', 'data-i': String(i) }), h('span', { text: p })));
        const need = needed(q.points.length, PASS_RATIO);
        const count = h('p', { class: 'tm-count', 'aria-live': 'polite' });
        const update = () => { count.textContent = `已勾 ${boxArea.querySelectorAll('input:checked').length} / ${q.points.length} 个要点（至少 ${need} 个算对）`; };
        const done = h('button', { type: 'button', class: 'btn-nav tm-primary', text: '完成自评' });
        put(boxArea, h('p', { class: 'tm-answer', text: '参考答案' }), h('p', { class: 'tm-steps', text: q.model || '' }),
          h('p', { class: 'tm-sub-title', text: '对照要点，你写（或想）到了哪些？' }), ...checks, count, h('div', { class: 'tm-actions' }, done));
        boxArea.addEventListener('change', update); update();
        done.addEventListener('click', () => {
          const got = boxArea.querySelectorAll('input:checked').length;
          boxArea.querySelectorAll('input').forEach(i => { i.disabled = true; });
          done.remove();
          settle(got >= need, [h('p', { class: 'tm-explain', text: `你勾了 ${got} / ${q.points.length} 个要点。` })]);
        });
        const first = boxArea.querySelector('input'); if (first) first.focus();
      });
      put(body, area, h('div', { class: 'tm-actions' }, reveal), boxArea, feedback);
    }
  }

  /* ---------- 结果 ---------- */
  function showResult(body, s, run) {
    s.confirmClose = false;
    clear(body); clear(s.top);
    const total = run.items.length;
    const stars = starsFor(run.correct, total, run.ratio);
    const passed = stars > 0;
    const { subject } = state;
    const map = run.map;
    const lockedBefore = map.nodes.filter(n => isLocked(subject, map, n)).map(n => n.id);
    if (passed) {
      award(subject, run.id, stars, 'p');
      if (run.kind === 'boss') {
        const sec = map.sections.find(x => x.id === run.sectionId);
        if (sec) sec.nodes.forEach(id => award(subject, id, 2, 's'));   // 跳级：每关算 2 星，不盖掉更高的星数
      }
    }
    const unlockedNodes = map.nodes.filter(n => lockedBefore.includes(n.id) && !isLocked(subject, map, n));
    const unlocked = unlockedNodes.map(n => n.title);
    const fresh = unlockedNodes.filter(n => starsOf(subject, n.id) === 0);   // 跳级过去的不算「新」解锁
    state.celebrate = passed && unlockedNodes.length ? { ids: (fresh.length ? fresh : unlockedNodes).map(n => n.id) } : null;
    sound(passed ? 'correct' : 'wrong');
    put(body, 
      h('h3', { class: 'tm-sheet-title', 'data-autofocus': '', tabindex: '-1', text: passed ? (run.kind === 'boss' ? '魔王倒下了！' : '过关！') : '差一点' }),
      h('div', { class: 'tm-result-stars', 'aria-label': `${stars} 颗星` }, [1, 2, 3].map(i => svgOf(i <= stars ? ICON.star : ICON.starOff, 'tm-star tm-star-big'))),
      h('p', { class: 'tm-lead', text: `答对 ${run.correct} / ${total} 题（过关要 ${needed(total, run.ratio)} 题）。` }),
      passed && run.kind === 'boss' ? h('p', { class: 'tm-tip', text: '本小节的所有关卡已标成「跳级」，知识卡和反应册随时还能回头翻。' }) : null,
      passed && unlocked.length ? h('p', { class: 'tm-tip' }, h('b', { text: '解锁了：' }), unlocked.join('、')) : null,
      !passed ? h('p', { class: 'tm-tip', text: run.kind === 'boss' ? '没过不会扣任何进度。回去看看知识卡，再来挑战。' : '回去看一遍知识卡，再来一次。' }) : null,
      h('div', { class: 'tm-actions' },
        h('button', { type: 'button', class: 'btn-nav tm-primary', onclick: () => closeSheet(false) }, '回到地图'),
        h('button', { type: 'button', class: 'btn-nav tm-ghost', onclick: () => {
          sound('pop');
          const items = run.kind === 'boss'
            ? (() => { const sec = map.sections.find(x => x.id === run.sectionId); const pool = sec.nodes.flatMap(id => nodeIndex(map)[id].challenges); return [...shuffle(pool).slice(0, BOSS_POOL).map(prepare), prepare(bossOf(map, run.id).extra)]; })()
            : nodeIndex(map)[run.id].challenges.map(prepare);
          const next = { ...run, items, index: 0, correct: 0 };
          state.celebrate = null;
          s.confirmClose = true; showQuestion(body, s, next);
        } }, '再来一次')));
    // 面板後面的地图先更新（星星、解锁），关掉面板就看得到
    refreshMap();
  }

  /* ---------- 反应册 ---------- */
  function openReactionBook(map, from) {
    state.mapAccent = map.accent;
    openSheet(from, (body) => {
      const all = map.nodes.flatMap(n => ((n.lesson && n.lesson.reactions) || []).map(r => ({ ...r, from: n.title })));
      put(body, 
        h('h3', { class: 'tm-sheet-title', 'data-autofocus': '', tabindex: '-1', text: `${map.title} · 反应册` }),
        h('p', { class: 'tm-lead', text: `共 ${all.length} 条反应式，按类别汇总（制取反应分「简单」「复杂」）。没通关的关卡也能先翻。` }),
        renderReactions(all.map(r => ({ ...r, name: `${r.name}（${r.from}）` }))));
    });
  }

  /* ---------- 对外 ---------- */
  async function open(subject) {
    const box = root();
    if (!box) return;
    state = { subject, data: null, mapId: null, cams: {}, view: null, celebrate: null, art: null, msg: null };
    clear(box);
    box.className = 'tm-root';
    put(box, h('p', { class: 'page-hint', role: 'status', text: '载入教学地图…' }));
    try {
      state.data = await loadData(subject);
      await loadArt();
      renderHome();
    } catch (e) {
      put(clear(box), h('p', { class: 'page-hint', text: '教学地图载入失败（可能没有网络）。' }),
        h('button', { type: 'button', class: 'btn-nav', onclick: () => open(subject), text: '再试一次' }));
    }
  }

  // 窗口大小变了：宽窄跨过 HORIZONTAL_MIN 就换排法（左→右／上→下），否则只把画面拉回范围内
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const v = state.view;
      if (!v || !document.contains(v.stage) || !v.stage.clientWidth) return;
      if ((v.stage.clientWidth >= HORIZONTAL_MIN) !== v.horiz) { buildWorld(); fitAll(0); } else { clampCam(); applyCam(); }
    }, 150);
  });

  window.TeachMode = { open, _test: { parseNumber, isCorrect, starsFor, needed, PASS_RATIO, BOSS_RATIO } };
})();
