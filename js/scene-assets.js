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
 *
 * 会动的分层背景：在同一个资料夹放一份 scene.json（优先於 background.*）。
 *   {
 *     "size":  [1672, 940],                 ← 原图尺寸（像素）
 *     "plate": "scene/plate.webp",          ← 静态底图，铺满画面（cover）
 *     "layers": [{
 *       "src":    "scene/leaf-a.webp",      ← 路径相对於 scene.json
 *       "box":    [308, 208, 33, 66],       ← 在原图上的位置 x, y, 宽, 高
 *       "motion": "sway",                   ← none | sway 摇摆 | float 上下飘 | bob 轻晃 | drift 漂移
 *       "speed":  9,                        ← 一个来回几秒
 *       "origin": "50% 0%",                 ← 摇摆的支点（选填）
 *       "wide":   true,                     ← 横式画面：放在原图的位置
 *       "tall":   { "left": "4%", "top": "36%", "width": "16vmin" }
 *                                           ← 直式画面（手机）：贴著视窗摆；不写就不显示
 *     }],
 *     "night": { "plate": "scene/plate-night.webp", "layer_opacity": 0.32 }
 *                                           ← 护眼模式（<html data-theme="night">）换这张深色底图，
 *                                             图层降到同样的浓度；由 scripts/scene/build_scene.py 产生
 *   }
 * 为什么直式要另外摆：横图铺满手机时左右会被裁掉，边缘的插画就全不见了。
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
  font:inherit;font-size:14px;line-height:1;padding: 8px 14px;border-radius:999px;cursor:pointer;
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
  const findBackground = async scene => {
    const scenes = scene === FALLBACK_SCENE ? [scene] : [scene, FALLBACK_SCENE];
    for (const s of scenes) {
      const layered = await exists(`/assets/visual/${s}/scene.json`);
      if (layered) return layered;
      const flat = await resolve(`/assets/visual/${s}/background`, VISUAL_EXT) || await resolve(`/assets/visual/${s}/ambient`, VISUAL_EXT);
      if (flat) return flat;
    }
    return null;
  };
  const findMusic = scene => findIn('audio', scene, ['ambient', 'background'], AUDIO_EXT);

  /* 把一张背景贴到指定元素上。
     SVG 走「内联进 DOM」而不是 background-image —— 当成背景图时，SVG 里的动画
     在部分浏览器（尤其 Safari）不保证会播；内联之后一定会动，颜色也能被页面 CSS 控制。
     来源是本站自己的档案，与页面同源，因此用 innerHTML 注入是安全的。 */
  const svgCache = new Map();

  /* ---------- 分层场景（scene.json） ---------- */
  // 只用 transform 做动画：每个元素是独立的合成层，GPU 直接搬，不重绘（docs/DESIGN.md 原则 4）
  const SCENE_CSS = `
.scene{position:absolute;inset:0;overflow:hidden;container-type:size;}
.scene img{position:absolute;display:block;max-width:none;user-select:none;-webkit-user-drag:none;}
.scene-stage{position:absolute;left:50%;top:50%;width:100%;height:100%;
  width:max(100cqw,calc(100cqh * var(--ar)));height:max(100cqh,calc(100cqw / var(--ar)));transform:translate(-50%,-50%);}
.scene-plate{inset:0;width:100%;height:100%;object-fit:cover;}
.scene .m-sway,.scene .m-float,.scene .m-bob,.scene .m-drift{will-change:transform;
  animation:var(--anim) var(--spd,10s) ease-in-out var(--dly,0s) infinite alternate;}
.scene .m-sway{--anim:scene-sway}.scene .m-float{--anim:scene-float}.scene .m-bob{--anim:scene-bob}.scene .m-drift{--anim:scene-drift}
@keyframes scene-sway{from{transform:rotate(-5deg)}to{transform:rotate(5deg)}}
@keyframes scene-float{from{transform:translateY(0)}to{transform:translateY(-9px)}}
@keyframes scene-bob{from{transform:translate(0,0)}to{transform:translate(3px,-5px)}}
@keyframes scene-drift{from{transform:translate(0,0) rotate(0)}to{transform:translate(9px,-11px) rotate(9deg)}}
.scene .is-tall{display:none;}
@media (max-aspect-ratio: 4/3){.scene .is-wide{display:none;}.scene .is-tall{display:block;}}
.scene img:not(.scene-plate){translate:calc(var(--px,0) * var(--depth,6px) * -1) calc(var(--py,0) * var(--depth,6px) * -1);
  transition:translate .9s cubic-bezier(.2,.8,.2,1);}
.scene::after{content:'';position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 2.4s ease;
  background:radial-gradient(70% 85% at 6% -6%,rgba(255,238,196,.62),rgba(255,238,196,0) 70%),
    radial-gradient(70% 85% at 94% -6%,rgba(255,238,196,.62),rgba(255,238,196,0) 70%);}
.scene-glow .scene::after{opacity:1;}
:root[data-theme="night"] .scene img:not(.scene-plate){opacity:var(--night-layer-opacity,.32);}
:root[data-theme="night"] .scene img.is-tall{opacity:calc(var(--night-layer-opacity,.32) * .6);}
:root[data-theme="night"] .scene-glow .scene::after{opacity:.35;}
@media (prefers-reduced-motion: reduce){.scene img{animation:none!important;translate:none!important;transition:none!important;}}
`;
  function injectSceneCss() {
    if (document.getElementById('sceneLayersCss')) return;
    const style = document.createElement('style');
    style.id = 'sceneLayersCss';
    style.textContent = SCENE_CSS;
    document.head.appendChild(style);
  }

  /* 护眼模式：<html data-theme="night">。切换时把已经画好的底图换成夜色那张（只有开护眼才会下载） */
  const isNight = () => document.documentElement.getAttribute('data-theme') === 'night';
  if (global.MutationObserver) {
    new MutationObserver(() => {
      const night = isNight();
      document.querySelectorAll('.scene-plate[data-night]').forEach(p => {
        const want = night ? p.dataset.night : p.dataset.day;
        if (p.src !== want) p.src = want;
      });
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  const sceneCache = new Map();
  async function paintScene(el, url) {
    if (!sceneCache.has(url)) sceneCache.set(url, fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null));
    const spec = await sceneCache.get(url);
    if (!spec || !Array.isArray(spec.size)) return false;
    injectSceneCss();
    const base = url.replace(/[^/]*$/, '');
    const [W, H] = spec.size;
    const img = (src, cls) => {
      const i = document.createElement('img');
      i.src = base + src;
      i.alt = '';
      i.decoding = 'async';
      if (cls) i.className = cls;
      return i;
    };
    const root = document.createElement('div');
    root.className = 'scene';
    root.setAttribute('aria-hidden', 'true');
    const stage = document.createElement('div');
    stage.className = 'scene-stage';
    stage.style.setProperty('--ar', String(W / H));
    const plate = img(spec.plate, 'scene-plate');
    if (spec.night && spec.night.plate) {
      plate.dataset.day = plate.src;
      plate.dataset.night = new URL(base + spec.night.plate, location.href).href;   // 跟 .src 一样用完整网址，才比得出有没有变
      if (isNight()) plate.src = plate.dataset.night;
      root.style.setProperty('--night-layer-opacity', String(spec.night.layer_opacity));
    }
    stage.appendChild(plate);
    root.appendChild(stage);

    (spec.layers || []).forEach((L, i) => {
      const motion = L.motion && L.motion !== 'none' ? `m-${L.motion}` : '';
      // 视差的深度：越大的元素看起来越近，跟著鼠标错开得越多（4 到 14 像素）
      const depth = Array.isArray(L.box) ? 4 + 10 * Math.min(1, Math.sqrt(L.box[2] * L.box[3]) / 160) : 6;
      const tune = node => {
        node.style.setProperty('--depth', `${depth.toFixed(1)}px`);
        if (L.speed) node.style.setProperty('--spd', `${L.speed}s`);
        // 错开相位，不要全部一起摆（负的延迟 = 一开始就在动画中途）
        node.style.setProperty('--dly', `${-((i * 2.3) % (L.speed || 10))}s`);
        if (L.origin) node.style.transformOrigin = L.origin;
        return node;
      };
      if (L.wide && Array.isArray(L.box)) {
        const [x, y, w, h] = L.box;
        const n = tune(img(L.src, `is-wide ${motion}`));
        Object.assign(n.style, { left: `${x / W * 100}%`, top: `${y / H * 100}%`, width: `${w / W * 100}%`, height: `${h / H * 100}%` });
        stage.appendChild(n);
      }
      if (L.tall) {
        const n = tune(img(L.src, `is-tall ${motion}`));
        ['left', 'right', 'top', 'bottom', 'width'].forEach(k => { if (L.tall[k] !== undefined) n.style[k] = L.tall[k]; });
        n.style.height = 'auto';
        root.appendChild(n);
      }
    });
    el.style.backgroundImage = '';
    el.replaceChildren(root);
    return true;
  }

  /* ---------- 视差：图层跟著鼠标往反方向错开几个像素，底图不动（动了会露出边） ----------
     只在有鼠标的装置、没开「减少动态」时；手机没有游标，读陀螺仪在 iOS 还要跳权限视窗，不做。 */
  const mq = q => (global.matchMedia ? global.matchMedia(q) : { matches: false });
  const finePointer = mq('(hover: hover) and (pointer: fine)');
  const reducedMotion = mq('(prefers-reduced-motion: reduce)');
  let plxEl = null, plxRaf = 0, plxX = 0, plxY = 0;
  function onPointer(e) {
    plxX = e.clientX / global.innerWidth * 2 - 1;
    plxY = e.clientY / global.innerHeight * 2 - 1;
    if (plxRaf) return;
    plxRaf = requestAnimationFrame(() => {
      plxRaf = 0;
      if (!plxEl) return;
      plxEl.style.setProperty('--px', plxX.toFixed(3));
      plxEl.style.setProperty('--py', plxY.toFixed(3));
    });
  }
  function setParallax(el, on) {
    const next = on && el && finePointer.matches && !reducedMotion.matches ? el : null;
    if (plxEl && plxEl !== next) {            // 关掉时让图层滑回原位
      plxEl.style.setProperty('--px', '0');
      plxEl.style.setProperty('--py', '0');
    }
    if (next && !plxEl) global.addEventListener('pointermove', onPointer, { passive: true });
    if (!next && plxEl) global.removeEventListener('pointermove', onPointer);
    plxEl = next;
  }

  /* ---------- 回应学习 ----------
     shine：一整章都答对的那一刻，会动的元素闪一下微弱的金光，由左到右扫过去。
       只动 filter（一圈 4px 的金色 drop-shadow），不动位置，原本的摇摆照常进行。
       比过三种：加 brightness 会把水彩洗白、两层 shadow 较慢；这一种最清楚也最快（桌面 1920 闪的 1.6 秒内 54 fps）。
       「减少动态」时照样闪（它是光，不是移动），只是不扫、全部同时。
     glow：今天的复习做完了，画面上方透进一片暖光，一直留到换科目。 */
  const GOLD_OFF = 'drop-shadow(0 0 0 rgba(245, 170, 20, 0))';
  const GOLD_ON = 'drop-shadow(0 0 4px rgba(245, 170, 20, 0.85))';
  function shine(el) {
    if (!el) return;
    el.querySelectorAll('.scene .m-sway, .scene .m-float, .scene .m-bob, .scene .m-drift').forEach(n => {
      const r = n.getBoundingClientRect();
      if (!r.width) return;                    // 这个版面没显示的那一份（is-wide / is-tall）
      n.animate([{ filter: GOLD_OFF }, { filter: GOLD_ON, offset: 0.3 }, { filter: GOLD_OFF }],
        { duration: 1600, delay: reducedMotion.matches ? 0 : Math.max(0, r.left / global.innerWidth) * 600, easing: 'ease-in-out' });
    });
  }
  function glow(el, on) {
    if (el) el.classList.toggle('scene-glow', Boolean(on));
  }

  async function paint(el, url) {
    if (!el) return;
    if (!url) {
      el.style.backgroundImage = '';
      el.replaceChildren();
      return;
    }
    if (/\.json(\?|$)/i.test(url)) {
      if (await paintScene(el, url)) return;
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
    if (window.setBtnLabel) window.setBtnLabel(state.btn, state.musicOn ? 'music' : 'music-off', state.musicOn ? '音乐：开' : '音乐：关', state.musicOn);
    else state.btn.textContent = state.musicOn ? '音乐：开' : '音乐：关';
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
    use, setMusic, resolve, findBackground, findMusic, paint, setParallax, shine, glow,
    isMusicOn: () => state.musicOn,
    currentScene: () => state.scene,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
