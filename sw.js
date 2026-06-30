/* My Recipe Box — service worker (offline + installable PWA)
   BUMP `VERSION` whenever you change index.html, app.js, styles.css, or the
   asset ?v=N query strings below — otherwise the phone keeps serving the old
   cached copy. Keep this in sync with the ?v=N in index.html. */
const VERSION = 'recipe-box-v5';

// App shell to pre-cache so the app opens instantly and works fully offline.
// These query strings MUST match the <link>/<script> tags in index.html.
const SHELL = [
  '.',
  './index.html',
  './styles.css?v=4',
  './app.js?v=4',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png',
  './favicon-32.png'
];

// Pre-cache the shell on install.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

// Clean up old caches on activate.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // never cache writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // only our own files

  // Navigations (opening the app / refresh): try network first so a fresh
  // deploy is picked up when online, fall back to the cached page offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('.')))
    );
    return;
  }

  // Everything else (versioned css/js, icons, manifest): cache-first, then
  // network; runtime-cache anything new so it's available offline next time.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
