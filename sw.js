/* =========================================================
   sw.js —— Service Worker：离线缓存，让游戏装到主屏后完全离线可玩
   策略：
     · 导航请求   → 网络优先，失败回落到缓存的 index.html（离线也能开）
     · 静态资源   → 缓存优先 + 后台静默更新（stale-while-revalidate）
     · 其它跨域   → 直接放行，不参与缓存
   版本：改 ASSETS 或任意文件后把 VERSION 加一，旧缓存会在 activate 时清掉
   ========================================================= */
const VERSION = 'v2.2.0';
const CACHE = `game24-${VERSION}`;

/* 需要预缓存的文件（tools/pwa.test.mjs 会校验这份清单覆盖 index.html 里的所有本地引用） */
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/h5.js',
  './js/fraction.js',
  './js/solver.js',
  './js/dealer.js',
  './js/sfx.js',
  './js/fx.js',
  './js/levels.js',
  './js/game.js',
  './icons/favicon.svg',
  './icons/icon.svg',
  './icons/logo.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/share-1200x630.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 逐个 add，某个文件缺失不至于让整次安装失败
    await Promise.all(ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' }))
      .catch((err) => console.warn('[sw] 预缓存失败:', url, err && err.message))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE && k.startsWith('game24-')).map((k) => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (e) { /* 忽略 */ }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION, assets: ASSETS.length });
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 跨域交给浏览器

  // 1) 页面导航：网络优先（保证拿到新版本），离线时用缓存兜底
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  // 2) 静态资源：缓存优先 + 后台更新
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => {
      if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (hit) {
      event.waitUntil(network.catch(() => {}));
      return hit;
    }
    const res = await network;
    return res || new Response('离线且未缓存：' + url.pathname, { status: 504, statusText: 'Offline' });
  })());
});
