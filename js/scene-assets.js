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

  const VISUAL_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif'];
  const AUDIO_EXT = ['mp3', 'ogg', 'm4a', 'wav'];
  const FALLBACK_SCENE = 'default';
  const MUSIC_PREF_KEY = 'UEC_SCENE_MUSIC_v1';

  const CSS = `
.scene-bg{position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:0;transition:opacity .7s ease;
  background-repeat:no-repeat;background-position:center;background-size:cover;}
.scene-bg.is-on{opacity:var(--scene-opacity,.5);}
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

  async function findIn(kind, scene, fileName, extensions) {
    const tries = scene === FALLBACK_SCENE ? [scene] : [scene, FALLBACK_SCENE];
    for (const s of tries) {
      const hit = await resolve(`/assets/${kind}/${s}/${fileName}`, extensions);
      if (hit) return hit;
    }
    return null;
  }

  const findBackground = scene => findIn('visual', scene, 'background', VISUAL_EXT);
  const findMusic = scene => findIn('audio', scene, 'ambient', AUDIO_EXT);

  /* ---------- 以下是「整页自动装配」，index.html 那种自己管背景的页面用不到 ---------- */
  const state = { scene: null, session: 0, bgEl: null, audioEl: null, btn: null, musicOn: false, volume: 0.35 };

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
      state.bgEl.style.backgroundImage = `url("${url}")`;
      state.bgEl.classList.add('is-on');
    } else {
      state.bgEl.classList.remove('is-on');
      state.bgEl.style.backgroundImage = '';
    }
  }

  // 浏览器禁止「没互动就出声」，被挡下就等用户第一次点击/按键再试一次
  function playWhenAllowed(audio) {
    audio.play().catch(() => {
      const retry = () => {
        document.removeEventListener('pointerdown', retry);
        document.removeEventListener('keydown', retry);
        if (state.musicOn) audio.play().catch(() => {});
      };
      document.addEventListener('pointerdown', retry, { once: true });
      document.addEventListener('keydown', retry, { once: true });
    });
  }

  function stopMusic() {
    if (!state.audioEl) return;
    state.audioEl.pause();
    state.audioEl.src = '';
    state.audioEl = null;
  }

  async function startMusic(scene, session) {
    const url = await findMusic(scene);
    if (session !== state.session || !state.musicOn) return;
    if (!url) return;
    stopMusic();
    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = state.volume;
    state.audioEl = audio;
    playWhenAllowed(audio);
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
    stopMusic();
    if (state.musicOn) startMusic(state.scene, session);
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
    use, setMusic, resolve, findBackground, findMusic,
    isMusicOn: () => state.musicOn,
    currentScene: () => state.scene,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
