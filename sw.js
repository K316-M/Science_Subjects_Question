const CACHE_NAME = 'uec-science-cache-v14';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/features.css',
  '/css/orbit.css',
  '/css/night.css',
  '/js/scene-assets.js',
  '/js/orbit-subjects.js',
  '/js/notes.js',
  '/js/archive.js',
  '/js/feedback.js',
  '/js/onboarding.js',
  '/js/review.js',
  '/js/chapter-test.js',
  '/js/exam-timetable.js',
  '/js/sync.js',
  '/js/sync-ui.js',
  '/js/theme.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
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
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 接口响应带登录状态，开发者工作台也不该离线缓存
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/dev/') || url.pathname === '/dev') return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        // 素材探测本来就会打出 404（代表「这个文件没放」），别把失败结果存进缓存
        if (res.ok) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        }
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/index.html')))
  );
});
