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
    { key: 'biology',   name: '生物',     en: 'Biology',     accent: '#059669', deco: 'dna',       glyph: 'leaf',     enabled: true,  note: '光合呼吸 · 神经调节 · 遗传育种' },
    { key: 'chemistry', name: '化学',     en: 'Chemistry',   accent: '#7c3aed', deco: 'atom',      glyph: 'flask',    enabled: true,  note: '题库整理中' },
    { key: 'physics',   name: '物理',     en: 'Physics',     accent: '#0284c7', deco: 'pendulum',  glyph: 'wave',     enabled: true,  note: '题库整理中' },
    { key: 'math',      name: '高级数学', en: 'Adv. Maths',  accent: '#d97706', deco: 'geometry',  glyph: 'triangle', enabled: false, note: '尚未开放' },
  ];
  /* ======================================== */

  const ARC_LENGTH = 282.74;   // 2πr，r=45，与 orbit.css 里的 stroke-dasharray 对应

  const GLYPHS = {
    leaf: '<path d="M12 21c0-6.5 3.2-10.6 9-12.4-.7 7.6-4.2 11.6-9 12.4Z"/><path d="M12 21C7.7 17.3 4.8 12.8 4 6.4c6.2 1.3 8 6.3 8 14.6Z"/>',
    flask: '<path d="M9.5 3h5M10.5 3v6.2L5.6 18a2.2 2.2 0 0 0 1.9 3.3h9a2.2 2.2 0 0 0 1.9-3.3l-4.9-8.8V3"/><path d="M7.8 15h8.4"/>',
    wave: '<path d="M2.5 12c2.6-6.5 5.2 6.5 7.8 0s5.2-6.5 7.8 0 3.4 3 3.4 3"/>',
    triangle: '<path d="M12 4.5 20.5 19.5h-17z"/><path d="M12 4.5v15M7.8 19.5 12 12"/>',
  };

  const DECOS = {
    dna: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path class="strand a" d="M34 0 Q72 25 34 50 Q-4 75 34 100"/>
      <path class="strand b" d="M66 0 Q28 25 66 50 Q104 75 66 100"/>
      <line class="rung" x1="40" y1="13" x2="60" y2="13"/>
      <line class="rung" x1="43" y1="37" x2="57" y2="37"/>
      <line class="rung" x1="43" y1="63" x2="57" y2="63"/>
      <line class="rung" x1="40" y1="87" x2="60" y2="87"/>
    </svg>`,
    atom: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="1.8">
      <g transform="rotate(0 50 50)"><g class="spin-a"><ellipse cx="50" cy="50" rx="48" ry="17"/><circle cx="98" cy="50" r="3.6" fill="currentColor" stroke="none"/></g></g>
      <g transform="rotate(60 50 50)"><g class="spin-b"><ellipse cx="50" cy="50" rx="48" ry="17"/><circle cx="2" cy="50" r="3.2" fill="currentColor" stroke="none"/></g></g>
      <g transform="rotate(120 50 50)"><g class="spin-c"><ellipse cx="50" cy="50" rx="48" ry="17"/><circle cx="98" cy="50" r="3" fill="currentColor" stroke="none"/></g></g>
    </svg>`,
    pendulum: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="50" cy="16" r="2.6" fill="currentColor" stroke="none"/>
      <g class="arm"><line x1="50" y1="16" x2="50" y2="84"/><circle cx="50" cy="88" r="5.5" fill="currentColor" stroke="none"/></g>
      <path class="wave" d="M6 50c6-11 12 11 18 0s12-11 18 0"/>
      <path class="wave" d="M58 50c6-11 12 11 18 0s12-11 18 0"/>
    </svg>`,
    geometry: `<svg viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
      <g class="tri"><polygon points="50,4 95,80 5,80"/></g>
      <path class="spiral" d="M50 50a14 14 0 0 1 14-14 23 23 0 0 1 23 23 37 37 0 0 1-37 37"/>
    </svg>`,
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
  function svgGlyph(name) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name] || ''}</svg>`;
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
      `<span class="node-deco deco-${subject.deco}" aria-hidden="true">${DECOS[subject.deco] || ''}</span>` +
      `<span class="node-disc">` +
        `<svg class="node-arc" viewBox="0 0 100 100" aria-hidden="true">` +
          `<circle class="arc-bg" cx="50" cy="50" r="45"/>` +
          `<circle class="arc-fg" cx="50" cy="50" r="45"/>` +
        `</svg>` +
        `<span class="node-glyph" aria-hidden="true">${svgGlyph(subject.glyph)}</span>` +
      `</span>` +
      `<span class="node-label">${subject.name}<em>${subject.en}</em></span>`;
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
    let n = 0;
    Object.values(store[key] || {}).forEach(chapter => {
      Object.values(chapter || {}).forEach(v => { if (v === 'mastered') n++; });
    });
    return n;
  }

  async function loadTotals() {
    await Promise.all(SUBJECTS.map(async (s) => {
      s.total = 0;
      if (!s.enabled) return;
      try {
        const res = await fetch(`/papers/${s.key}_question_bank.json`);
        if (!res.ok) return;
        const data = await res.json();
        const sections = data.sections || data.mcq_sections || [];
        s.total = sections.reduce((n, sec) => n + ((sec.mcqs && sec.mcqs.length) || 0), 0);
        s.any = s.total + sections.reduce((n, sec) => n + ((sec.subjectives && sec.subjectives.length) || 0), 0);
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

  function refresh() {
    SUBJECTS.forEach((s, i) => {
      const { pct } = statsFor(i);
      const arc = nodes[i].querySelector('.arc-fg');
      if (arc) arc.style.strokeDashoffset = ARC_LENGTH * (1 - pct / 100);
    });
    if (selected !== null) fillPanel(selected);
  }

  function fillPanel(i) {
    const s = SUBJECTS[i];
    const { total, done, pct } = statsFor(i);
    stage.style.setProperty('--accent-color', s.accent);
    panelTitle.textContent = `${s.name} (${s.en})`;
    panelSub.textContent = s.note;
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
      if (view.classList.contains('active')) { deselect(); refresh(); }
    }).observe(view, { attributes: true, attributeFilter: ['class'] });
  }

  loadTotals();
  window.OrbitSubjects = { refresh, select, deselect, hasQuestions };
})();
