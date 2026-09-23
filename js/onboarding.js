/* 画面导览（聚光灯）
 * ------------------------------------------------------------
 * 每个画面第一次进去时，把画面压暗、只留一个亮框，逐一指著介绍那个画面有的功能。
 * 哪些画面看过记在 localStorage（UEC_TOUR_v1），没有帐号概念；工具列的「引导」随时重看当前画面。
 *
 * 规则：
 *   - 每个画面最多五步。引导太长学生会直接跳过，等於白做。
 *   - 找不到目标的步骤自动略过（例如还没有笔记时，就不介绍笔记卡上的按钮）。
 *   - 不用 backdrop-filter：背景是会动的水彩，模糊每帧都要重算（设计原则 3）。
 *   - 网址带 ?guide=1 会强制重看当前画面，方便自己检查。
 */
(function () {
  'use strict';

  const KEY = 'UEC_TOUR_v1';
  const VIEW_TO_TOUR = {
    viewSubjects: 'home', viewStudy: 'study', viewTest: 'test',
    viewNotes: 'notes', viewArchive: 'archive', viewFeedback: 'feedback',
  };

  /* ---------- 每个画面的导览内容 ---------- */
  const TOURS = {
    home: [
      { target: null, title: '欢迎来到独中理科',
        body: '这是给<strong>董总统考（UEC）</strong>理科准备的自主练习站。花 20 秒认识一下首页；之後想再看，按工具列的「引导」。' },
      { target: '#examNext', title: '下一场统考',
        body: '这里永远写著<strong>最靠近的那一科</strong>和日期（日/月），依 2026 年高中统考时间表。考完一科，它会自己换到下一科。' },
      { target: '#orbitStage', title: '从轨道挑一科',
        body: '点一下圆球，它会转到正上方并显示你的掌握进度；按「进入」开始，点其他地方取消。' },
      { target: '.util-actions', title: '工具列',
        body: '音效、背景音乐、<strong>护眼</strong>（深夜读书用的深色画面）、同步、引导。开著的会变成绿色。' },
      { target: '#syncBtn', title: '换装置不会丢进度',
        body: '按「同步」产生一串码，在另一台装置输入同一串，进度、笔记、错题本就会<strong>合并</strong>在一起。不用注册。' },
    ],
    study: [
      { target: '#chapterRail', title: '章节',
        body: '每张卡是一章，底下写著你掌握到哪：还没开始写题数，做了一半有进度条，全部掌握会打勾。' },
      { target: '.sub-bookmark-bar', title: '四种练法',
        body: '<strong>选择题</strong>、<strong>做答题</strong>（背书闪卡）、<strong>错题本</strong>（答错会自动收进来，要在不同的两天都答对才移出）、<strong>今日复习</strong>（系统算好今天该看的题）。' },
      { target: '#optContainer', title: '作答',
        body: '点一个选项作答，立刻看到对错和解析。有键盘的话，A–D 作答、←/→ 换题。' },
      { target: '.test-entry', title: '整章测验',
        body: '想模拟考试就用这个：一次列出整章，全部答完才能交卷，交卷才看答案。' },
      { target: '.card-note-btn', title: '做笔记',
        body: '把这一题导入成自己的笔记，可以手写、画图、打字。之後在上方「笔记」里都找得到。' },
    ],
    test: [
      { target: '.test-q', title: '整章测验',
        body: '这一章的选择题全部列在这里。<strong>全部答完才能交卷</strong>，交卷之後才看答案；只有第一次交卷会算进复习排程。' },
      { target: '.test-exit', title: '中途离开',
        body: '按「退出测验」可以离开；已经作答的话会先问你一次，避免误按。' },
    ],
    notes: [
      { target: '#viewNotes .page-heading', title: '我的笔记',
        body: '在题目卡右下角按「做笔记」，那一题就会存到这里。可以手写、画图、打字。' },
      { target: '.note-card-actions', title: '每一则笔记',
        body: '「编辑」继续写，「前往该题」回到那道题，<strong>红色的「删除」</strong>会把笔记删掉。' },
    ],
    archive: [
      { target: '#archiveListArea', title: '题目档',
        body: '勾选想要的章节或题目，整理成一份可以带走的题目档。' },
      { target: '.archive-toolbar', title: '下载或打印',
        body: '选好之後按「下载 PDF」，或用「打印版」直接列印。' },
    ],
    feedback: [
      { target: '#fbText', title: '哪里出错了？',
        body: '答案有误、画面坏掉、按了没反应——写在这里，写得越具体越快修好。' },
      { target: '#spriteChar', title: '这是小精灵',
        body: '你提交的问题被解决之後，它会飞到右下角通知你。点它会告诉你改了什么，还能直接带你去看。',
        before: () => window.spriteDemo && window.spriteDemo(true),
        after: () => window.spriteDemo && window.spriteDemo(false) },
    ],
  };

  const CSS = `
.tour-block{position:fixed;inset:0;z-index:1500;}
.tour-spot{position:fixed;z-index:1501;pointer-events:none;border-radius:16px;
  box-shadow:0 0 0 9999px rgba(15,23,42,.55);outline:3px solid var(--retro-cream,#f6efdd);outline-offset:0;
  transition:top .38s cubic-bezier(.22,1,.36,1),left .38s cubic-bezier(.22,1,.36,1),
    width .38s cubic-bezier(.22,1,.36,1),height .38s cubic-bezier(.22,1,.36,1),border-radius .38s ease;}
.tour-spot.is-center{outline:none;}
.tour-tip{position:fixed;z-index:1502;width:min(340px,calc(100vw - 32px));padding:16px 16px 12px;
  border-radius:16px;background:var(--retro-cream,#f6efdd);border:2px solid var(--retro-teal-dark,#3c676e);
  box-shadow:0 4px 0 rgba(77,129,137,.25),0 20px 44px -16px rgba(15,23,42,.45);
  opacity:0;transform:translateY(6px);transition:opacity .22s ease,transform .3s cubic-bezier(.22,1,.36,1);}
.tour-tip.is-shown{opacity:1;transform:none;}
.tour-tip::before{content:'';position:absolute;left:var(--arrow-x,50%);width:14px;height:14px;margin-left:-8px;
  background:inherit;border:inherit;border-right:0;border-bottom:0;}
.tour-tip.below::before{top:-9px;transform:rotate(45deg);}
.tour-tip.above::before{bottom:-9px;transform:rotate(225deg);}
.tour-tip.center::before{display:none;}
.tour-title{font-family:var(--font-display,serif);font-size:16px;font-weight:800;color:var(--retro-dark,#3f3e3c);}
.tour-body{margin-top:6px;font-size:14px;line-height:1.6;color:#334155;}
.tour-body strong{color:var(--fn-go,#047857);}
.tour-foot{display:flex;align-items:center;gap:8px;margin-top:12px;}
.tour-step{font-size:12px;font-weight:700;color:var(--retro-teal-dark,#3c676e);font-variant-numeric:tabular-nums;margin-right:auto;}
.tour-btn{min-height:36px;padding:8px 14px;border-radius:10px;border:0;cursor:pointer;font-size:13px;font-weight:700;}
.tour-btn.go{background:var(--fn-go,#047857);color:#fff;}
.tour-btn.go:hover{filter:brightness(1.08);}
.tour-btn.quiet{background:transparent;color:#475569;}
.tour-btn.quiet:hover{color:#0f172a;}
[data-theme="night"] .tour-tip{background:var(--n-raised,#2c2924);border-color:var(--n-border-strong,rgba(240,228,206,.22));
  box-shadow:0 4px 0 rgba(0,0,0,.3),0 20px 44px -16px rgba(0,0,0,.7);}
[data-theme="night"] .tour-spot{box-shadow:0 0 0 9999px rgba(0,0,0,.62);outline-color:var(--n-text-2,#c4bba9);}
[data-theme="night"] .tour-title{color:var(--n-text,#e8e1d4);}
[data-theme="night"] .tour-body{color:var(--n-text-2,#c4bba9);}
[data-theme="night"] .tour-step{color:var(--n-text-2,#c4bba9);}
[data-theme="night"] .tour-btn.go{background:var(--n-btn,#2b634b);color:var(--n-btn-text,#f3eee4);}
[data-theme="night"] .tour-btn.quiet{color:var(--n-text-2,#c4bba9);}
@media (prefers-reduced-motion: reduce){.tour-spot,.tour-tip{transition:none;}}
`;

  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const readSeen = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
  const markSeen = tour => {
    const seen = readSeen(); seen[tour] = 1;
    try { localStorage.setItem(KEY, JSON.stringify(seen)); } catch (e) {}
  };
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;   // 只有本档案里写死的字串会进来
    return n;
  };
  const visible = node => {
    if (!node) return false;
    const r = node.getBoundingClientRect(), cs = getComputedStyle(node);
    return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };

  let block, spot, tip, tourName = null, steps = [], index = 0, returnTo = null, target = null, rafId = 0;

  function currentTourName() {
    const test = document.getElementById('viewTest');
    if (test && test.classList.contains('active')) return 'test';
    const v = document.querySelector('.view.active');
    return v ? VIEW_TO_TOUR[v.id] : null;
  }

  // 找下一个（或上一个）找得到目标的步骤
  function resolveStep(from, dir) {
    for (let i = from; i >= 0 && i < steps.length; i += dir) {
      const s = steps[i];
      if (s.before) s.before();
      if (!s.target || visible(document.querySelector(s.target))) return i;
      if (s.after) s.after();
    }
    return -1;
  }

  function place() {
    rafId = 0;
    if (!tip) return;
    const vw = innerWidth, vh = innerHeight, pad = 8, gap = 14;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.classList.remove('below', 'above', 'center');
    if (!target) {
      Object.assign(spot.style, { top: `${vh / 2}px`, left: `${vw / 2}px`, width: '0px', height: '0px' });
      spot.classList.add('is-center');
      tip.classList.add('center');
      tip.style.left = `${Math.round((vw - tw) / 2)}px`;
      tip.style.top = `${Math.round((vh - th) / 2)}px`;
      return;
    }
    spot.classList.remove('is-center');
    const r = target.getBoundingClientRect();
    const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
    const w = Math.min(vw - 8, r.width + pad * 2), h = Math.min(vh - 8, r.height + pad * 2);
    Object.assign(spot.style, { top: `${top}px`, left: `${left}px`, width: `${w}px`, height: `${h}px` });

    let y, side;
    if (top + h + gap + th <= vh - 8) { y = top + h + gap; side = 'below'; }
    else if (top - gap - th >= 8) { y = top - gap - th; side = 'above'; }
    else { y = vh - th - 12; side = 'center'; }   // 目标太高：提示框贴底，不画尖角
    const cx = left + w / 2;
    const x = Math.min(vw - tw - 16, Math.max(16, cx - tw / 2));
    tip.classList.add(side);
    tip.style.left = `${Math.round(x)}px`;
    tip.style.top = `${Math.round(y)}px`;
    tip.style.setProperty('--arrow-x', `${Math.round(Math.min(tw - 20, Math.max(20, cx - x)))}px`);
  }
  const schedulePlace = () => { if (!rafId) rafId = requestAnimationFrame(place); };

  function render() {
    const s = steps[index];
    target = s.target ? document.querySelector(s.target) : null;
    const shown = steps.filter(x => !x.target || document.querySelector(x.target)).length;
    const pos = steps.slice(0, index + 1).filter(x => !x.target || document.querySelector(x.target)).length;

    tip.classList.remove('is-shown');
    tip.replaceChildren();
    const title = el('div', 'tour-title', s.title); title.id = 'tourTitle';
    const body = el('div', 'tour-body', s.body); body.id = 'tourBody';
    const foot = el('div', 'tour-foot');
    foot.appendChild(el('span', 'tour-step', `${pos} / ${shown}`));
    const hasPrev = resolvePrevExists();
    if (hasPrev) {
      const back = el('button', 'tour-btn quiet', '上一步'); back.type = 'button';
      back.onclick = () => go(-1);
      foot.appendChild(back);
    } else {
      const skip = el('button', 'tour-btn quiet', '跳过'); skip.type = 'button';
      skip.onclick = finish;
      foot.appendChild(skip);
    }
    const last = resolveNextIndex() === -1;
    const next = el('button', 'tour-btn go', last ? '知道了' : '下一步'); next.type = 'button';
    next.onclick = () => (last ? finish() : go(1));
    foot.appendChild(next);
    tip.append(title, body, foot);

    if (target) target.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    // 等捲动落定再定位，否则亮框会对到捲动前的位置
    setTimeout(() => { place(); tip.classList.add('is-shown'); next.focus({ preventScroll: true }); }, target && !reduced() ? 360 : 30);
  }

  function resolveNextIndex() {
    for (let i = index + 1; i < steps.length; i++) {
      const s = steps[i];
      if (!s.target || s.before || visible(document.querySelector(s.target))) return i;
    }
    return -1;
  }
  function resolvePrevExists() {
    for (let i = index - 1; i >= 0; i--) {
      const s = steps[i];
      if (!s.target || visible(document.querySelector(s.target))) return true;
    }
    return false;
  }

  function go(dir) {
    const cur = steps[index];
    if (cur.after) cur.after();
    const i = resolveStep(index + dir, dir);
    if (i === -1) { if (dir > 0) finish(); else { if (cur.before) cur.before(); } return; }
    index = i;
    render();
  }

  function start(name, force) {
    if (!name || !TOURS[name] || tourName) return;
    if (!force && readSeen()[name]) return;
    steps = TOURS[name];
    const first = resolveStep(0, 1);
    if (first === -1) return;
    tourName = name; index = first;
    returnTo = document.activeElement;
    build();
    render();
  }

  function finish() {
    const cur = steps[index];
    if (cur && cur.after) cur.after();
    if (tourName) markSeen(tourName);
    tourName = null;
    [block, spot, tip].forEach(n => n && n.remove());
    block = spot = tip = null; target = null;
    removeEventListener('resize', schedulePlace);
    removeEventListener('scroll', schedulePlace, true);
    if (returnTo && typeof returnTo.focus === 'function') returnTo.focus({ preventScroll: true });
    returnTo = null;
  }

  function build() {
    block = el('div', 'tour-block');
    spot = el('div', 'tour-spot');
    tip = el('div', 'tour-tip');
    tip.setAttribute('role', 'dialog');
    tip.setAttribute('aria-modal', 'true');
    tip.setAttribute('aria-labelledby', 'tourTitle');
    tip.setAttribute('aria-describedby', 'tourBody');
    document.body.append(block, spot, tip);
    addEventListener('resize', schedulePlace);
    addEventListener('scroll', schedulePlace, true);
  }

  function trapTab(e) {
    const f = tip.querySelectorAll('button');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!tip.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // 画面的内容常常是非同步画出来的（题库要先载入），等第一个目标出现再开始，最多等 2.5 秒
  function startWhenReady(name, force) {
    const tour = TOURS[name];
    if (!tour || (!force && readSeen()[name])) return;
    const firstTarget = (tour.find(s => s.target && !s.before) || {}).target;
    const t0 = Date.now();
    (function poll() {
      if (currentTourName() !== name) return;   // 学生已经离开这个画面
      if (!firstTarget || visible(document.querySelector(firstTarget)) || Date.now() - t0 > 2500) start(name, force);
      else setTimeout(poll, 150);
    })();
  }

  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    document.addEventListener('keydown', e => {
      if (!tourName) return;
      if (e.key === 'Escape') { e.preventDefault(); finish(); }
      else if (e.key === 'Tab') trapTab(e);
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (resolveNextIndex() === -1) finish(); else go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (resolvePrevExists()) go(-1); }
    }, true);

    const btn = document.getElementById('guideBtn');
    if (btn) btn.addEventListener('click', () => { if (!tourName) start(currentTourName(), true); });

    // 换画面时（index.html 的 showView 会发出 uec:view）
    addEventListener('uec:view', e => {
      if (tourName) finish();
      const name = VIEW_TO_TOUR[e.detail];
      setTimeout(() => startWhenReady(name, false), 700);
    });

    const forced = new URLSearchParams(location.search).get('guide') === '1';
    setTimeout(() => startWhenReady(currentTourName(), forced), 900);   // 等首页的动画落定
  });

  window.UECOnboarding = { start: name => start(name || currentTourName(), true), finish, KEY, TOURS };
})();
