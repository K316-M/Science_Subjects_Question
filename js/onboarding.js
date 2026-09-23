/* 首次进站引导
 * ------------------------------------------------------------
 * 只在这台装置第一次打开时出现（记在 localStorage，没有帐号概念）。
 * 刻意做成四页就结束 —— 引导太长学生会直接跳过，等於白做。
 * 版本号存在记录里：日後内容大改可以把 VERSION 加一，让老用户再看一次。
 */
(function () {
  'use strict';

  const KEY = 'UEC_ONBOARD_v1';
  const VERSION = 1;

  const CSS = `
.ob-mask{position:fixed;inset:0;z-index:1500;display:grid;place-items:center;padding: 20px;
  background:rgba(15,23,42,.46);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
  opacity:0;visibility:hidden;transition:opacity .3s ease,visibility .3s;}
/* 打开时 visibility 要立即生效：过渡的第 0 帧仍算 hidden，紧接著的 focus() 会静默失败 */
.ob-mask.is-open{opacity:1;visibility:visible;transition:opacity .3s ease,visibility 0s;}
.ob-box{width:min(470px,100%);padding: 28px 24px 20px;border-radius:24px;
  background:rgba(255,255,255,.97);border:1px solid rgba(255,255,255,.85);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 28px 70px -28px rgba(15,23,42,.55);
  transform:translateY(16px) scale(.96);transition:transform .4s cubic-bezier(.16,1,.3,1);}
.ob-mask.is-open .ob-box{transform:none;}
.ob-art{height:126px;display:grid;place-items:center;margin-bottom: 6px;}
.ob-art svg{width:126px;height:126px;}
.ob-title{font-family:var(--font-display,serif);font-size:19px;font-weight:800;color:#0f172a;text-align:center;}
.ob-body{margin-top: 8px;font-size:14px;line-height:1.75;color:#475569;text-align:center;}
.ob-body strong{color:var(--primary,#059669);}
.ob-dots{display:flex;gap: 8px;justify-content:center;margin: 16px 0 14px;}
.ob-dot{width:7px;height:7px;border-radius:50%;background:#cbd5e1;transition:all .3s ease;}
.ob-dot.on{width:22px;border-radius:99px;background:var(--primary,#059669);}
.ob-row{display:flex;gap: 10px;align-items:center;}
.ob-btn{flex:1 1 0;padding: 12px 16px;border-radius:13px;border:0;cursor:pointer;
  font-size:14px;font-weight:700;color:#fff;background:var(--primary,#059669);
  box-shadow:0 8px 20px -8px var(--primary,#059669);transition:transform .15s ease,filter .2s ease;}
.ob-btn:hover{transform:translateY(-1px);filter:brightness(1.06);}
.ob-btn.ghost{flex:0 0 auto;background:transparent;color:#64748b;box-shadow:none;font-weight:600;}
.ob-btn.ghost:hover{color:#0f172a;transform:none;}
@media (prefers-reduced-motion: reduce){.ob-mask,.ob-box,.ob-dot{transition:none;}.ob-art svg *{animation:none!important;}}
@keyframes obSpin{to{transform:rotate(360deg)}}
@keyframes obPulse{0%,100%{opacity:.35}50%{opacity:1}}
@keyframes obDash{to{stroke-dashoffset:-40}}
`;

  // 四张插图都用页面的主色，跟网站是同一套语言
  const ART = {
    orbit: `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <circle cx="60" cy="60" r="42" stroke-dasharray="5 7" opacity=".45" style="transform-origin:60px 60px;animation:obSpin 24s linear infinite"/>
      <circle cx="60" cy="60" r="15" fill="currentColor" opacity=".16" stroke="none"/>
      <circle cx="60" cy="18" r="9" fill="currentColor" opacity=".9" stroke="none"/>
      <circle cx="102" cy="60" r="7" fill="currentColor" opacity=".5" stroke="none"/>
      <circle cx="60" cy="102" r="7" fill="currentColor" opacity=".5" stroke="none"/>
      <circle cx="18" cy="60" r="7" fill="currentColor" opacity=".5" stroke="none"/></svg>`,
    card: `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <rect x="20" y="24" width="80" height="72" rx="12" opacity=".9"/>
      <path d="M32 44h44" opacity=".85"/><path d="M32 60h56" opacity=".5"/><path d="M32 74h34" opacity=".5"/>
      <circle cx="84" cy="80" r="13" fill="currentColor" opacity=".16" stroke="none"/>
      <path d="M78 80l4.5 4.5L92 75" stroke-width="3"/></svg>`,
    calendar: `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
      <rect x="22" y="30" width="76" height="66" rx="11"/><path d="M22 48h76"/>
      <path d="M40 22v14M80 22v14"/>
      <circle cx="42" cy="64" r="5" fill="currentColor" stroke="none" style="animation:obPulse 2.6s ease-in-out infinite"/>
      <circle cx="60" cy="64" r="5" fill="currentColor" stroke="none" opacity=".35"/>
      <circle cx="78" cy="64" r="5" fill="currentColor" stroke="none" style="animation:obPulse 2.6s ease-in-out infinite;animation-delay:-1.3s"/>
      <circle cx="42" cy="80" r="5" fill="currentColor" stroke="none" opacity=".35"/>
      <circle cx="60" cy="80" r="5" fill="currentColor" stroke="none" opacity=".35"/></svg>`,
    devices: `<svg viewBox="0 0 120 120" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
      <rect x="14" y="34" width="54" height="40" rx="7"/><path d="M28 82h26"/><path d="M41 74v8"/>
      <rect x="76" y="46" width="30" height="48" rx="7"/><path d="M87 88h8"/>
      <path d="M62 30c12-10 30-8 38 4" stroke-dasharray="4 5" style="animation:obDash 2.4s linear infinite"/>
      <path d="M98 36l4-8 6 5"/></svg>`,
  };

  const SLIDES = [
    { art: 'orbit', title: '欢迎来到独中理科',
      body: '这是给<strong>董总统考（UEC）</strong>理科准备的自主练习站。<br>先从轨道上挑一科——点一下圆球，它会转到正上方并显示你的进度。' },
    { art: 'card', title: '做题就像翻闪卡',
      body: '选一个章节，一题一题作答。<br>答完<strong>立刻看到解析</strong>，答错的题目会<strong>自动收进错题本</strong>，不用自己抄。' },
    { art: 'calendar', title: '它会提醒你该复习什么',
      body: '答对的题目，间隔会一次次拉长：<strong>明天 → 三天 → 八天…</strong><br>答错就打回明天。「今日复习」只给你今天真正该看的那几题。' },
    { art: 'devices', title: '换装置不会丢进度',
      body: '按「☁️ 同步」产生一串码，在另一台装置输入同一串，<br>进度、笔记、错题本就会<strong>合并</strong>在一起。<br>不用注册，也不会收集你的个人资料。' },
  ];

  let mask, box, index = 0;

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } };
  const markSeen = () => { try { localStorage.setItem(KEY, JSON.stringify({ version: VERSION, at: Date.now() })); } catch (e) {} };

  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;   // 只有本档案里写死的字串会进来
    return n;
  };

  function render() {
    const s = SLIDES[index];
    box.replaceChildren();

    const art = el('div', 'ob-art', ART[s.art] || '');
    art.setAttribute('aria-hidden', 'true');
    art.style.color = 'var(--primary, #059669)';
    box.append(art, el('div', 'ob-title', s.title), el('div', 'ob-body', s.body));

    const dots = el('div', 'ob-dots');
    SLIDES.forEach((_, i) => dots.appendChild(el('span', 'ob-dot' + (i === index ? ' on' : ''))));
    box.appendChild(dots);

    const row = el('div', 'ob-row');
    if (index > 0) {
      const back = el('button', 'ob-btn ghost', '上一步');
      back.onclick = () => { index -= 1; render(); };
      row.appendChild(back);
    } else {
      const skip = el('button', 'ob-btn ghost', '跳过');
      skip.onclick = close;
      row.appendChild(skip);
    }
    const next = el('button', 'ob-btn', index === SLIDES.length - 1 ? '开始使用 →' : '下一步');
    next.onclick = () => { if (index === SLIDES.length - 1) close(); else { index += 1; render(); } };
    row.appendChild(next);
    box.appendChild(row);
    next.focus();
  }

  let returnTo = null;
  function open(fromStart) {
    if (fromStart) index = 0;
    returnTo = document.activeElement;
    // 先显示再 render：render() 结尾会 focus「下一步」，
    // 对 visibility:hidden 里的元素 focus 会静默失败，焦点就留在背後的页面。
    mask.classList.add('is-open');
    render();
  }

  function close() {
    markSeen();
    mask.classList.remove('is-open');
    if (returnTo && typeof returnTo.focus === 'function') returnTo.focus();
    returnTo = null;
  }

  function trapTab(e) {
    const f = box.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    mask = el('div', 'ob-mask');
    box = el('div', 'ob-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', '使用引导');
    mask.appendChild(box);
    document.body.appendChild(mask);

    document.addEventListener('keydown', e => {
      if (!mask.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'Tab') trapTab(e);
      else if (e.key === 'ArrowRight' && index < SLIDES.length - 1) { index += 1; render(); }
      else if (e.key === 'ArrowLeft' && index > 0) { index -= 1; render(); }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    build();
    const btn = document.getElementById('guideBtn');
    if (btn) btn.addEventListener('click', () => open(true));

    const seen = read();
    // 网址带 ?guide=1 可以强制重看，方便你自己检查
    const forced = new URLSearchParams(location.search).get('guide') === '1';
    if (forced || !seen || seen.version !== VERSION) {
      setTimeout(() => open(true), 700);   // 等主页的动画落定再出现
    }
  });

  window.UECOnboarding = { open, close, KEY, VERSION };
})();
