/* 护眼模式（深夜读书）
 *
 * <html data-theme="night|day">。第一次画面之前由 index.html <head> 里的小段脚本先决定（避免先闪一下白底），
 * 这里负责之後的切换：
 *   - 学生没手动选过：跟随装置的深色模式，装置改了就跟著改
 *   - 按「🌙 护眼」：记住选择（UEC_THEME_v1）；切到跟装置一样时就清掉纪录，回到跟随装置
 * 颜色都在 css/night.css；水彩背景的夜色底图由 js/scene-assets.js 自己换。
 */
(function () {
  'use strict';

  const KEY = 'UEC_THEME_v1';
  const root = document.documentElement;
  const system = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : { matches: false };
  const BAR_COLOR = { day: '#059669', night: '#1d1b18' };   // 手机浏览器顶端那条的颜色

  const read = () => { try { return localStorage.getItem(KEY); } catch (e) { return null; } };
  const write = v => { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch (e) {} };
  const current = () => (root.getAttribute('data-theme') === 'night' ? 'night' : 'day');
  const systemTheme = () => (system.matches ? 'night' : 'day');

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', BAR_COLOR[theme]);
    const btn = document.getElementById('themeBtn');
    if (btn) {
      const txt = btn.querySelector('.theme-txt');
      if (txt) txt.textContent = theme === 'night' ? ' 护眼：开' : ' 护眼：关';
      btn.setAttribute('aria-pressed', String(theme === 'night'));
    }
  }

  function toggle() {
    const next = current() === 'night' ? 'day' : 'night';
    write(next === systemTheme() ? null : next);
    apply(next);
  }

  function onSystemChange() {
    const saved = read();
    if (saved !== 'night' && saved !== 'day') apply(systemTheme());
  }
  if (system.addEventListener) system.addEventListener('change', onSystemChange);
  else if (system.addListener) system.addListener(onSystemChange);

  const btn = document.getElementById('themeBtn');
  if (btn) btn.addEventListener('click', toggle);
  apply(current());

  window.UECTheme = { toggle, current };
})();
