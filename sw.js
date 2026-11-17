// 快取優先：打開時直接用快取（離線、弱網都立刻開）。
// 更新方式：sw.js 內容變動（遞增 CACHE）→ 背景把整批檔案抓進新快取 → 全部成功後才「等待中」，
// 頁面提示「有新版」，使用者點了才切換，因此不會新舊檔案混用。
const CACHE = 'bookkeeper-v9';
const ASSETS = [
  './', 'index.html', 'style.css', 'calc.js', 'store.js', 'categories.js', 'backup.js', 'report-core.js', 'budget-core.js', 'app.js', 'report.js', 'catedit.js', 'budget.js',
  'manifest.json', 'icon-192.png', 'icon-512.png'
];

self.addEventListener('install', (e) => {
  // cache:'reload' 略過 HTTP 快取，確保抓到的是 Pages 上最新的檔案
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).catch(() => caches.match('index.html')))
  );
});
