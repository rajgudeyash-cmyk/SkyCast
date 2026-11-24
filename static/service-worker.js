/* SkyCast service worker.
 *
 * - Pre-caches the app shell so SkyCast opens even with no connection.
 * - Pages: network first, falling back to the saved copy.
 * - CSS / JS / images: saved copy first (file names carry ?v=<version>, so updates are picked up).
 * - Weather data (/api/): never cached here. The app keeps its own clearly labelled
 *   "last saved" copy in localStorage, so stale weather is never shown as live.
 *
 * "__APP_VERSION__" is replaced by app.py when it serves this file from /service-worker.js.
 */
const VERSION = '__APP_VERSION__';
const CACHE = 'skycast-' + VERSION;
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(self.location.hostname);

const SHELL = [
  '/',
  '/favorites',
  '/about',
  '/manifest.json',
  '/static/css/style.css?v=' + VERSION,
  '/static/js/script.js?v=' + VERSION,
  '/static/images/icon-192.png',
  '/static/images/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(SHELL.map((url) =>
        // One missing file must not break the install.
        cache.add(new Request(url, { cache: 'reload' })).catch(() => null)
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('skycast-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Live data: always go to the network; answer with a JSON error when offline.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => new Response(
        JSON.stringify({ ok: false, error: { code: 'offline', message: 'You are offline. Connect to the internet to get live weather.' } }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      ))
    );
    return;
  }

  // Never cache the service worker itself.
  if (url.pathname === '/service-worker.js') return;

  // Pages and manifest: network first.
  if (req.mode === 'navigate' || url.pathname === '/manifest.json') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('/'))
        )
    );
    return;
  }

  // Static files. On localhost use network first so edits show up immediately while developing.
  if (url.pathname.startsWith('/static/')) {
    if (IS_LOCAL) {
      event.respondWith(
        fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          })
          .catch(() => caches.match(req))
      );
      return;
    }
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }))
    );
  }
});
