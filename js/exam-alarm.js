/* 统考闹钟：首页时间表旁边的闹钟。学生替任一科设提醒（每天同一时间，或只响一次），时间到装置跳出通知：
 *   「物理还有 3 天 5 小时就要考了~」
 * 两条路送到学生手上：
 *   推播 —— 伺服器（api/alarm.js 登记、api/alarm-tick.js 每分钟检查）经推播服务送到装置，网站关着也会响
 *   网站开着 —— 推播用不了时（iPhone 没加入主画面、通知被封锁、伺服器定时器没开），网页自己每 20 秒看一次
 * 网站开着的时候，由网页播学生选的音效；网站关着时响的是装置自己的通知声（浏览器不让网页指定通知的声音）。
 * 闹钟存在这台装置，不跟同步码走：推播订阅本来就是一台装置一个。
 * 通知文字与「还有多久」由 js/alarm-common.js 算（伺服器也用同一支）。
 */
(function () {
  'use strict';

  const KEY = 'UEC_ALARMS_v1';
  // 一台装置最多几个闹钟（不能大于 api/_lib/alarms.js 的 MAX_ALARMS）
  const MAX_ALARMS = 10;
  // 新增闹钟时预设的时间
  const DEFAULT_TIME = '21:00';
  // 网站开着时，晚了超过这么久就不补响（和 api/_lib/alarms.js 的 LATE_LIMIT_MS 一样）
  const LATE_LIMIT_MS = 30 * 60 * 1000;
  // 伺服器的每分钟检查多久没跑，就当作定时器停了，改由网页自己响
  const TICK_STALE_MS = 10 * 60 * 1000;
  // 网站开着时多久检查一次该不该响
  const CHECK_EVERY_MS = 20 * 1000;
  // 页面上的提醒条停留多久
  const RING_SHOW_MS = 15 * 1000;

  // ---- 提醒音效：Web Audio 当场合成，不用音档（离线也能响）。一种音效用在全部闹钟 ----
  let ctx = null;
  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // 一个音：频率、几秒後开始、长度、波形、音量（10 毫秒起音，之後指数衰减）
  function tone(ac, f, start, dur, type, vol) {
    const o = ac.createOscillator(), g = ac.createGain();
    const t = ac.currentTime + start;
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(ac.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const ALARM_SOUNDS = [
    // 叮咚两次：Mi→Do，加一个 2.76 倍的泛音，听起来才像金属钟
    { id: 'chime', name: '叮咚', play: ac => [0, 1.1].forEach(s => [[659.25, 0], [523.25, 0.45]].forEach(([f, d]) => {
      tone(ac, f, s + d, 1, 'sine', 0.22);
      tone(ac, f * 2.76, s + d, 0.5, 'sine', 0.05);
    })) },
    // 老式闹钟：小锤在两颗铃之间来回敲，敲两阵
    { id: 'bell', name: '闹铃', play: ac => {
      for (let i = 0; i < 28; i++) tone(ac, i % 2 ? 1568 : 1319, (i < 14 ? 0 : 0.95) + (i % 14) * 0.055, 0.09, 'triangle', 0.12);
    } },
    // Do Mi Sol Do 往上爬，最後一个和弦
    { id: 'marimba', name: '木琴', play: ac => {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { tone(ac, f, i * 0.16, 0.45, 'sine', 0.2); tone(ac, f * 4, i * 0.16, 0.08, 'sine', 0.04); });
      [523.25, 659.25, 783.99].forEach(f => tone(ac, f, 0.8, 0.9, 'sine', 0.12));
    } },
    // 电子錶：哔哔哔哔 ×2
    { id: 'beep', name: '电子', play: ac => [0, 0.9].forEach(s => { for (let i = 0; i < 4; i++) tone(ac, 2093, s + i * 0.14, 0.07, 'square', 0.05); }) },
  ];
  function playAlarmSound(id) {
    const ac = audio();
    if (!ac) return;
    try { (ALARM_SOUNDS.find(s => s.id === id) || ALARM_SOUNDS[0]).play(ac); } catch (e) {}
  }

  // ---- 存档 ----
  const fresh = () => ({ list: [], sound: ALARM_SOUNDS[0].id, push: false, endpoint: '', fired: {} });
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.list)) return Object.assign(fresh(), s);
    } catch (e) {}
    return fresh();
  }
  let state = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} };

  // ---- 时间 ----
  const C = window.UECAlarmCommon;
  const papers = () => (window.UEC_EXAM && window.UEC_EXAM.papers) || [];
  const examStartOf = subject => C.examStart(papers(), subject);
  // 这一科的第一场（美术考上下午两场，算上午那场）
  const firstPaper = subject => papers().filter(p => p.subject === subject)
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
  // 还没开考的科目，按开考先後排
  function upcomingSubjects(now) {
    const seen = new Map();
    papers().forEach(p => {
      const t = examStartOf(p.subject);
      if (t && t > now && !seen.has(p.subject)) seen.set(p.subject, t);
    });
    return [...seen].sort((a, b) => a[1] - b[1]).map(([subject, start]) => ({ subject, start, date: firstPaper(subject).date }));
  }
  // 以 base 那天为准，往後 days 天的 HH:MM（装置的当地时间）
  const dayAt = (base, days, time) => {
    const [h, m] = time.split(':').map(Number);
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + days, h, m).getTime();
  };
  const onceAt = a => new Date(`${a.date}T${a.time}:00`).getTime();
  // 下一次该响的时间；没有下一次了（响过、开考了）回 null
  function nextFire(a, now) {
    const start = examStartOf(a.subject);
    let t = a.date ? onceAt(a) : dayAt(new Date(now), 0, a.time);
    if (!a.date && t <= now) t = dayAt(new Date(now), 1, a.time);
    return start && t > now && t < start ? t : null;
  }
  // 最近一次该响、已经过了的时间：网站开着时，拿来判断要不要补响
  function lastFire(a, now) {
    if (a.date) { const t = onceAt(a); return t <= now ? t : null; }
    const t = dayAt(new Date(now), 0, a.time);
    return t <= now ? t : dayAt(new Date(now), -1, a.time);
  }
  const md = ymd => { const [, m, d] = ymd.split('-').map(Number); return `${m} 月 ${d} 日`; };
  const whenText = a => (a.date ? `${md(a.date)} ${a.time}` : `每天 ${a.time}`);
  const ymdOf = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  // 开考那一刻，照时间表的写法：10 月 21 日 下午 1:55
  function startText(subject) {
    const p = firstPaper(subject);
    if (!p) return '';
    const [h, m] = p.start.split(':').map(Number);
    return `${md(p.date)} ${p.half} ${h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')}`;
  }

  // 响过、开考了的闹钟拿掉
  function prune(now) {
    const before = state.list.length;
    state.list = state.list.filter(a => nextFire(a, now) !== null);
    Object.keys(state.fired).forEach(id => { if (!state.list.some(a => a.id === id)) delete state.fired[id]; });
    if (state.list.length !== before) save();
  }

  // ---- 伺服器与推播 ----
  let server = null;     // { ready, publicKey } 或 { error: true }
  let swReg = null;      // 按「加入闹钟」的当下就要用到（浏览器规定要在按下去的那一刻要权限），先准备好
  if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(r => { swReg = r; }).catch(() => {});

  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = () => /iP(hone|od|ad)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const keyBytes = s => {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(b, c => c.charCodeAt(0));
  };
  const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

  async function probe() {
    try {
      const r = await fetch('/api/alarm', { cache: 'no-store' });
      const j = await r.json();
      server = { ready: Boolean(j.configured && j.publicKey && j.tickAge !== null && j.tickAge < TICK_STALE_MS), publicKey: j.publicKey };
    } catch (e) {
      server = { error: true };
    }
    return server;
  }

  // 要通知权限：要在按下按钮的当下要，等别的事做完再要，Safari 会直接拒绝
  function askPermission() {
    if (!('Notification' in window)) return Promise.resolve();
    if (pushSupported() && server && server.ready && swReg) {
      // 推播订阅本身就会问权限；已经订阅过（或钥匙换过）会失败，交给 register() 处理
      return swReg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(server.publicKey) }).catch(() => {});
    }
    if (Notification.permission !== 'default') return Promise.resolve();
    try { return Promise.resolve(Notification.requestPermission()).catch(() => {}); } catch (e) { return Promise.resolve(); }
  }

  async function subscription() {
    const reg = swReg || await withTimeout(navigator.serviceWorker.ready, 5000);
    let sub = await reg.pushManager.getSubscription();
    const key = keyBytes(server.publicKey);
    const old = sub && sub.options && sub.options.applicationServerKey;
    if (sub && old && !sameBytes(new Uint8Array(old), key)) { await sub.unsubscribe(); sub = null; }
    return sub || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }

  // 把这台装置的闹钟整批交给伺服器。成功就改走推播，网页不再自己响（免得响两次）
  async function register() {
    if (!pushSupported() || Notification.permission !== 'granted') { state.push = false; save(); return; }
    if (!server || server.error) await probe();
    if (!server.ready) { state.push = false; save(); return; }
    try {
      const sub = await subscription();
      const now = Date.now();
      const alarms = state.list.map(a => ({ id: a.id, subject: a.subject, first: nextFire(a, now), daily: !a.date })).filter(a => a.first);
      const r = await fetch('/api/alarm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), alarms }),
      });
      state.push = r.ok;
      state.endpoint = r.ok ? sub.endpoint : '';
    } catch (e) {
      state.push = false;
    }
    save();
  }

  // ---- 响 ----
  function notify(text, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body: text.body, tag, renotify: true, icon: '/assets/icons/android-chrome-192x192.png' };
    const fallback = () => { try { new Notification(text.title, opts); } catch (e) {} };
    // Android 的 Chrome 只能经 service worker 跳通知
    if (!('serviceWorker' in navigator)) return fallback();
    navigator.serviceWorker.getRegistration().then(r => (r ? r.showNotification(text.title, opts) : fallback())).catch(fallback);
  }

  // 网页上的提醒条：没开通知权限（例如 iPhone 的 Safari 分页）也看得到
  function banner(text) {
    let b = document.getElementById('alarmRing');
    if (!b) {
      b = document.createElement('div');
      b.id = 'alarmRing';
      b.className = 'alarm-ring';
      b.setAttribute('role', 'alert');
      document.body.appendChild(b);
    }
    b.innerHTML = `${CLOCK_SVG}<span class="alarm-ring-text"><strong></strong><span></span></span>
      <button type="button" class="alarm-ring-close" aria-label="关掉提醒">×</button>`;
    b.querySelector('strong').textContent = text.title;
    b.querySelector('.alarm-ring-text span').textContent = text.body;
    b.querySelector('.alarm-ring-close').addEventListener('click', () => b.classList.remove('show'));
    requestAnimationFrame(() => b.classList.add('show'));
    clearTimeout(b.hideTimer);
    b.hideTimer = setTimeout(() => b.classList.remove('show'), RING_SHOW_MS);
    if (button) {
      button.classList.remove('is-ringing');
      void button.offsetWidth;
      button.classList.add('is-ringing');
    }
  }

  // systemShown：推播已经由 service worker 跳过系统通知了，网页只补音效与提醒条
  function ring(text, tag, { systemShown = false, forceSystem = false } = {}) {
    playAlarmSound(state.sound);
    banner(text);
    if (!systemShown && (forceSystem || document.hidden)) notify(text, tag);
  }

  // 网站开着、没走推播时：到点就自己响
  function checkLocal() {
    const now = Date.now();
    state = load();   // 另一个分页可能刚响过
    if (!state.push) {
      state.list.forEach(a => {
        const t = lastFire(a, now);
        const start = examStartOf(a.subject);
        if (!t || !start || t >= start || now - t > LATE_LIMIT_MS || (state.fired[a.id] || 0) >= t) return;
        state.fired[a.id] = t;
        save();
        const text = C.message(papers(), a.subject, t);
        if (text) ring(text, `alarm-${a.id}`);
      });
    }
    prune(now);
    renderButton();
    if (panel && !panel.hidden) renderList();
  }

  // ---- 介面 ----
  const CLOCK_SVG = `
    <svg class="alarm-clock" viewBox="0 0 48 48" aria-hidden="true">
      <path class="clk-bell clk-ink" d="M6.5 13a7 7 0 0 1 14 0z" transform="rotate(-40 13.5 13)"/>
      <path class="clk-bell clk-ink" d="M27.5 13a7 7 0 0 1 14 0z" transform="rotate(40 34.5 13)"/>
      <path class="clk-ink clk-line" d="M24 11V7M13.5 40.5l-3.5 4M34.5 40.5l3.5 4"/>
      <circle class="clk-bell clk-ink" cx="24" cy="5.5" r="2.2"/>
      <circle class="clk-body clk-ink" cx="24" cy="27" r="16"/>
      <ellipse class="clk-blush" cx="15" cy="31.5" rx="3.2" ry="2.2"/>
      <ellipse class="clk-blush" cx="33" cy="31.5" rx="3.2" ry="2.2"/>
      <circle class="clk-face" cx="19" cy="26" r="2.1"/>
      <circle class="clk-face" cx="29" cy="26" r="2.1"/>
      <path class="clk-smile" d="M20.5 32c1.2 1.4 2.3 2 3.5 2s2.3-.6 3.5-2"/>
    </svg>`;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let button = null, panel = null;

  function build() {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'alarm-toggle';
    button.id = 'alarmToggle';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'alarmPanel');
    button.innerHTML = `${CLOCK_SVG}<span class="alarm-count" hidden></span><span class="sr-only">统考闹钟</span>`;
    button.addEventListener('click', () => setOpen(panel.hidden));
    button.addEventListener('animationend', () => button.classList.remove('is-ringing'));

    panel = document.createElement('div');
    panel.className = 'alarm-panel';
    panel.id = 'alarmPanel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="alarm-title">统考闹钟</div>
      <p class="alarm-hint">到了你设的时间，装置会跳出通知，例如「物理还有 3 天 5 小时就要考了~」。</p>
      <div class="alarm-status" role="status"><span class="alarm-status-text"></span>
        <button type="button" class="btn-ghost-retro alarm-permit" hidden>开启通知</button></div>
      <ul class="alarm-list" aria-label="已设的闹钟"></ul>
      <form class="alarm-form" novalidate>
        <label class="alarm-field">科目<select id="alarmSubject"></select></label>
        <label class="alarm-field">时间<input id="alarmTime" type="time" required></label>
        <div class="alarm-repeat" role="radiogroup" aria-label="重复">
          <label><input type="radio" name="alarmRepeat" value="daily" checked> 每天，直到开考</label>
          <label><input type="radio" name="alarmRepeat" value="once"> 只响一次</label>
          <input id="alarmDate" type="date" aria-label="只响一次的日期" disabled>
        </div>
        <p class="alarm-error" aria-live="polite"></p>
        <button type="submit" class="btn-primary-retro alarm-add">加入闹钟</button>
      </form>
      <div class="alarm-sounds-head">
        <span class="alarm-sounds-label" id="alarmSoundsLabel">提醒音效<em>（开着网站时播放）</em></span>
        <button type="button" class="btn-ghost-retro alarm-test">试一下</button>
      </div>
      <div class="alarm-sounds" role="radiogroup" aria-labelledby="alarmSoundsLabel">
        ${ALARM_SOUNDS.map(s => `<label class="alarm-sound"><input type="radio" name="alarmSound" value="${s.id}"><span>${s.name}</span></label>`).join('')}
      </div>`;

    const form = panel.querySelector('.alarm-form');
    const subjectSel = panel.querySelector('#alarmSubject');
    const dateInput = panel.querySelector('#alarmDate');
    const timeInput = panel.querySelector('#alarmTime');
    timeInput.value = DEFAULT_TIME;
    // 换科目：日期预设成那一科开考的前一天
    subjectSel.addEventListener('change', () => fitDate(true));
    panel.querySelectorAll('input[name="alarmRepeat"]').forEach(r => r.addEventListener('change', () => {
      dateInput.disabled = !panel.querySelector('input[name="alarmRepeat"][value="once"]').checked;
    }));
    form.addEventListener('submit', onAdd);
    panel.querySelectorAll('input[name="alarmSound"]').forEach(r => r.addEventListener('change', () => {
      state.sound = r.value;
      save();
      playAlarmSound(r.value);
    }));
    panel.querySelector('.alarm-test').addEventListener('click', onTest);
    panel.querySelector('.alarm-permit').addEventListener('click', () => {
      askPermission().then(register).then(renderStatus);
    });
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') { setOpen(false); button.focus(); } });
    button.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) setOpen(false); });
  }

  // 日期栏的范围：今天到开考那天；force＝换了科目，改成开考前一天
  function fitDate(force) {
    const p = firstPaper(panel.querySelector('#alarmSubject').value);
    const input = panel.querySelector('#alarmDate');
    if (!p) return;
    const [y, m, d] = p.date.split('-').map(Number);
    const today = ymdOf(Date.now()), last = p.date;
    input.min = today;
    input.max = last;
    if (force || !input.value || input.value < today || input.value > last) {
      const before = ymdOf(new Date(y, m - 1, d - 1).getTime());
      input.value = before < today ? today : before;
    }
  }

  function renderButton() {
    if (!button) return;
    const n = state.list.length;
    const count = button.querySelector('.alarm-count');
    count.hidden = !n;
    count.textContent = n;
    button.classList.toggle('is-set', n > 0);
    button.querySelector('.sr-only').textContent = n ? `统考闹钟：已设 ${n} 个，按一下查看或新增` : '统考闹钟：按一下设定考试提醒';
  }

  function renderList() {
    const ul = panel.querySelector('.alarm-list');
    if (!state.list.length) { ul.innerHTML = '<li class="alarm-empty">还没有闹钟。</li>'; return; }
    ul.innerHTML = state.list.map(a => `<li>
        <span class="alarm-item-main"><span class="alarm-item-subj">${esc(a.subject)}</span>
        <span class="alarm-item-when">${esc(whenText(a))}</span></span>
        <span class="alarm-item-exam">${esc(startText(a.subject))} 开考</span>
        <button type="button" class="alarm-del" data-id="${esc(a.id)}" aria-label="删除 ${esc(a.subject)} ${esc(whenText(a))} 的闹钟"><svg class="ic" aria-hidden="true"><use href="#i-trash"></use></svg></button>
      </li>`).join('');
    ul.querySelectorAll('.alarm-del').forEach(b => b.addEventListener('click', () => {
      state.list = state.list.filter(a => a.id !== b.dataset.id);
      delete state.fired[b.dataset.id];
      save();
      renderAll();
      if (state.push) register().then(renderStatus);
      const next = ul.querySelector('.alarm-del') || panel.querySelector('#alarmSubject');
      if (next) next.focus();
    }));
  }

  function renderSubjects() {
    const sel = panel.querySelector('#alarmSubject');
    const keep = sel.value;
    const list = upcomingSubjects(Date.now());
    sel.innerHTML = list.map(s => {
      const [, m, d] = s.date.split('-').map(Number);
      return `<option value="${esc(s.subject)}">${esc(s.subject)}（${d}/${m}）</option>`;
    }).join('');
    if (list.some(s => s.subject === keep)) sel.value = keep;
    panel.querySelector('.alarm-form').hidden = !list.length;
    fitDate(!keep);
  }

  // 这台装置能不能在网站关着时收到提醒；不能的话，说清楚为什么、要怎么做
  function renderStatus() {
    if (!panel) return;
    const box = panel.querySelector('.alarm-status');
    const permit = panel.querySelector('.alarm-permit');
    let text, ok = false;
    permit.hidden = true;
    if (!pushSupported()) {
      text = isIOS() && !isStandalone()
        ? 'iPhone／iPad：先按分享键「加入主画面」，从主画面打开网站再设闹钟，网站关着才会提醒。现在只有开着网站时会响。'
        : '这个浏览器收不到网站关着时的通知，只有开着网站时会响。';
    } else if (Notification.permission === 'denied') {
      text = '通知被封锁了：到浏览器的网站设定允许「通知」，网站关着才收得到。现在只有开着网站时会响。';
    } else if (!server) {
      text = '正在确认这台装置能不能收通知…';
    } else if (server.error) {
      text = '连不上伺服器，现在只有开着网站时会响。';
    } else if (!server.ready) {
      text = '网站的定时提醒还没开，现在只有开着网站时会响。';
    } else if (Notification.permission === 'default') {
      text = state.list.length ? '还没开启通知：按「开启通知」，网站关着也会提醒。' : '加入闹钟时，浏览器会问要不要允许通知，请按「允许」。';
      permit.hidden = !state.list.length;
    } else if (state.list.length && !state.push) {
      text = '闹钟还没交给伺服器，现在只有开着网站时会响。';
      permit.hidden = false;
    } else {
      text = '✓ 这台装置网站关着也会准时提醒。';
      ok = true;
    }
    box.querySelector('.alarm-status-text').textContent = text;
    box.classList.toggle('is-ok', ok);
  }

  function renderAll() {
    renderButton();
    if (!panel || panel.hidden) return;
    renderList();
    renderStatus();
    panel.querySelectorAll('input[name="alarmSound"]').forEach(r => { r.checked = r.value === state.sound; });
  }

  function setOpen(open) {
    if (open) {
      if (window.closeExamList) window.closeExamList();   // 时间表与闹钟只开一个
      prune(Date.now());
      renderSubjects();
    }
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (typeof window.playSound === 'function') window.playSound('pop');
    if (!open) return;
    renderAll();
    probe().then(renderStatus);
  }

  function onAdd(e) {
    e.preventDefault();
    const err = panel.querySelector('.alarm-error');
    const subject = panel.querySelector('#alarmSubject').value;
    const time = panel.querySelector('#alarmTime').value;
    const once = panel.querySelector('input[name="alarmRepeat"][value="once"]').checked;
    const date = once ? panel.querySelector('#alarmDate').value : null;
    const now = Date.now();
    const a = { id: Math.random().toString(36).slice(2, 10), subject, time, date };
    let problem = '';
    if (state.list.length >= MAX_ALARMS) problem = `最多设 ${MAX_ALARMS} 个闹钟，先删掉一些。`;
    else if (!/^\d{2}:\d{2}$/.test(time)) problem = '请选一个时间。';
    else if (once && !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) problem = '请选日期。';
    else if (!nextFire(a, now)) {
      problem = once && onceAt(a) <= now ? '这个时间已经过了。' : `要设在开考（${startText(subject)}）之前。`;
    } else if (state.list.some(x => x.subject === subject && x.time === time && x.date === date)) problem = '这个闹钟已经有了。';
    err.textContent = problem;
    if (problem) return;

    const asking = askPermission();   // 一定要在按下去的当下
    state.list.push(a);
    state.fired[a.id] = now;          // 设的这一刻以前的不补响（例如 9 点 10 分设「每天 9 点」）
    save();
    renderAll();
    if (typeof window.playSound === 'function') window.playSound('toggle');
    asking.then(register).then(renderStatus);
  }

  function onTest() {
    const subject = state.list[0] ? state.list[0].subject : panel.querySelector('#alarmSubject').value;
    const text = C.message(papers(), subject, Date.now());
    if (!text) return;
    if (state.push && state.endpoint) {
      // 真的走一趟推播：几秒内跳出来，就证明网站关着时也收得到
      playAlarmSound(state.sound);
      subscription().then(sub => fetch('/api/alarm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), test: true }),
      })).then(r => {
        panel.querySelector('.alarm-error').textContent = r.ok ? '已经送出测试通知，几秒内会跳出来。' : '测试通知没送出去，稍后再试。';
      }).catch(() => { panel.querySelector('.alarm-error').textContent = '连不上伺服器，稍后再试。'; });
      return;
    }
    ring(text, 'alarm-test', { forceSystem: true });
  }

  // 首页时间表每次重画都会叫这里：把同一颗按钮、同一个面板搬回去（填到一半的表单不会不见）
  function attach(row, box) {
    if (!button) build();
    row.appendChild(button);
    box.appendChild(panel);
    renderButton();
  }
  function close() { if (panel && !panel.hidden) setOpen(false); }

  // 推播到的时候网站正开着：service worker 已经跳了（静音的）系统通知，这里播音效、显示提醒条
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.type === 'uec-alarm') ring({ title: e.data.title, body: e.data.body }, e.data.tag, { systemShown: true });
    });
  }

  // 走推播的装置：每次打开网站确认订阅还在（浏览器偶尔会换订阅），换了就重新交给伺服器
  function recheck() {
    if (!state.list.length) return;
    // 学生後来收回了通知权限：伺服器送不到了，改回网页自己响
    if (!pushSupported() || Notification.permission !== 'granted') {
      if (state.push) { state.push = false; save(); }
      return;
    }
    probe().then(s => {
      if (!s.ready) {
        if (!s.error && state.push) { state.push = false; save(); }
        return null;
      }
      return withTimeout(navigator.serviceWorker.ready, 5000)
        .then(reg => reg.pushManager.getSubscription())
        .then(sub => { if (!state.push || !sub || sub.endpoint !== state.endpoint) return register(); return null; });
    }).catch(() => {});
  }

  checkLocal();
  setInterval(checkLocal, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkLocal(); });
  recheck();

  window.UECAlarm = { attach, close, sounds: ALARM_SOUNDS.map(s => ({ id: s.id, name: s.name })) };
})();
