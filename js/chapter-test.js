/* 整章测验：一次做完一章的全部选择题，全部答完才能交卷，交卷才看答案。
 * 进入後隐藏导航，只能交卷或按「退出测验」离开 —— 这是自我检测，不是练习。
 *
 * 计时模式（模拟统考）：opts.timeLimitMs 有值时倒数；时间到自动交卷，没答的算错（只算分数，不写进错题本与复习排程）；
 * 可以提早交卷，还有题没答时第一次按会先提醒，再按一次才交。
 *
 * 只计第一次交卷：SM-2 对同一天重复作答没有防护，看过答案马上重做一定全对，
 * 如果也计进去，复习间隔会被灌到好几天後。所以重做只当练习，不写记录。
 */
(function () {
  const CSS = `
body.in-test .top-nav, body.in-test .util-bar, body.in-test #spriteWrap { display: none !important; }
#viewTest { padding-bottom: 40px; }

.test-bar {
  position: sticky; top: calc(env(safe-area-inset-top, 0px) + 12px); z-index: 50;
  display: flex; align-items: center; gap: 12px;
  margin: 14px 0 10px; padding: 10px 10px 10px 16px; border-radius: 18px;
  background: rgba(255,255,255,.92); border: 1px solid rgba(255,255,255,.9);
  box-shadow: 0 2px 6px rgba(15,23,42,.05), 0 16px 36px -20px rgba(15,23,42,.35);
}
.test-bar-text { flex: 1 1 auto; min-width: 0; }
.test-title { font-family: var(--font-display, serif); font-size: 16px; font-weight: 700; color: #0f172a;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; outline: none; }
.test-progress { margin-top: 2px; font-size: 12px; color: var(--text-muted, #475569); }
.test-progress strong { color: var(--primary, #047857); }
.test-clock { margin-left: 8px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--fn-time, #0f766e); }
.test-clock.is-low { color: #b91c1c; }
.test-meter { position: absolute; left: 18px; right: 18px; bottom: 0; height: 3px; border-radius: 3px; overflow: hidden; }
.test-meter > div { height: 100%; width: 0; background: var(--primary, #047857); transition: width .3s ease; }
.test-exit {
  flex: 0 0 auto; min-height: 40px; padding: 8px 14px; border-radius: 12px; cursor: pointer;
  font-size: 13px; font-weight: 700; color: #334155; background: #fff; border: 1px solid #cbd5e1;
}
.test-exit:hover { border-color: #94a3b8; }

.test-q {
  min-width: 0;   /* fieldset 预设 min-width: min-content，长题干会把卡片撑出画面 */
  border: 1px solid rgba(255,255,255,.9); border-radius: 20px; margin: 0 0 14px; padding: 20px 20px 16px;
  /* 一整页十几张卡，不用毛玻璃：手机上背景会动，玻璃每帧都要重算（见 docs/DESIGN.md 原则 3） */
  background: rgba(255,255,255,.9);
  box-shadow: 0 1px 2px rgba(15,23,42,.05), 0 10px 24px -14px rgba(15,23,42,.18);
  transition: border-color .2s ease, box-shadow .2s ease;
}
.test-q.is-missing { border-color: #b45309; box-shadow: 0 0 0 3px rgba(180,83,9,.15); }
.test-q-head { display: flex; gap: 12px; align-items: flex-start; padding: 0; margin-bottom: 14px;
  font-size: 16px; font-weight: 600; line-height: 1.6; color: #0f172a; }
/* legend 预设会骑在 fieldset 的上边框线上；浮动之後才会乖乖待在卡片里 */
legend.test-q-head { float: left; width: 100%; }
.test-q > .test-fig, .test-q > .test-opts { clear: both; }
.test-q-no { flex: 0 0 auto; min-width: 28px; height: 28px; margin-top: 1px; border-radius: 8px;
  display: grid; place-items: center; font-size: 13px; font-weight: 800;
  color: #065f46; background: rgba(4,120,87,.1); }
.test-q.is-answered .test-q-no { color: #fff; background: var(--primary, #047857); }
.test-q-text { flex: 1 1 auto; min-width: 0; white-space: pre-line; }
.test-fig { margin: 0 0 14px; text-align: center; }
.test-fig img { max-width: 100%; border-radius: 10px; cursor: zoom-in; }
.test-fig-cap { margin-top: 6px; font-size: 12px; color: var(--text-muted, #475569); }

.test-opts { display: flex; flex-direction: column; gap: 8px; }
.test-opt {
  position: relative; display: flex; align-items: flex-start; gap: 12px; cursor: pointer;
  min-height: 48px; padding: 12px 14px; border-radius: 13px;
  font-size: 16px; line-height: 1.6; color: #334155;
  background: #fff; border: 1px solid #e2e8f0;
  transition: border-color .15s ease, background .15s ease;
}
.test-opt:hover { border-color: rgba(4,120,87,.45); }
.test-opt input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
.test-opt input:focus-visible ~ .opt-badge { outline: 2.5px solid var(--accent, #0284c7); outline-offset: 2px; }
.test-opt.is-checked { border-color: var(--primary, #047857); background: #ecfdf5; color: #064e3b; font-weight: 600; }
.test-opt.is-checked .opt-badge { background: #047857; border-color: #047857; color: #fff; }

.test-submit-row { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 20px; }
.test-submit {
  min-height: 50px; min-width: 220px; padding: 12px 28px; border-radius: 14px; border: 0; cursor: pointer;
  font-size: 16px; font-weight: 800; color: #fff; background: var(--primary, #047857);
  box-shadow: 0 12px 24px -12px rgba(4,120,87,.8);
}
.test-submit:hover { background: var(--primary-dark, #065f46); }
.test-submit[aria-disabled="true"] { background: #e2e8f0; color: #334155; box-shadow: none; }
.test-submit-note { font-size: 13px; color: var(--text-muted, #475569); text-align: center; }
.test-submit-note.is-warn { color: #92400e; font-weight: 700; }

.test-result {
  text-align: center; margin: 4px 0 16px; padding: 28px 20px 24px; border-radius: 22px;
  background: rgba(255,255,255,.92); border: 1px solid rgba(255,255,255,.9);
  box-shadow: 0 1px 2px rgba(15,23,42,.05), 0 18px 40px -20px rgba(15,23,42,.3);
}
.test-score { font-family: var(--font-display, serif); font-size: 23px; color: #334155; outline: none; }
.test-score strong { font-size: 56px; line-height: 1; color: var(--primary, #047857); margin-right: 4px; }
.test-score-pct { margin-top: 6px; font-size: 13px; font-weight: 700; color: var(--text-muted, #475569); }
.test-score-msg { margin: 12px auto 0; max-width: 420px; font-size: 14px; line-height: 1.75; color: #334155; }
.test-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 20px; }
.test-btn {
  min-height: 44px; padding: 10px 16px; border-radius: 12px; cursor: pointer; font-size: 14px; font-weight: 700;
  background: #fff; color: var(--primary, #047857); border: 1px solid rgba(4,120,87,.35);
}
.test-btn.primary { background: var(--primary, #047857); color: #fff; border-color: var(--primary, #047857); }
.test-btn:hover { border-color: var(--primary, #047857); }
.test-time-note { margin-top: 6px; font-size: 13px; color: var(--text-muted, #475569); }
.test-unanswered { margin-top: 10px; font-size: 13px; font-weight: 700; color: #92400e; }
.test-retake-note { margin-top: 14px; font-size: 12px; color: var(--text-muted, #475569); }

.test-review-title { margin: 20px 4px 10px; font-size: 13px; font-weight: 700; color: var(--text-main, #0f172a); }
.test-opt.is-right { border-color: #047857; background: #ecfdf5; color: #064e3b; font-weight: 600; cursor: default; }
.test-opt.is-right .opt-badge { background: #047857; border-color: #047857; color: #fff; }
.test-opt.is-wrong { border-color: #dc2626; background: #fef2f2; color: #991b1b; cursor: default; }
.test-opt.is-wrong .opt-badge { background: #dc2626; border-color: #dc2626; color: #fff; }
.test-opt.is-plain { cursor: default; }
.test-opt.is-plain:hover { border-color: #e2e8f0; }
.test-tag { margin-left: auto; align-self: center; flex: 0 0 auto; white-space: nowrap;
  font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; border: 1px solid currentColor; }
.test-q.is-result-wrong { border-color: rgba(220,38,38,.35); }
.test-exp { margin-top: 12px; padding: 12px 14px; border-radius: 10px; border-left: 4px solid #047857;
  background: #f0fdf4; color: #166534; font-size: 14px; line-height: 1.75; }

.test-confirm { position: fixed; inset: 0; z-index: 1600; display: grid; place-items: center; padding: 20px;
  background: rgba(15,23,42,.42); }
.test-confirm[hidden] { display: none; }
.test-confirm-box { width: min(360px, 100%); padding: 20px; border-radius: 18px; background: #fff;
  box-shadow: 0 24px 60px -20px rgba(15,23,42,.5); }
.test-confirm-title { font-size: 16px; font-weight: 800; color: #0f172a; }
.test-confirm-body { margin-top: 8px; font-size: 14px; line-height: 1.75; color: #334155; }
.test-confirm-row { display: flex; gap: 10px; margin-top: 16px; }
.test-confirm-row .test-btn { flex: 1 1 0; }
.test-btn.danger { background: #b91c1c; border-color: #b91c1c; color: #fff; }

@media (max-width: 480px) {
  .test-q { padding: 16px 14px 12px; border-radius: 16px; }
  .test-opt { padding: 10px 12px; }
  .test-score strong { font-size: 40px; }
}
@media (prefers-reduced-motion: reduce) {
  .test-meter > div, .test-q, .test-opt { transition: none; }
}`;

  const LETTERS = 'ABCDEFGH';
  const still = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let root, titleEl, progressEl, meterEl, exitBtn, bodyEl, confirmEl, confirmBody, keepBtn;
  let state = null;   // { opts, items, answers: Map, submitted, recorded: Set, guarded }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  // "A. 淀粉和糖原" → ['A', '淀粉和糖原']；没有前缀的就依序补字母
  function splitOption(opt, i) {
    const m = String(opt).match(/^\s*([A-Ha-h])[.、．]\s*([\s\S]*)$/);
    return m ? [m[1].toUpperCase(), m[2]] : [LETTERS[i] || String(i + 1), String(opt)];
  }

  // 题干、图说、解析与练习模式一样以 HTML 呈现（题库里有 <sub>、<br> 等）
  function htmlNode(tag, cls, html) {
    const n = el(tag, cls);
    n.innerHTML = html || '';
    return n;
  }

  function figureNode(item) {
    if (item.image) {
      const box = el('div', 'test-fig');
      const img = el('img');
      img.src = item.image;
      img.alt = '题目附图';
      img.addEventListener('click', () => { if (typeof window.openImageModal === 'function') window.openImageModal(item.image); });
      box.appendChild(img);
      return box;
    }
    if (item.figure) {
      const box = htmlNode('div', 'test-fig', item.figure);
      if (item.caption) box.appendChild(htmlNode('div', 'test-fig-cap', item.caption));
      return box;
    }
    return null;
  }

  function build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    root = el('div', 'view');
    root.id = 'viewTest';
    root.setAttribute('aria-labelledby', 'testTitle');

    const bar = el('div', 'test-bar');
    const text = el('div', 'test-bar-text');
    titleEl = el('h1', 'test-title');
    titleEl.id = 'testTitle';
    titleEl.tabIndex = -1;
    progressEl = el('div', 'test-progress');
    progressEl.setAttribute('aria-live', 'polite');
    text.append(titleEl, progressEl);
    exitBtn = el('button', 'test-exit', '退出测验');
    exitBtn.type = 'button';
    exitBtn.addEventListener('click', requestExit);
    const meter = el('div', 'test-meter');
    meterEl = el('div');
    meter.appendChild(meterEl);
    bar.append(text, exitBtn, meter);

    bodyEl = el('div', 'test-body');

    confirmEl = el('div', 'test-confirm');
    confirmEl.hidden = true;
    const box = el('div', 'test-confirm-box');
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'testConfirmTitle');
    box.setAttribute('aria-describedby', 'testConfirmBody');
    const ct = el('div', 'test-confirm-title', '要退出测验吗？');
    ct.id = 'testConfirmTitle';
    confirmBody = el('div', 'test-confirm-body');
    confirmBody.id = 'testConfirmBody';
    const row = el('div', 'test-confirm-row');
    keepBtn = el('button', 'test-btn', '继续作答');
    keepBtn.type = 'button';
    keepBtn.addEventListener('click', hideConfirm);
    const leave = el('button', 'test-btn danger', '退出测验');
    leave.type = 'button';
    leave.addEventListener('click', () => { hideConfirm(); close(); });
    row.append(keepBtn, leave);
    box.append(ct, confirmBody, row);
    confirmEl.appendChild(box);
    confirmEl.addEventListener('click', e => { if (e.target === confirmEl) hideConfirm(); });

    root.append(bar, bodyEl, confirmEl);
    (document.getElementById('main') || document.body).appendChild(root);

    document.addEventListener('keydown', e => {
      // 导览（js/onboarding.js）已经处理掉的键（按 Esc 关导览）不要再拿来退出测验
      if (!state || e.defaultPrevented) return;
      if (!confirmEl.hidden) {
        if (e.key === 'Escape') { e.preventDefault(); hideConfirm(); }
        else if (e.key === 'Tab') {   // 两颗按钮之间来回
          const f = confirmEl.querySelectorAll('button');
          const i = [...f].indexOf(document.activeElement);
          e.preventDefault();
          f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
        }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); requestExit(); }
    });
  }

  /* ---------- 作答 ---------- */
  function renderForm() {
    const s = state;
    s.submitted = false;
    s.answers = new Map();
    bodyEl.replaceChildren();

    const form = el('form', 'test-form');
    form.noValidate = true;
    s.items.forEach((item, n) => {
      const fs = el('fieldset', 'test-q');
      fs.id = 'tq-' + n;
      const head = el('legend', 'test-q-head');
      head.append(el('span', 'test-q-no', String(n + 1)), htmlNode('span', 'test-q-text', item.q));
      fs.appendChild(head);
      const fig = figureNode(item);
      if (fig) fs.appendChild(fig);

      const list = el('div', 'test-opts');
      (item.options || []).forEach((opt, oi) => {
        const [letter, txt] = splitOption(opt, oi);
        const lab = el('label', 'test-opt');
        const input = el('input');
        input.type = 'radio';
        input.name = 'tq' + n;
        input.value = String(oi);
        input.addEventListener('change', () => {
          s.answers.set(n, oi);
          list.querySelectorAll('.test-opt').forEach(o => o.classList.toggle('is-checked', o === lab));
          fs.classList.add('is-answered');
          fs.classList.remove('is-missing');
          if (!s.guarded) { s.guarded = true; window.addEventListener('beforeunload', guard); }
          updateProgress();
        });
        lab.append(input, el('span', 'opt-badge', letter), el('span', 'opt-text', txt));
        list.appendChild(lab);
      });
      fs.appendChild(list);
      form.appendChild(fs);
    });

    const submitRow = el('div', 'test-submit-row');
    const submit = el('button', 'test-submit');
    submit.type = 'submit';
    const note = el('div', 'test-submit-note');
    note.id = 'testSubmitNote';
    submit.setAttribute('aria-describedby', 'testSubmitNote');
    submitRow.append(submit, note);
    form.appendChild(submitRow);
    form.addEventListener('submit', e => { e.preventDefault(); trySubmit(); });

    bodyEl.appendChild(form);
    s.submitBtn = submit;
    s.noteEl = note;
    updateProgress();
  }

  function updateProgress() {
    const s = state;
    const total = s.items.length;
    const done = s.answers.size;
    const left = total - done;
    progressEl.innerHTML = `已答 <strong>${done}</strong> / ${total}`;
    if (s.deadline) progressEl.appendChild(s.clockEl);
    meterEl.style.width = `${total ? Math.round(done / total * 100) : 0}%`;
    // 不用 disabled：disabled 的按钮不能聚焦、读屏也不会念，学生不知道为什么按不了
    s.submitBtn.setAttribute('aria-disabled', String(left > 0 && !s.deadline));
    s.submitBtn.textContent = left > 0 ? `交卷（还差 ${left} 题）` : '交卷';
    s.noteEl.classList.remove('is-warn');
    s.warnedMissing = false;
    s.noteEl.textContent = s.deadline
      ? (left > 0 ? '时间到会自动交卷，没答的算错。可以提早交卷。' : '全部答完了。可以再检查一次，或现在交卷。')
      : (left > 0 ? '全部答完才能交卷。交卷前可以随时改答案。' : '全部答完了。交卷後会显示分数和每一题的解析。');
  }

  /* ---------- 计时 ---------- */
  const mmss = ms => {
    const t = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  };
  function startClock() {
    const s = state;
    stopClock();
    s.deadline = Date.now() + s.opts.timeLimitMs;
    s.startedAt = Date.now();
    s.clockEl = el('span', 'test-clock');
    // 每秒更新的数字不放进 aria-live，否则读屏会一直念；只在剩 5 分钟、1 分钟时各报一次
    s.clockEl.setAttribute('aria-hidden', 'true');
    s.announced = new Set();
    tick();
    s.timer = setInterval(tick, 1000);
  }
  function tick() {
    const s = state;
    if (!s || !s.deadline) return;
    const left = s.deadline - Date.now();
    s.clockEl.textContent = `剩 ${mmss(left)}`;
    s.clockEl.classList.toggle('is-low', left <= 5 * 60 * 1000);
    [5, 1].forEach(min => {
      if (left <= min * 60 * 1000 && left > 0 && !s.announced.has(min) && s.opts.timeLimitMs > min * 60 * 1000) {
        s.announced.add(min);
        s.noteEl.textContent = `只剩 ${min} 分钟。`;
        s.noteEl.classList.add('is-warn');
      }
    });
    if (left <= 0) {
      s.timedOut = true;
      confirmEl.hidden = true;
      grade();
    }
  }
  function stopClock() {
    if (state && state.timer) { clearInterval(state.timer); state.timer = null; }
  }
  // 暂停／继续倒数：第一次进模拟统考、导览还开着时先不计时（js/onboarding.js 呼叫）
  function hold(on) {
    const s = state;
    if (!s || !s.deadline) return false;
    if (on && !s.heldAt) { s.heldAt = Date.now(); stopClock(); }
    else if (!on && s.heldAt) {
      const paused = Date.now() - s.heldAt;
      s.deadline += paused; s.startedAt += paused; s.heldAt = 0;
      tick();
      if (s.deadline) s.timer = setInterval(tick, 1000);
    }
    return true;
  }

  function trySubmit() {
    const s = state;
    const missing = s.items.map((_, n) => n).filter(n => !s.answers.has(n));
    if (missing.length && !(s.deadline && s.warnedMissing)) {
      if (s.deadline) s.warnedMissing = true;
      missing.forEach(n => document.getElementById('tq-' + n).classList.add('is-missing'));
      const list = missing.slice(0, 8).map(n => n + 1).join('、') + (missing.length > 8 ? ' …' : '');
      s.noteEl.textContent = `还有 ${missing.length} 题没答：第 ${list} 题` + (s.deadline ? '。再按一次交卷，没答的算错。' : '');
      s.noteEl.classList.add('is-warn');
      const first = document.getElementById('tq-' + missing[0]);
      first.scrollIntoView({ block: 'center', behavior: still() ? 'auto' : 'smooth' });
      const input = first.querySelector('input');
      if (input) input.focus({ preventScroll: true });
      return;
    }
    grade();
  }

  /* ---------- 交卷 ---------- */
  function grade() {
    const s = state;
    s.submitted = true;
    if (s.deadline) s.usedMs = Math.min(Date.now() - s.startedAt, s.opts.timeLimitMs);
    stopClock();
    s.deadline = 0;
    unguard();
    const results = s.items.map((item, n) => {
      const chosen = s.answers.get(n);
      return { item, n, chosen, correct: chosen === item.answer };
    });
    let fresh = 0;
    results.forEach(r => {
      if (s.recorded.has(r.item.idx)) return;
      s.recorded.add(r.item.idx);
      fresh += 1;
      // 没作答只在分数上算错，不写进错题本与复习排程：没答不等於不会（模拟统考放著不管，整份卷会变成错题）
      if (r.chosen !== undefined) s.opts.onRecord(r.item.idx, r.correct);
    });
    const right = results.filter(r => r.correct).length;
    if (s.opts.playSound) { try { s.opts.playSound(right === results.length ? 'achieve' : 'flip'); } catch (e) {} }
    renderResults(results, right, fresh);
  }

  function renderResults(results, right, fresh) {
    const s = state;
    const total = results.length;
    const wrong = results.filter(r => !r.correct);
    const pct = Math.round(right / total * 100);
    progressEl.innerHTML = `已交卷 · 答对 <strong>${right}</strong> / ${total}`;
    meterEl.style.width = '100%';
    bodyEl.replaceChildren();

    const card = el('div', 'test-result');
    const score = el('h2', 'test-score');
    score.tabIndex = -1;
    score.innerHTML = `<strong>${right}</strong>/ ${total}`;
    score.setAttribute('aria-label', `答对 ${right} 题，共 ${total} 题`);
    const scope = s.opts.timeLimitMs ? '这份卷' : '这一章';
    const msg = wrong.length === 0
      ? `全对。${scope}可以放心了，之後会按复习排程再问你。`
      : pct >= 60
        ? `还有 ${wrong.length} 题要回头看。答错的已经收进错题本，明天会再问你。`
        : `${scope}还不熟。先把下面的解析看一遍，再重做答错的 ${wrong.length} 题。`;
    card.append(score, el('div', 'test-score-pct', `答对 ${pct}%`), el('p', 'test-score-msg', msg));
    if (s.usedMs) {
      const blank = results.filter(r => r.chosen === undefined).length;
      const blankNote = blank ? `；没答的 ${blank} 题算错，但不收进错题本` : '';
      card.appendChild(el('p', 'test-time-note', s.timedOut
        ? `时间到，自动交卷${blankNote}。`
        : `用时 ${mmss(s.usedMs)}（限时 ${mmss(s.opts.timeLimitMs)}）${blankNote}`));
      s.usedMs = 0;
    }

    const actions = el('div', 'test-actions');
    if (wrong.length) {
      const redo = el('button', 'test-btn primary', `重做答错的 ${wrong.length} 题`);
      redo.type = 'button';
      redo.addEventListener('click', () => restart(wrong.map(r => r.item), '重做答错的题'));
      actions.appendChild(redo);
    }
    const again = el('button', 'test-btn' + (wrong.length ? '' : ' primary'), s.opts.timeLimitMs ? '同一份卷再考一次' : '整章再测一次');
    again.type = 'button';
    again.addEventListener('click', () => restart(s.all, '', true));
    const back = el('button', 'test-btn', '返回练习');
    back.type = 'button';
    back.addEventListener('click', close);
    actions.append(again, back);
    card.appendChild(actions);
    if (fresh < total) {
      card.appendChild(el('p', 'test-retake-note',
        fresh === 0 ? '这次是重做，不计入复习排程（刚看过答案，答对不代表记住了）。'
                    : `其中 ${total - fresh} 题这次测验里已经交过，重做的部分不计入复习排程。`));
    }
    bodyEl.appendChild(card);

    bodyEl.appendChild(el('div', 'test-review-title', '逐题解析'));
    results.forEach(r => {
      const fs = el('section', 'test-q' + (r.correct ? '' : ' is-result-wrong'));
      const head = el('div', 'test-q-head');
      const no = el('span', 'test-q-no', String(r.n + 1));
      head.append(no, htmlNode('span', 'test-q-text', r.item.q));
      fs.appendChild(head);
      const fig = figureNode(r.item);
      if (fig) fs.appendChild(fig);
      const list = el('div', 'test-opts');
      (r.item.options || []).forEach((opt, oi) => {
        const [letter, txt] = splitOption(opt, oi);
        const isAns = oi === r.item.answer;
        const isMine = oi === r.chosen;
        const row = el('div', 'test-opt ' + (isAns ? 'is-right' : isMine ? 'is-wrong' : 'is-plain'));
        row.append(el('span', 'opt-badge', letter), el('span', 'opt-text', txt));
        // 对错不能只靠颜色
        if (isAns) row.appendChild(el('span', 'test-tag', isMine ? '你的答案 · 正确' : '正确答案'));
        else if (isMine) row.appendChild(el('span', 'test-tag', '你的答案'));
        list.appendChild(row);
      });
      fs.appendChild(list);
      if (r.chosen === undefined) fs.appendChild(el('p', 'test-unanswered', '这题没作答，算错。'));
      if (r.item.explanation) fs.appendChild(htmlNode('div', 'test-exp', r.item.explanation));
      bodyEl.appendChild(fs);
    });

    window.scrollTo({ top: 0, behavior: still() ? 'auto' : 'smooth' });
    score.focus({ preventScroll: true });
  }

  // 计时模式下，只有整份再考才重新计时；重做答错的题是订正，不限时
  function restart(items, suffix, timed) {
    state.items = items;
    state.timedOut = false;
    titleEl.textContent = state.baseTitle + (suffix ? ` · ${suffix}` : '');
    renderForm();
    if (timed && state.opts.timeLimitMs) { startClock(); updateProgress(); }
    window.scrollTo({ top: 0, behavior: still() ? 'auto' : 'smooth' });
    titleEl.focus({ preventScroll: true });
  }

  /* ---------- 离开 ---------- */
  function guard(e) { e.preventDefault(); e.returnValue = ''; }
  function unguard() {
    if (state && state.guarded) { window.removeEventListener('beforeunload', guard); state.guarded = false; }
  }

  function requestExit() {
    const s = state;
    if (!s) return;
    if (s.submitted || (s.answers.size === 0 && !s.deadline)) { close(); return; }
    confirmBody.textContent = `已答 ${s.answers.size} / ${s.items.length} 题。退出後这次作答不会保存，也不会计分。`
      + (s.deadline ? '计时不会暂停。' : '');
    confirmEl.hidden = false;
    keepBtn.focus();   // 预设停在「继续作答」：误按 Esc 或退出时，最安全的选择
  }
  function hideConfirm() {
    confirmEl.hidden = true;
    exitBtn.focus();
  }

  function close() {
    if (!state) return;
    stopClock();
    unguard();
    const opts = state.opts;
    state = null;
    confirmEl.hidden = true;
    document.body.classList.remove('in-test');
    opts.onClose();
  }

  /* ---------- 对外 ---------- */
  // opts: { subjectLabel, chapterTitle, questions: [{ q, options, answer, explanation, image, figure, caption, idx }],
  //         showView(id), onRecord(idx, correct), onClose(), playSound?,
  //         timeLimitMs?（有值就是计时模式）, label?（标题後缀，预设「测验」） }
  function start(opts) {
    if (!root) build();
    const items = (opts.questions || []).filter(q => Array.isArray(q.options) && q.options.length);
    if (!items.length) return false;
    state = {
      opts, items, all: items, answers: new Map(), submitted: false, guarded: false,
      recorded: new Set(),
      baseTitle: `${opts.subjectLabel ? opts.subjectLabel + ' · ' : ''}${opts.chapterTitle} ${opts.label || '测验'}`,
    };
    titleEl.textContent = state.baseTitle;
    document.body.classList.add('in-test');
    opts.showView('viewTest');
    renderForm();
    if (opts.timeLimitMs) {
      startClock();
      updateProgress();
      // 计时一开始就算作答中：误关分页要先问
      state.guarded = true;
      window.addEventListener('beforeunload', guard);
    }
    window.scrollTo(0, 0);
    titleEl.focus({ preventScroll: true });
    return true;
  }

  window.UECTest = { start, hold, isActive: () => Boolean(state), isTimed: () => Boolean(state && state.opts.timeLimitMs) };
})();
