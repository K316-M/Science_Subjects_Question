/* 场景素材装载器 —— 让任何一个页面都能用「自己的背景图 + 自己的环境音乐」
 *
 * 规则只有一条：**文件夹名字 = 场景名字**
 *   assets/visual/<场景名>/background.jpg   → 这个场景的背景图
 *   assets/audio/<场景名>/ambient.mp3       → 这个场景的环境音乐
 *
 * 新页面要用，只需要在 <body> 上写一个 data-scene，再引入本文件：
 *   <body data-scene="notes">
 *   <script src="/js/scene-assets.js"></script>
 * 连 data-scene 都懒得写的话，会自动拿网页文件名当场景名（notes.html → notes）。
 *
 * 找不到对应文件时，退回 assets/visual/default/、assets/audio/default/；
 * 再找不到就什么都不做，页面保持原样，不会报错也不会留白。
 */
(function (global) {
  'use strict';

  const VISUAL_EXT = ['svg', 'jpg', 'jpeg', 'png', 'webp', 'avif'];
  const AUDIO_EXT = ['mp3', 'ogg', 'm4a', 'wav'];
  const FALLBACK_SCENE = 'default';
  const MUSIC_PREF_KEY = 'UEC_SCENE_MUSIC_v1';

  const CSS = `
.scene-bg{position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:0;transition:opacity .7s ease;
  background-repeat:no-repeat;background-position:center;background-size:cover;}
.scene-bg.is-on{opacity:var(--scene-opacity,.5);}
.scene-bg>svg{position:absolute;inset:0;width:100%;height:100%;display:block;}
.scene-bg::after{content:'';position:absolute;inset:0;
  background:var(--scene-veil,linear-gradient(180deg,rgba(240,253,244,.55),rgba(240,253,244,.85)));}
.scene-music-btn{position:fixed;right:16px;bottom:16px;z-index:9999;
  font:inherit;font-size:14px;line-height:1;padding:9px 14px;border-radius:999px;cursor:pointer;
  border:1px solid rgba(0,0,0,.18);background:rgba(255,255,255,.92);color:#1f2937;
  box-shadow:0 2px 10px rgba(0,0,0,.12);transition:transform .15s ease,box-shadow .15s ease;}
.scene-music-btn:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(0,0,0,.16);}
.scene-music-btn:focus-visible{outline:2px solid #059669;outline-offset:2px;}
.scene-music-btn[data-slotted]{position:static;box-shadow:none;}
@media (prefers-reduced-motion: reduce){.scene-bg,.scene-music-btn{transition:none;}}
`;

  /* ---------- 探测文件在不在（HEAD 请求，结果会缓存，切来切去不会重复问） ---------- */
  const probeCache = new Map();

  function exists(url) {
    if (!probeCache.has(url)) {
      probeCache.set(url, fetch(url, { method: 'HEAD' })
        .then(res => (res.ok ? url : null))
        .catch(() => null));
    }
    return probeCache.get(url);
  }

  async function resolve(basePath, extensions) {
    for (const ext of extensions) {
      const hit = await exists(`${basePath}.${ext}`);
      if (hit) return hit;
    }
    return null;
  }

  async function findIn(kind, scene, fileNames, extensions) {
    const scenes = scene === FALLBACK_SCENE ? [scene] : [scene, FALLBACK_SCENE];
    for (const s of scenes) {
      for (const name of fileNames) {
        const hit = await resolve(`/assets/${kind}/${s}/${name}`, extensions);
        if (hit) return hit;
      }
    }
    return null;
  }

  // 音乐的正式档名是 ambient，但 background 也认 —— 两个文件夹都用同一个词最不容易记错
  const findBackground = scene => findIn('visual', scene, ['background', 'ambient'], VISUAL_EXT);
  const findMusic = scene => findIn('audio', scene, ['ambient', 'background'], AUDIO_EXT);

  /* 把一张背景贴到指定元素上。
     SVG 走「内联进 DOM」而不是 background-image —— 当成背景图时，SVG 里的动画
     在部分浏览器（尤其 Safari）不保证会播；内联之后一定会动，颜色也能被页面 CSS 控制。
     来源是本站自己的档案，与页面同源，因此用 innerHTML 注入是安全的。 */
  const svgCache = new Map();

  async function paint(el, url) {
    if (!el) return;
    if (!url) {
      el.style.backgroundImage = '';
      el.replaceChildren();
      return;
    }
    if (/\.svg(\?|$)/i.test(url)) {
      if (!svgCache.has(url)) {
        svgCache.set(url, fetch(url).then(r => (r.ok ? r.text() : '')).catch(() => ''));
      }
      const markup = await svgCache.get(url);
      el.style.backgroundImage = '';
      el.innerHTML = markup;
      return;
    }
    el.replaceChildren();
    el.style.backgroundImage = `url("${url}")`;
  }

  /* ---------- 以下是「整页自动装配」，index.html 那种自己管背景的页面用不到 ---------- */
  const FADE_MS = 900;   // 淡出与淡入同时进行，切换场景时听起来是交叉过渡
  const state = { scene: null, session: 0, bgEl: null, audioEl: null, trackUrl: null, btn: null, musicOn: false, volume: 0.35 };

  function injectCss() {
    if (document.getElementById('sceneAssetsCss')) return;
    const style = document.createElement('style');
    style.id = 'sceneAssetsCss';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function readPref() {
    try { return localStorage.getItem(MUSIC_PREF_KEY) === 'on'; } catch (e) { return false; }
  }
  function writePref(on) {
    try { localStorage.setItem(MUSIC_PREF_KEY, on ? 'on' : 'off'); } catch (e) {}
  }

  function sceneFromPath() {
    const file = (location.pathname.split('/').pop() || '').replace(/\.html?$/i, '');
    return file || 'home';
  }

  async function applyBackground(scene, session) {
    const url = await findBackground(scene);
    if (session !== state.session) return;      // 期间已切换场景，丢弃这次结果
    if (!state.bgEl) {
      state.bgEl = document.createElement('div');
      state.bgEl.className = 'scene-bg';
      state.bgEl.setAttribute('aria-hidden', 'true');
      document.body.insertBefore(state.bgEl, document.body.firstChild);
    }
    if (url) {
      await paint(state.bgEl, url);
      if (session !== state.session) return;
      state.bgEl.classList.add('is-on');
    } else {
      state.bgEl.classList.remove('is-on');
      paint(state.bgEl, null);
    }
  }

  // 用 rAF 把音量平滑推到目标值；同一个元素上重复呼叫会接手上一次的淡变
  function fadeAudio(el, target, ms, onDone) {
    if (el._fadeRaf) cancelAnimationFrame(el._fadeRaf);
    const from = el.volume;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / ms, 1);
      el.volume = Math.max(0, Math.min(1, from + (target - from) * t));
      if (t < 1) {
        el._fadeRaf = requestAnimationFrame(step);
      } else {
        el._fadeRaf = null;
        if (onDone) onDone();
      }
    };
    el._fadeRaf = requestAnimationFrame(step);
  }

  // 浏览器禁止「没互动就出声」，被挡下就等用户第一次点击/按键再试一次
  function playWhenAllowed(audio) {
    audio.play().catch(() => {
      const retry = () => {
        document.removeEventListener('pointerdown', retry);
        document.removeEventListener('keydown', retry);
        if (!state.musicOn) return;
        audio.volume = 0;            // 补播时同样淡入，不要突然出声
        audio.play().then(() => fadeAudio(audio, state.volume, FADE_MS)).catch(() => {});
      };
      document.addEventListener('pointerdown', retry, { once: true });
      document.addEventListener('keydown', retry, { once: true });
    });
  }

  // 让目前这首开始淡出并交出控制权；不等它淡完，新的那首可以马上叠上来
  function stopMusic() {
    const leaving = state.audioEl;
    state.audioEl = null;
    state.trackUrl = null;
    if (!leaving) return;
    fadeAudio(leaving, 0, FADE_MS, () => {
      leaving.pause();
      leaving.src = '';
    });
  }

  async function startMusic(scene, session) {
    const url = await findMusic(scene);
    if (session !== state.session || !state.musicOn) return;
    if (!url) { stopMusic(); return; }
    // 换场景但用的是同一首曲子时，让它继续播，不要从头重来
    if (url === state.trackUrl && state.audioEl) return;

    stopMusic();
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0;
    state.audioEl = audio;
    state.trackUrl = url;
    playWhenAllowed(audio);
    fadeAudio(audio, state.volume, FADE_MS);
  }

  function syncButton() {
    if (!state.btn) return;
    state.btn.textContent = state.musicOn ? '🎵 音乐：开' : '🎼 音乐：关';
    state.btn.setAttribute('aria-pressed', String(state.musicOn));
  }

  function setMusic(on) {
    state.musicOn = Boolean(on);
    writePref(state.musicOn);
    syncButton();
    if (state.musicOn) startMusic(state.scene, state.session);
    else stopMusic();
  }

  function mountButton() {
    if (state.btn) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'scene-music-btn';
    btn.addEventListener('click', () => setMusic(!state.musicOn));
    const slot = document.querySelector('[data-scene-music-slot]');
    if (slot) {
      btn.setAttribute('data-slotted', '');
      slot.appendChild(btn);
    } else {
      document.body.appendChild(btn);
    }
    state.btn = btn;
    syncButton();
  }

  /* 切换场景：新页面如果自己有多个场景（例如不同章节换背景），调用这个即可 */
  function use(scene) {
    state.scene = scene || FALLBACK_SCENE;
    const session = ++state.session;
    applyBackground(state.scene, session);
    // 不先硬停：交给 startMusic 判断该交叉淡入、还是同一首继续播
    if (state.musicOn) startMusic(state.scene, session);
    else stopMusic();
  }

  function init() {
    const ds = document.body.dataset || {};
    if (ds.scene === 'off') return;             // 自己管背景音乐的页面（如 index.html）不自动装配

    injectCss();
    if (ds.sceneOpacity) document.documentElement.style.setProperty('--scene-opacity', ds.sceneOpacity);
    if (ds.sceneVeil) document.documentElement.style.setProperty('--scene-veil', ds.sceneVeil);
    state.volume = Math.min(1, Math.max(0, parseFloat(ds.sceneVolume) || 0.35));

    const mode = ds.sceneMusic || 'button';     // button（默认）/ auto / off
    if (mode === 'button') {
      mountButton();
      state.musicOn = readPref();
      syncButton();
    } else if (mode === 'auto') {
      state.musicOn = true;
    }

    use(ds.scene || sceneFromPath());
  }

  global.SceneAssets = {
    use, setMusic, resolve, findBackground, findMusic, paint,
    isMusicOn: () => state.musicOn,
    currentScene: () => state.scene,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
