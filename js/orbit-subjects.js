/* 轨道式学科选择器
 * --------------------------------------------------
 * 怎么运作：所有小球的位置只由一个数字决定 —— 轨道角度 --ring。
 *   第 i 颗球的实际角度 = 它的固定角度 base(i) + --ring
 * 平时用 requestAnimationFrame 每帧把 --ring 加一点点，看起来就是缓慢绕圈；
 * 点中某颗球时，算出「要让它转到正上方，--ring 该是多少」，再用缓动补间转过去。
 *
 * 想加科目 / 改速度 / 改配色，只要动下面这两个常量区，不必碰其他代码。
 */
(function () {
  'use strict';

  /* ============ 可以随便改的设定 ============ */
  const IDLE_SPEED = 4;      // 平时绕圈速度（度/秒），越小越慢，4 ≈ 90 秒一圈
  const SNAP_MS = 760;       // 点击后转到正上方所需时间（毫秒）
  const PROGRESS_KEY = 'UEC_PROGRESS_v1';   // 与 index.html 的做题记录同一份

  const SUBJECTS = [
    { key: 'biology',   name: '生物',     en: 'Biology',     accent: '#059669', motif: 'dna',    enabled: true,  note: '光合呼吸 · 神经调节 · 遗传育种' },
    { key: 'chemistry', name: '化学',     en: 'Chemistry',   accent: '#7c3aed', motif: 'atom',   enabled: true,  note: '化学键 · 化学平衡 · 有机化学' },
    { key: 'physics',   name: '物理',     en: 'Physics',     accent: '#0284c7', motif: 'car',    enabled: true,  note: '力学 · 电磁学 · 光学' },
    { key: 'math',      name: '高级数学', en: 'Adv. Maths',  accent: '#d97706', motif: 'golden', enabled: true,  note: '高数Ⅰ · 高数Ⅱ · 函数到微积分' },
  ];
  /* ======================================== */

  const ARC_LENGTH = 282.74;   // 2πr，r=45，与 orbit.css 里的 stroke-dasharray 对应

  // 球里的科目图案（48×48），和网站图标（学士帽）同一套：深色墨线＋科目色。各部位的颜色、动法在 css/orbit.css「球里的科目图案」
  // 平常静止；指到、键盘移到、选中时才动：DNA 扭转、电子绕核、电流流动＋灯泡亮＋小车开动、黄金螺线画出来
  const MOTIFS = {
    // 生物：DNA 双螺旋
    dna: '<path class="m-strand m-b" d="M24,5 L21.9,6 L19.9,7 L18.2,8 L16.8,9 L15.9,10 L15.5,11 L15.7,12 L16.3,13 L17.5,14 L19,15 L20.9,16 L22.9,17 L25.1,18 L27.1,19 L29,20 L30.5,21 L31.7,22 L32.3,23 L32.5,24 L32.1,25 L31.2,26 L29.8,27 L28.1,28 L26.1,29 L24,30 L21.9,31 L19.9,32 L18.2,33 L16.8,34 L15.9,35 L15.5,36 L15.7,37 L16.3,38 L17.5,39 L19,40 L20.9,41 L22.9,42 L25.1,43"/><path class="m-rung" d="M19.5,8.5 H28.5"/><path class="m-rung" d="M21,15 H27"/><path class="m-rung" d="M18.8,21.5 H29.2"/><path class="m-rung" d="M21.5,27.8 H26.5"/><path class="m-rung" d="M18.6,34.2 H29.4"/><path class="m-rung" d="M22.1,40.6 H25.9"/><path class="m-strand m-a" d="M24,5 L26.1,6 L28.1,7 L29.8,8 L31.2,9 L32.1,10 L32.5,11 L32.3,12 L31.7,13 L30.5,14 L29,15 L27.1,16 L25.1,17 L22.9,18 L20.9,19 L19,20 L17.5,21 L16.3,22 L15.7,23 L15.5,24 L15.9,25 L16.8,26 L18.2,27 L19.9,28 L21.9,29 L24,30 L26.1,31 L28.1,32 L29.8,33 L31.2,34 L32.1,35 L32.5,36 L32.3,37 L31.7,38 L30.5,39 L29,40 L27.1,41 L25.1,42 L22.9,43"/>',
    // 化学：原子
    atom: '<g class="m-orbit m-o0"><ellipse cx="24" cy="24" rx="19" ry="7" transform="rotate(0 24 24)"/><circle class="m-e" cx="43" cy="24" r="2.6"/></g><g class="m-orbit m-o1"><ellipse cx="24" cy="24" rx="19" ry="7" transform="rotate(60 24 24)"/><circle class="m-e" cx="33.5" cy="40.5" r="2.6"/></g><g class="m-orbit m-o2"><ellipse cx="24" cy="24" rx="19" ry="7" transform="rotate(120 24 24)"/><circle class="m-e" cx="14.5" cy="40.5" r="2.6"/></g><circle class="m-nucleus" cx="24" cy="24" r="4"/>',
    // 物理：基本电路当边框（电阻、灯泡、电池），中间小车与牵引力 F 的方向（网站图标左半那台车）
    car: '<path class="m-wire" d="M21.5,41 H8 Q3,41 3,36 V12 Q3,7 8,7 H17 L19.3,4.3 L21.7,9.7 L24,4.3 L26.3,9.7 L28.6,4.3 L31,7 H40 Q45,7 45,12 V19.8 M45,28.2 V36 Q45,41 40,41 H26"/><path class="m-current" d="M21.5,41 H8 Q3,41 3,36 V12 Q3,7 8,7 H17 L19.3,4.3 L21.7,9.7 L24,4.3 L26.3,9.7 L28.6,4.3 L31,7 H40 Q45,7 45,12 V19.8 M45,28.2 V36 Q45,41 40,41 H26"/><path class="m-battery" d="M21.5,36.5 V45.5 M26,38.6 V43.4"/><circle class="m-lamp" cx="45" cy="24" r="4.2"/><path class="m-lamp-x" d="M42.1,21.1 L47.9,26.9 M47.9,21.1 L42.1,26.9"/><g class="m-car"><path class="m-body" d="M9 29.5V26.2q0-1.6 1.6-1.9l2.6-.6 3-3.6q.7-.8 1.8-.8h5q1.1 0 1.8.9l2.3 3.1q2.2.4 2.2 2.4v3.8z"/><path class="m-window" d="M16.9 23.4l1.8-2.3h4.3l1.7 2.3z"/><g class="m-wheel"><circle cx="13" cy="29.8" r="2.8"/><circle class="m-hub" cx="13" cy="28.9" r=".9"/></g><g class="m-wheel"><circle cx="25.6" cy="29.8" r="2.8"/><circle class="m-hub" cx="25.6" cy="28.9" r=".9"/></g></g><path class="m-force" d="M30.8 26H38M35.4 23.4 38.2 26 35.4 28.6"/><text class="m-f" x="32.4" y="21.6">F</text>',
    // 数学：黄金矩形与螺线
    golden: '<rect class="m-rect" x="5" y="12.3" width="38" height="23.5" rx="1.5"/><path class="m-grid" d="M5,12.3h23.5v23.5h-23.5zM28.5,12.3h14.5v14.5h-14.5zM34,26.8h9v9h-9zM28.5,30.2h5.5v5.5h-5.5zM28.5,26.8h3.4v3.4h-3.4zM31.9,26.8h2.1v2.1h-2.1z"/><path class="m-spiral" pathLength="1" d="M5,35.7 A23.5,23.5 0 0 1 28.5,12.3 A14.5,14.5 0 0 1 43,26.8 A9,9 0 0 1 34,35.7 A5.5,5.5 0 0 1 28.5,30.2 A3.4,3.4 0 0 1 31.9,26.8 A2.1,2.1 0 0 1 34,28.9 A1.3,1.3 0 0 1 32.7,30.2"/>',
  };

  const stage = document.getElementById('orbitStage');
  if (!stage) return;

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const nodes = [];
  let ring = -24;            // 轨道当前角度
  let selected = null;       // 目前选中的索引
  let hovering = false;
  let tween = null;          // { from, to, start }
  let lastFrame = 0;

  const baseAngle = i => i * (360 / SUBJECTS.length);

  /* ---------- 建立 DOM ---------- */
  function svgMotif(name) {
    return `<svg viewBox="0 0 48 48">${MOTIFS[name] || ''}</svg>`;
  }

  function buildNode(subject, i) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'orbit-node';
    btn.dataset.key = subject.key;
    btn.style.setProperty('--base', baseAngle(i));
    btn.style.setProperty('--accent-color', subject.accent);
    btn.style.setProperty('--accent-soft', hexToRgba(subject.accent, 0.16));
    btn.setAttribute('aria-label', `${subject.name} ${subject.en}`);
    if (!subject.enabled) btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML =
      `<span class="node-disc">` +
        `<svg class="node-arc" viewBox="0 0 100 100" aria-hidden="true">` +
          `<circle class="arc-bg" cx="50" cy="50" r="45"/>` +
          `<circle class="arc-fg" cx="50" cy="50" r="45"/>` +
        `</svg>` +
        `<span class="node-glyph" aria-hidden="true">${svgMotif(subject.motif)}</span>` +
      `</span>` +
      `<span class="node-label">${subject.name}<em class="node-sub">${subject.en}</em></span>`;
    return btn;
  }

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  const ballLayer = document.createElement('div');
  SUBJECTS.forEach((subject, i) => {
    const node = buildNode(subject, i);
    node.addEventListener('click', (e) => { e.stopPropagation(); select(i); });
    node.addEventListener('focus', () => select(i));
    node.addEventListener('pointerenter', () => {
      hovering = true;
      stage.style.setProperty('--core-deep', subject.accent);
      stage.style.setProperty('--core-soft', hexToRgba(subject.accent, 0.35));
    });
    node.addEventListener('pointerleave', () => { hovering = false; });
    nodes.push(node);
    ballLayer.appendChild(node);
  });
  stage.appendChild(ballLayer);

  const panel = document.createElement('div');
  panel.className = 'orbit-panel';
  panel.setAttribute('role', 'group');
  panel.innerHTML =
    `<div class="panel-title" id="orbitPanelTitle"></div>` +
    `<div class="panel-sub"></div>` +
    `<div class="panel-bar"><i></i></div>` +
    `<div class="panel-stat"></div>` +
    `<button class="panel-enter" type="button">进入</button>` +
    `<div class="panel-hint">点其他地方取消</div>`;
  stage.appendChild(panel);

  const panelTitle = panel.querySelector('.panel-title');
  const panelSub = panel.querySelector('.panel-sub');
  const panelBar = panel.querySelector('.panel-bar i');
  const panelStat = panel.querySelector('.panel-stat');
  const panelEnter = panel.querySelector('.panel-enter');

  /* ---------- 进度（已掌握的选择题 ÷ 该科总题数） ---------- */
  function masteredCount(key) {
    let store = {};
    try { store = JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {}; } catch (e) { store = {}; }
    const hidden = (SUBJECTS.find(x => x.key === key) || {}).hidden || {};
    let n = 0;
    Object.entries(store[key] || {}).forEach(([chapterId, chapter]) => {
      Object.entries(chapter || {}).forEach(([i, v]) => {
        if (v === 'mastered' && !(hidden[chapterId] && hidden[chapterId].has(Number(i)))) n++;
      });
    });
    return n;
  }

  // 回到首页就重抓一次：学生没重新整理，也看得到刚采纳的题（抓不到时保留上次的数字）
  async function loadTotals() {
    await Promise.all(SUBJECTS.map(async (s) => {
      if (!s.enabled) return;
      try {
        const res = await fetch(`/papers/${s.key}_question_bank.json`);
        if (!res.ok) return;
        const data = await res.json();
        const sections = data.sections || data.mcq_sections || [];
        // 在 /dev 下架的题（hidden）不算
        const live = list => (list || []).filter(q => !q.hidden).length;
        s.total = sections.reduce((n, sec) => n + live(sec.mcqs), 0);
        s.any = s.total + sections.reduce((n, sec) => n + live(sec.subjectives), 0);
        // 下架的选择题答对过也不算进掌握数
        s.hidden = {};
        sections.forEach(sec => {
          const idx = (sec.mcqs || []).map((q, i) => (q.hidden ? i : -1)).filter(i => i >= 0);
          if (idx.length) s.hidden[sec.id] = new Set(idx);
        });
      } catch (e) { /* 题库还没上线就当 0 题 */ }
    }));
    refresh();
    // 首页「继续上次学习」要知道哪些科目其实没有题
    if (typeof window.renderResumeCard === 'function') window.renderResumeCard();
  }

  // true／false；题数还没载入完成时回 undefined
  function hasQuestions(key) {
    const s = SUBJECTS.find(x => x.key === key);
    return s && s.any !== undefined ? s.any > 0 : undefined;
  }

  function statsFor(i) {
    const s = SUBJECTS[i];
    const total = s.total || 0;
    const done = Math.min(masteredCount(s.key), total);
    return { total, done, pct: total ? Math.round(done / total * 100) : 0 };
  }

  // 球底下那行：题数载入後，英文名换成这一科的状态。还没点之前就看得出哪一科有题
  function statusFor(s) {
    if (!s.enabled) return '尚未开放';
    if (s.any === undefined) return null;
    return s.any === 0 ? '整理中' : `${s.total} 题`;
  }

  function refresh() {
    SUBJECTS.forEach((s, i) => {
      const { pct } = statsFor(i);
      const arc = nodes[i].querySelector('.arc-fg');
      if (arc) arc.style.strokeDashoffset = ARC_LENGTH * (1 - pct / 100);
      const status = statusFor(s);
      if (status) {
        nodes[i].querySelector('.node-sub').textContent = status;
        nodes[i].setAttribute('aria-label', `${s.name} ${s.en}，${status}`);
      }
      nodes[i].classList.toggle('is-empty', !s.enabled || s.any === 0);
    });
    if (selected !== null) fillPanel(selected);
  }

  function fillPanel(i) {
    const s = SUBJECTS[i];
    const { total, done, pct } = statsFor(i);
    stage.style.setProperty('--accent-color', s.accent);
    panelTitle.textContent = `${s.name} (${s.en})`;
    panelSub.textContent = s.enabled && s.any === 0 ? '题库整理中，题目陆续上架' : s.note;
    panelBar.style.width = `${pct}%`;
    panelStat.innerHTML = total
      ? `已掌握 <strong>${pct}%</strong> · ${done} / ${total} 题`
      : `<strong>—</strong> 题库整理中`;
    panelEnter.disabled = !s.enabled;
    // 零题科目：面板上最显眼的主按钮不该通向一个空的地方
    const empty = s.enabled && s.any === 0;
    panelEnter.classList.toggle('is-quiet', empty);
    panelEnter.textContent = !s.enabled ? '尚未开放' : empty ? '看章节大纲' : `进入${s.name}`;
  }

  /* ---------- 选中 / 取消 ---------- */
  function targetRingFor(i) {
    // 要让第 i 颗球转到正上方（角度 0），--ring 必须等于 -base(i)；
    // 再加上最接近当前角度的整圈数，确保永远走最短路径。
    let target = -baseAngle(i);
    target += Math.round((ring - target) / 360) * 360;
    return target;
  }

  function select(i) {
    if (selected === i) return;
    selected = i;
    stage.classList.add('has-selection');
    nodes.forEach((n, idx) => {
      n.classList.toggle('is-selected', idx === i);
      n.setAttribute('aria-expanded', String(idx === i));
    });
    fillPanel(i);
    panel.classList.add('is-open');
    // 背景先换成这一科的水彩（index.html）；还没开放的科目不预览
    if (typeof window.previewSubjectBackground === 'function') window.previewSubjectBackground(SUBJECTS[i].enabled ? SUBJECTS[i].key : null);

    const target = targetRingFor(i);
    if (reduceMotion) { ring = target; applyRing(); }
    else tween = { from: ring, to: target, start: performance.now() };

    if (typeof playSound === 'function') { try { playSound('pop'); } catch (e) {} }
  }

  function deselect() {
    if (selected === null) return;
    selected = null;
    tween = null;
    stage.classList.remove('has-selection');
    nodes.forEach(n => { n.classList.remove('is-selected'); n.setAttribute('aria-expanded', 'false'); });
    panel.classList.remove('is-open');
    if (typeof window.previewSubjectBackground === 'function') window.previewSubjectBackground(null);
  }

  function enterSelected() {
    if (selected === null) return;
    const s = SUBJECTS[selected];
    if (!s.enabled) return;
    deselect();
    if (typeof openSubject === 'function') openSubject(s.key);
  }

  panelEnter.addEventListener('click', enterSelected);
  // 「点其他地方取消」——整个页面都算，不只是轨道区域
  document.addEventListener('click', (e) => {
    if (selected === null) return;
    const t = e.target;
    if (t && t.closest && (t.closest('.orbit-node') || t.closest('.orbit-panel'))) return;
    deselect();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') deselect();
    else if (e.key === 'Enter' && selected !== null && document.activeElement === nodes[selected]) enterSelected();
  });

  /* ---------- 每帧推动轨道 ---------- */
  function applyRing() {
    stage.style.setProperty('--ring', ring.toFixed(2));
  }

  const easeInOutCubic = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function shouldIdle() {
    return selected === null && !hovering && !reduceMotion &&
      document.getElementById('viewSubjects') &&
      document.getElementById('viewSubjects').classList.contains('active');
  }

  function frame(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.1);   // 切回分页时别让它暴冲
    lastFrame = now;

    if (tween) {
      const t = Math.min((now - tween.start) / SNAP_MS, 1);
      ring = tween.from + (tween.to - tween.from) * easeInOutCubic(t);
      if (t >= 1) { ring = ((tween.to % 360) + 360) % 360; tween = null; }
      applyRing();
    } else if (shouldIdle()) {
      ring = (ring + IDLE_SPEED * dt) % 360;
      applyRing();
    }
    requestAnimationFrame(frame);
  }

  applyRing();
  requestAnimationFrame((t) => { lastFrame = t; frame(t); });

  /* 从做题页回到学科页时，重新算一次进度 */
  const view = document.getElementById('viewSubjects');
  if (view && window.MutationObserver) {
    new MutationObserver(() => {
      if (view.classList.contains('active')) { deselect(); refresh(); loadTotals(); }
    }).observe(view, { attributes: true, attributeFilter: ['class'] });
  }

  loadTotals();
  window.OrbitSubjects = { refresh, select, deselect, hasQuestions };
})();
