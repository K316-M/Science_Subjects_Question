const CACHE_NAME = 'uec-science-cache-v21';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/features.css',
  '/css/orbit.css',
  '/css/night.css',
  '/js/scene-assets.js',
  '/js/safe-html.js',
  '/js/orbit-subjects.js',
  '/js/notes.js',
  '/js/archive.js',
  '/js/feedback.js',
  '/js/onboarding.js',
  '/js/review.js',
  '/js/chapter-test.js',
  '/js/exam-timetable.js',
  '/js/alarm-common.js',
  '/js/exam-alarm.js',
  '/js/sync.js',
  '/js/sync-ui.js',
  '/js/devlog.js',
  '/js/theme.js',
  '/js/math-render.js',
];

// 装好之後在背景顺便下载：四科题库，加上数学公式排版（KaTeX，约 550KB）。
// 这样没打开过的科目、没看过的公式，断网时也读得到；下载失败不影响网站本身（下次上线再补）。
// 科目背景图（每科约 250KB）与背景音乐（每科约 2MB）只是装饰，不预先下载：看过的才会留着，
// 没去过的科目离线时背景退回纯色、没有音乐
const KATEX_FONTS = ['AMS-Regular', 'Caligraphic-Bold', 'Caligraphic-Regular', 'Fraktur-Bold', 'Fraktur-Regular',
  'Main-Bold', 'Main-BoldItalic', 'Main-Italic', 'Main-Regular', 'Math-BoldItalic', 'Math-Italic',
  'SansSerif-Bold', 'SansSerif-Italic', 'SansSerif-Regular', 'Script-Regular',
  'Size1-Regular', 'Size2-Regular', 'Size3-Regular', 'Size4-Regular', 'Typewriter-Regular'];
const OFFLINE_EXTRAS = [
  '/papers/biology_question_bank.json',
  '/papers/chemistry_question_bank.json',
  '/papers/physics_question_bank.json',
  '/papers/math_question_bank.json',
  '/vendor/katex/katex.min.js',
  '/vendor/katex/katex-swap.min.css',
  '/vendor/katex/contrib/auto-render.min.js',
  ...KATEX_FONTS.map(f => `/vendor/katex/fonts/KaTeX_${f}.woff2`),
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all([
      cache.addAll(APP_SHELL),
      // 额外的下载失败也不该让网站本身装不起来（要等它下载完，不然浏览器可能中途把 Service Worker 停掉）
      cache.addAll(OFFLINE_EXTRAS).catch(() => {}),
    ]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 网络优先、缓存兜底：题库内容会持续更新，优先拿最新版本；
// 离线或弱网时回退到上次成功加载过的版本，而不是白屏。
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' && req.method !== 'HEAD') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 接口响应带登录状态，开发者工作台也不该离线缓存
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/dev/') || url.pathname === '/dev') return;

  // 背景与音乐先用 HEAD 探测档案在不在（js/scene-assets.js）。离线时用快取里的同一个档案回答：
  // 没接住的话，图明明快取了，也会被当成「没有这张图」，各科背景都换不了
  if (req.method === 'HEAD') {
    event.respondWith(
      fetch(req).catch(() => caches.match(req.url).then((cached) =>
        cached ? new Response(null, { status: cached.status, headers: cached.headers }) : Response.error()))
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        // 素材探测本来就会打出 404（代表「这个文件没放」），别把失败结果存进缓存；
        // 音乐是分段下载（206），快取存不了分段的回应，也不存
        if (res.status === 200) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      })
      // 快取里没有：只有「打开网页」才回首页。图片、公式程式、音乐也回首页的话，
      // 浏览器会拿一整份 HTML 当图片、当程式跑 —— 数学公式卡住、不会退回显示原文
      .catch(() => caches.match(req).then((cached) => cached || (req.mode === 'navigate' ? caches.match('/index.html') : Response.error())))
  );
});

// 统考闹钟（api/alarm-tick.js 推播过来的）：跳出通知，网站关着也会。
// 网站正开着、看得到的话，系统通知不出声，改由网页（js/exam-alarm.js）播学生选的音效
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || '统考闹钟';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    // 只叫一个分页播音效（开了好几个分页也只响一次），优先正在看的那个
    const page = list.find((c) => c.visibilityState === 'visible') || list[0];
    if (page) page.postMessage({ type: 'uec-alarm', title, body: data.body || '', tag: data.tag });
    return self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || 'uec-alarm',
      renotify: true,
      icon: '/assets/icons/android-chrome-192x192.png',
      silent: list.some((c) => c.visibilityState === 'visible'),
    });
  }));
});

// 点通知：网站开着就切过去，没开就打开首页
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => 'focus' in c);
    return open ? open.focus() : self.clients.openWindow('/');
  }));
});
