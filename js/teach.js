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

  // 地图排版：横向 4 栏（col 0～3），纵向每一行 ROW_H px，每个小节之间多留 SEC_GAP px 放小节标题
  const COLS = 4, ROW_H = 172, SEC_GAP = 60, TOP = 10, NODE = 68, MAP_BOTTOM = 96;

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
  let state = { subject: null, data: null, mapId: null };
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
    setCrumbs([{ label: '主页', onClick: goHome }, { label: `${SUBJECT_NAME[subject] || subject} · 教学` }]);
    const box = clear(root());
    box.className = 'tm-root';
    box.style.removeProperty('--tm-accent');
    const cards = data.maps.map(m => {
      const st = mapStats(subject, m);
      const card = h('button', { type: 'button', class: 'tm-card', style: `--tm-accent:${m.accent}`, onclick: () => { sound('pop'); openMap(m.id); } },
        h('span', { class: 'tm-card-art' }, motifSvg(m.cover || 'flask', 'tm-art')),
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

  /* ---------- 地图页（思维导图） ---------- */
  function layout(map) {
    const secIndexOfNode = {};
    map.sections.forEach((s, i) => { s.nodes.forEach(id => { secIndexOfNode[id] = i; }); secIndexOfNode[s.boss] = i; });
    const items = [...map.nodes, ...(map.bosses || [])];
    const pos = {};
    items.forEach(it => {
      const si = secIndexOfNode[it.id] || 0;
      pos[it.id] = { x: (it.col + 0.5) / COLS * 100, y: TOP + SEC_GAP * (si + 1) + it.row * ROW_H, si };
    });
    const height = Math.max(...Object.values(pos).map(p => p.y)) + NODE + MAP_BOTTOM;
    return { pos, height, items };
  }

  function openMap(mapId) {
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
    const msg = h('p', { class: 'tm-msg', role: 'status', 'aria-live': 'polite' });
    const canvas = h('div', { class: 'tm-map' });
    const { pos, height, items } = layout(map);
    canvas.style.height = `${height}px`;

    // 小节标题
    map.sections.forEach((sec, i) => {
      const ids = [...sec.nodes, sec.boss];
      const top = Math.min(...ids.map(id => pos[id].y));
      canvas.append(h('div', { class: 'tm-section', style: `top:${top - 50}px` },
        h('span', { class: 'tm-section-no', text: `第 ${'一二三四五六'[i] || i + 1} 区` }),
        h('span', { class: 'tm-section-name', text: sec.title })));
    });

    // 连线：画在节点後面；locked 的虚线，通关的实线
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'tm-edges');
    svg.setAttribute('viewBox', `0 0 100 ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    items.forEach(it => {
      it.parents.forEach(pid => {
        if (!pos[pid]) return;
        const a = pos[pid], b = pos[it.id];
        const y1 = a.y + NODE + 2, y2 = b.y - 2, ym = (y1 + y2) / 2;
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', `M${a.x} ${y1} C${a.x} ${ym} ${b.x} ${ym} ${b.x} ${y2}`);
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        const open = clearedId(subject, map, pid);
        path.setAttribute('class', `tm-edge${open ? ' is-open' : ''}`);
        svg.appendChild(path);
      });
    });
    canvas.append(svg);

    // 节点
    items.forEach(it => {
      const isBoss = !!bossOf(map, it.id);
      const p = pos[it.id];
      const locked = !isBoss && isLocked(subject, map, it);
      const stars = starsOf(subject, it.id);
      const rec = progressOf(subject)[it.id];
      const bossDone = isBoss && bossCleared(subject, map, it);
      const done = isBoss ? bossDone : stars > 0;
      const skipped = !isBoss && rec && rec.k === 's';
      const stateName = locked ? 'locked' : done ? 'done' : 'open';
      const side = it.col < 1.75 ? 'r' : 'l';
      const kinds = isBoss ? [] : kindsOf(it.challenges);
      const label = isBoss ? '魔王关' : TIER_LABEL[it.tier] || '';
      const aria = isBoss
        ? `${it.title}，魔王关，${bossDone ? '已通关' : '随时可以挑战，通过可免修本小节'}`
        : `${it.title}，${kinds.map(k => KIND_LABEL[k]).join('、')}，${locked ? '未解锁' : done ? `已通关，${stars} 颗星${skipped ? '（跳级）' : ''}` : '可以挑战'}`;
      const btn = h('button', { type: 'button', class: `tm-node${isBoss ? ' is-boss' : ''}`, 'data-state': stateName, 'data-id': it.id, 'aria-label': plain(aria),
        'aria-disabled': locked ? 'true' : null },
        h('span', { class: 'tm-disc' },
          h('span', { class: 'tm-disc-art' }, locked ? svgOf(ICON.lock, 'tm-art') : motifSvg(it.motif, 'tm-art'))),
        h('span', { class: 'tm-name', text: it.title }),
        h('span', { class: 'tm-chips' },
          h('span', { class: 'tm-chip tm-chip-tier', text: label }),
          kinds.map(k => h('span', { class: 'tm-chip', text: KIND_LABEL[k] }))),
        isBoss
          ? h('span', { class: 'tm-sub', text: bossDone ? starsText(stars) || '已免修' : '免修本小节' })
          : h('span', { class: 'tm-stars', 'aria-hidden': 'true' }, [1, 2, 3].map(i => svgOf(i <= stars ? ICON.star : ICON.starOff, 'tm-star'))),
        skipped ? h('span', { class: 'tm-skip', text: '跳级' }) : null);
      const wrap = h('div', { class: `tm-pos side-${side}${locked ? ' is-locked' : ''}`, style: `left:${p.x}%;top:${p.y}px` },
        h('span', { class: 'tm-deco', 'aria-hidden': 'true' }, motifSvg(isBoss ? 'flag' : it.motif, 'tm-deco-art')), btn);
      btn.addEventListener('click', () => {
        if (locked) { sound('wrong'); msg.textContent = lockReason(subject, map, it); return; }
        msg.textContent = '';
        sound('pop');
        if (isBoss) openBoss(map, it, btn); else openLesson(map, it, btn);
      });
      canvas.append(wrap);
    });

    const book = h('button', { type: 'button', class: 'btn-nav tm-book', onclick: e => { sound('pop'); openReactionBook(map, e.currentTarget); } }, '反应册（按类别汇总）');
    put(box, 
      h('div', { class: 'tm-head' },
        h('button', { type: 'button', class: 'btn-nav tm-back', onclick: () => { sound('pop'); renderHome(); } }, '← 选地图'),
        h('div', { class: 'tm-head-main' },
          h('h2', { class: 'page-heading tm-title', text: map.title }),
          h('p', { class: 'tm-prog', text: `已通关 ${st.done} / ${st.total} 关 · 累计 ${st.stars} 颗星` })),
        book),
      draftBanner(), msg,
      h('div', { class: 'tm-legend', 'aria-hidden': 'true' },
        h('span', { text: '锁住：先通过前面的关' }), h('span', { text: '亮着：可以挑战' }), h('span', { text: '旗帜：魔王关，直接挑战可跳级' })),
      canvas);
  }
  const starsText = n => (n > 0 ? '★'.repeat(n) : '');

  /* ---------- 面板（知识卡、闯关、结果、反应册共用） ---------- */
  function closeSheet(restore = true) {
    if (!sheet) return;
    document.removeEventListener('keydown', sheet.onKey, true);
    sheet.mask.remove();
    document.body.classList.remove('tm-lock');
    const from = sheet.from;
    sheet = null;
    if (restore && from && document.contains(from)) from.focus();
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
  const refreshMap = () => { if (state.mapId) { const y = window.scrollY; openMap(state.mapId); window.scrollTo(0, y); } };

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
    const unlocked = map.nodes.filter(n => lockedBefore.includes(n.id) && !isLocked(subject, map, n)).map(n => n.title);
    sound(passed ? 'correct' : 'wrong');
    put(body, 
      h('h3', { class: 'tm-sheet-title', 'data-autofocus': '', tabindex: '-1', text: passed ? (run.kind === 'boss' ? '魔王倒下了！' : '过关！') : '差一点' }),
      h('div', { class: 'tm-result-stars', 'aria-label': `${stars} 颗星` }, [1, 2, 3].map(i => svgOf(i <= stars ? ICON.star : ICON.starOff, 'tm-star tm-star-big'))),
      h('p', { class: 'tm-lead', text: `答对 ${run.correct} / ${total} 题（过关要 ${needed(total, run.ratio)} 题）。` }),
      passed && run.kind === 'boss' ? h('p', { class: 'tm-tip', text: '本小节的所有关卡已标成「跳级」，知识卡和反应册随时还能回头翻。' }) : null,
      passed && unlocked.length ? h('p', { class: 'tm-tip' }, h('b', { text: '解锁了：' }), unlocked.join('、')) : null,
      !passed ? h('p', { class: 'tm-tip', text: run.kind === 'boss' ? '没过不会扣任何进度。回去看看知识卡，再来挑战。' : '回去看一遍知识卡，再来一次。' }) : null,
      h('div', { class: 'tm-actions' },
        h('button', { type: 'button', class: 'btn-nav tm-primary', onclick: () => { closeSheet(false); refreshMap(); } }, '回到地图'),
        h('button', { type: 'button', class: 'btn-nav tm-ghost', onclick: () => {
          sound('pop');
          const items = run.kind === 'boss'
            ? (() => { const sec = map.sections.find(x => x.id === run.sectionId); const pool = sec.nodes.flatMap(id => nodeIndex(map)[id].challenges); return [...shuffle(pool).slice(0, BOSS_POOL).map(prepare), prepare(bossOf(map, run.id).extra)]; })()
            : nodeIndex(map)[run.id].challenges.map(prepare);
          const next = { ...run, items, index: 0, correct: 0 };
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
    state = { subject, data: null, mapId: null };
    clear(box);
    box.className = 'tm-root';
    put(box, h('p', { class: 'page-hint', role: 'status', text: '载入教学地图…' }));
    try {
      state.data = await loadData(subject);
      renderHome();
    } catch (e) {
      put(clear(box), h('p', { class: 'page-hint', text: '教学地图载入失败（可能没有网络）。' }),
        h('button', { type: 'button', class: 'btn-nav', onclick: () => open(subject), text: '再试一次' }));
    }
  }

  window.TeachMode = { open, _test: { parseNumber, isCorrect, starsFor, needed, PASS_RATIO, BOSS_RATIO } };
})();
