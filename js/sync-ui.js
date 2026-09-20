/* 跨装置同步的介面：一颗按钮 + 一个面板。样式自带，index.html 只需引入这支档案。 */
(function () {
  'use strict';

  const CSS = `
.sync-mask{position:fixed;inset:0;z-index:1400;display:grid;place-items:center;padding:20px;
  background:rgba(15,23,42,.42);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);
  opacity:0;visibility:hidden;transition:opacity .25s ease,visibility .25s;}
.sync-mask.is-open{opacity:1;visibility:visible;}
.sync-box{width:min(440px,100%);max-height:86vh;overflow:auto;padding:24px;border-radius:22px;
  background:rgba(255,255,255,.96);border:1px solid rgba(255,255,255,.8);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.8),0 24px 60px -24px rgba(15,23,42,.5);
  transform:translateY(12px) scale(.97);transition:transform .35s cubic-bezier(.16,1,.3,1);}
.sync-mask.is-open .sync-box{transform:none;}
.sync-title{font-family:var(--font-display,serif);font-size:19px;font-weight:800;color:#0f172a;}
.sync-sub{font-size:12.5px;color:var(--text-muted,#64748b);margin-top:4px;line-height:1.65;}
.sync-code{margin:14px 0 6px;padding:13px 14px;border-radius:13px;background:#f1f5f9;
  border:1px dashed #cbd5e1;font-family:ui-monospace,Menlo,Consolas,monospace;
  font-size:15px;letter-spacing:1.5px;word-break:break-all;text-align:center;color:#0f172a;}
.sync-row{display:flex;gap:9px;flex-wrap:wrap;margin-top:12px;}
.sync-btn{flex:1 1 auto;min-width:110px;padding:10px 14px;border-radius:12px;border:0;cursor:pointer;
  font-size:13.5px;font-weight:700;color:#fff;background:var(--primary,#059669);
  box-shadow:0 8px 18px -8px var(--primary,#059669);transition:transform .15s ease,filter .2s ease;}
.sync-btn:hover{transform:translateY(-1px);filter:brightness(1.06);}
.sync-btn[disabled]{background:#cbd5e1;box-shadow:none;cursor:not-allowed;transform:none;}
.sync-btn.ghost{background:rgba(255,255,255,.9);color:#334155;border:1px solid #cbd5e1;box-shadow:none;}
.sync-input{width:100%;margin-top:10px;padding:11px 13px;border-radius:12px;border:1px solid #cbd5e1;
  font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px;letter-spacing:1.2px;text-transform:uppercase;}
.sync-note{margin-top:12px;font-size:12px;line-height:1.7;color:var(--text-muted,#64748b);}
.sync-msg{margin-top:11px;font-size:12.5px;font-weight:600;}
.sync-msg.ok{color:var(--success,#10b981);} .sync-msg.bad{color:var(--danger,#ef4444);}
@media (prefers-reduced-motion: reduce){.sync-mask,.sync-box{transition:none;}}
`;

  let mask, box, msgEl, configured = null;

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const say = (text, good) => { if (msgEl) { msgEl.textContent = text; msgEl.className = 'sync-msg ' + (good ? 'ok' : 'bad'); } };
  const when = ts => ts ? new Date(ts).toLocaleString('zh-CN', { hour12: false }) : '还没同步过';

  function build() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    mask = el('div', 'sync-mask');
    mask.addEventListener('click', e => { if (e.target === mask) close(); });
    box = el('div', 'sync-box');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', '跨装置同步');
    mask.appendChild(box);
    document.body.appendChild(mask);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  function render() {
    const s = window.UECSync.status();
    box.replaceChildren();
    box.appendChild(el('div', 'sync-title', '跨装置同步'));

    if (configured === false) {
      box.appendChild(el('div', 'sync-sub',
        '这个功能还没启用。需要先在 Vercel 环境变数加入 UPSTASH_REDIS_REST_URL 与 UPSTASH_REDIS_REST_TOKEN，详见 OPERATIONS.md。'));
      const row = el('div', 'sync-row');
      const ok = el('button', 'sync-btn ghost', '知道了'); ok.onclick = close;
      row.appendChild(ok); box.appendChild(row);
      return;
    }

    if (!s.connected) {
      box.appendChild(el('div', 'sync-sub',
        '这台装置还没有连接。把同步码抄到另一台装置，两边的做题进度、错题本、笔记就会互通。不需要注册，也不会收集任何个人资料。'));

      const row = el('div', 'sync-row');
      const make = el('button', 'sync-btn', '产生我的同步码');
      make.onclick = () => {
        const code = window.UECSync.makeCode();
        const r = window.UECSync.connect(code);
        if (r.ok) { render(); say('已产生。请把这串码抄到另一台装置。', true); doSync(); }
      };
      row.appendChild(make);
      box.appendChild(row);

      box.appendChild(el('div', 'sync-note', '已经在别的装置产生过了？把那串码贴在下面：'));
      const input = el('input', 'sync-input');
      input.placeholder = '例如 ABCD-EFGH-JKLM-NPQR-STUV';
      input.setAttribute('aria-label', '输入同步码');
      box.appendChild(input);

      const row2 = el('div', 'sync-row');
      const join = el('button', 'sync-btn', '连接');
      join.onclick = () => {
        const r = window.UECSync.connect(input.value);
        if (!r.ok) return say(r.message, false);
        render(); say('已连接，正在同步…', true); doSync();
      };
      const cancel = el('button', 'sync-btn ghost', '关闭'); cancel.onclick = close;
      row2.append(join, cancel);
      box.appendChild(row2);
    } else {
      box.appendChild(el('div', 'sync-sub', `上次同步：${when(s.lastSyncAt)}`));
      box.appendChild(el('div', 'sync-code', window.UECSync.pretty(s.code)));

      const row = el('div', 'sync-row');
      const copy = el('button', 'sync-btn ghost', '复制同步码');
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(s.code); say('已复制到剪贴簿', true); }
        catch (e) { say('复制失败，请手动选取上面那串码', false); }
      };
      const now = el('button', 'sync-btn', s.syncing ? '同步中…' : '立即同步');
      now.disabled = s.syncing;
      now.onclick = doSync;
      row.append(now, copy);
      box.appendChild(row);

      box.appendChild(el('div', 'sync-note',
        '把这串码抄到另一台装置的同一个画面，按「连接」即可。两边的进度会自动合并——答对过的题目不会因为另一台没做过而被覆盖掉。'));

      const row2 = el('div', 'sync-row');
      const off = el('button', 'sync-btn ghost', '在这台装置断开');
      off.onclick = () => {
        if (!confirm('断开之后这台装置就不再同步，本机的资料仍然保留。确定吗？')) return;
        window.UECSync.disconnect(); render(); say('已断开', true);
      };
      const done = el('button', 'sync-btn ghost', '关闭'); done.onclick = close;
      row2.append(off, done);
      box.appendChild(row2);
    }

    msgEl = el('div', 'sync-msg');
    box.appendChild(msgEl);
  }

  async function doSync() {
    render();
    const r = await window.UECSync.sync();
    render();
    if (r.ok) say('同步完成 ✓', true);
    else if (r.reason === 'not_configured') { configured = false; render(); }
    else say(r.message || '同步失败，请稍后再试。', false);
  }

  function open() { render(); mask.classList.add('is-open'); }
  function close() { mask.classList.remove('is-open'); }

  // 合并之后画面上的数字要跟着更新，否则要重整才看得到另一台装置的进度
  window.refreshAfterSync = function () {
    [['updateWrongCountBadge'], ['renderResumeCard'], ['renderActiveContent']].forEach(([fn]) => {
      if (typeof window[fn] === 'function') { try { window[fn](); } catch (e) {} }
    });
    if (window.OrbitSubjects && window.OrbitSubjects.refresh) window.OrbitSubjects.refresh();
  };

  document.addEventListener('DOMContentLoaded', () => {
    build();
    const btn = document.getElementById('syncBtn');
    if (btn) btn.addEventListener('click', open);
    // 先问一次伺服器有没有启用，没启用就把按钮标示出来，别让人按了才失望
    fetch('/api/sync?code=' + 'A'.repeat(20)).then(r => { configured = r.status !== 503; })
      .catch(() => { configured = null; });
    window.UECSync.onChange(() => { if (mask && mask.classList.contains('is-open')) render(); });
  });
})();
