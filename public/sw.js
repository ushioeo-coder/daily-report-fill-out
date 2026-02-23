const CACHE_NAME = 'daily-report-v1';

// キャッシュするstaticアセット
const STATIC_ASSETS = [
  '/',
  '/login',
];

// インストール時: staticアセットをキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// アクティベート時: 古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// フェッチ戦略:
// - /api/* → Network Only (常に最新データを取得)
// - その他  → Network First (オフライン時はキャッシュにフォールバック)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API リクエストはネットワークのみ
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  // その他: Network First
  event.respondWith(
    fetch(request)
      .then((response) => {
        // 成功レスポンスをキャッシュに保存
        if (response.ok && request.method === 'GET') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // オフライン時: キャッシュから返却
        return caches.match(request).then((cached) => {
          if (cached) return cached;
          // HTMLリクエストにはルートページを返す
          if (request.headers.get('Accept')?.includes('text/html')) {
            return caches.match('/');
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
