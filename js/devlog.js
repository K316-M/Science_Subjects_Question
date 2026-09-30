/* 更新日志：工具列的「日志」按钮 + 一个面板，列出每一版加了什么（资料在 data/devlog.json，新的在最前面）。
 * 有还没看过的新版，按钮上亮一个红点；打开看过就熄掉。
 * 新增一版不用改程式：到 GitHub Actions 跑「发布更新日志」，填版本和内容（docs/OPERATIONS.md「更新日志」）。
 */
(function () {
  'use strict';

  const SEEN_KEY = 'UEC_DEVLOG_SEEN_v1';
  const CSS = `
.devlog-dot{position:absolute;top:-2px;right:-2px;width:10px;height:10px;border-radius:50%;
  background:var(--retro-coral-deep,#c2412d);border:2px solid #fff;}
.devlog-dot[hidden],#devlogBtn[hidden]{display:none;}
.devlog-mask{position:fixed;inset:0;z-index:1400;display:grid;place-items:center;padding: 20px;
  background:rgba(15,23,42,.42);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  opacity:0;visibility:hidden;transition:opacity .25s ease,visibility .25s;}
.devlog-mask.is-open{opacity:1;visibility:visible;transition:opacity .25s ease,visibility 0s;}
.devlog-box{width:min(480px,100%);max-height:86vh;overflow:auto;padding: 20px 24px 24px;border-radius:22px;
  background:rgba(255,255,255,.97);border:1px solid rgba(255,255,255,.8);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.8),0 24px 60px -24px rgba(15,23,42,.5);
  transform:translateY(12px) scale(.97);transition:transform .35s cubic-bezier(.16,1,.3,1);}
.devlog-mask.is-open .devlog-box{transform:none;}
.devlog-head{display:flex;align-items:center;justify-content:space-between;gap: 12px;}
.devlog-title{font-family:var(--font-display,serif);font-size:19px;font-weight:800;color:#0f172a;}
.devlog-close{width:40px;height:40px;margin-right:-8px;border:0;border-radius:12px;background:none;
  color:var(--text-muted,#64748b);font-size:23px;line-height:1;cursor:pointer;}
.devlog-close:hover{background:#f1f5f9;color:#0f172a;}
.devlog-sub{font-size:12px;color:var(--text-muted,#64748b);margin-top: 2px;line-height:1.6;}
.devlog-entry{margin-top: 16px;padding-top: 14px;border-top:1px dashed #cbd5e1;}
.devlog-entry:first-of-type{border-top:0;padding-top: 4px;}
.devlog-ver{display:flex;align-items:baseline;flex-wrap:wrap;gap: 8px;margin:0;font-size:14px;font-weight:700;color:#334155;}
.devlog-ver b{font-family:var(--font-display,serif);font-size:19px;font-weight:800;color:var(--retro-teal-dark,#3b6b72);}
.devlog-new{font-size:11px;font-weight:800;padding: 1px 6px;border-radius:6px;background:var(--retro-coral-deep,#c2412d);color:#fff;}
.devlog-items{margin: 8px 0 0;padding-left: 20px;font-size:14px;line-height:1.75;color:#1e293b;}
.devlog-items li+li{margin-top: 4px;}
.devlog-empty{margin-top: 16px;font-size:14px;color:var(--text-muted,#64748b);}
@media (prefers-reduced-motion: reduce){.devlog-mask,.devlog-box{transition:none;}}
`;

  const btn = document.getElementById('devlogBtn');
  if (!btn) return;
  let entries = null, mask = null, box = null, lastFocus = null;

  const seen = () => { try { return localStorage.getItem(SEEN_KEY) || ''; } catch (e) { return ''; } };
  // 版本号一段一段比：1.10 比 1.9 新
  const newer = (a, b) => {
    const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dateText = d => { const [y, m, day] = String(d).split('-').map(Number); return y ? `${y} 年 ${m} 月 ${day} 日` : ''; };

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  btn.style.position = 'relative';
  const dot = document.createElement('span');
  dot.className = 'devlog-dot';
  dot.hidden = true;
  dot.innerHTML = '<span class="sr-only">有新版本</span>';
  btn.appendChild(dot);

  function renderDot() {
    dot.hidden = !(entries && entries.length && newer(entries[0].version, seen() || '0'));
  }

  function build() {
    mask = document.createElement('div');
    mask.className = 'devlog-mask';
    mask.addEventListener('click', e => { if (e.target === mask) close(); });
    box = document.createElement('div');
    box.className = 'devlog-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'devlogTitle');
    mask.appendChild(box);
    document.body.appendChild(mask);
    document.addEventListener('keydown', e => {
      if (!mask.classList.contains('is-open')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'Tab') {   // 焦点困在对话框里（面板里只有「关闭」一颗按钮）
        e.preventDefault();
        box.querySelector('.devlog-close').focus();
      }
    });
  }

  function render(before) {
    const list = entries || [];
    box.innerHTML = `
      <div class="devlog-head"><div class="devlog-title" id="devlogTitle">更新日志</div>
        <button type="button" class="devlog-close" aria-label="关闭">×</button></div>
      <p class="devlog-sub">网站每一版加了什么、改了什么。</p>
      ${list.length ? list.map((e, i) => `
        <section class="devlog-entry">
          <h3 class="devlog-ver"><b>v${esc(e.version)}</b><time datetime="${esc(e.date)}">${esc(dateText(e.date))}</time>${
            (before ? newer(e.version, before) : i === 0) ? '<span class="devlog-new">新</span>' : ''}</h3>
          <ul class="devlog-items">${(e.items || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
        </section>`).join('') : '<p class="devlog-empty">暂时读不到更新日志，有网络时再打开看看。</p>'}`;
    box.querySelector('.devlog-close').addEventListener('click', close);
  }

  function open() {
    if (!mask) build();
    const before = seen();   // 标「新」要看打开之前看到哪一版
    render(before);
    if (entries && entries.length) { try { localStorage.setItem(SEEN_KEY, entries[0].version); } catch (e) {} }
    renderDot();
    lastFocus = document.activeElement;
    mask.classList.add('is-open');
    box.scrollTop = 0;
    box.querySelector('.devlog-close').focus();
    if (typeof window.playSound === 'function') window.playSound('pop');
  }

  function close() {
    mask.classList.remove('is-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  btn.addEventListener('click', open);
  // 只放在首页：做题页的工具列多一颗，键盘从「跳到主要内容」到第一个选项就超过 10 下
  window.addEventListener('uec:view', e => { btn.hidden = e.detail !== 'viewSubjects'; });
  fetch('/data/devlog.json', { cache: 'no-cache' })
    .then(r => (r.ok ? r.json() : null))
    .then(d => { if (d && Array.isArray(d.entries)) { entries = d.entries; renderDot(); } })
    .catch(() => {});

  window.UECDevlog = { open };
})();
