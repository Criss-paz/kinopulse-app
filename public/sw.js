// KinoPulse service worker: app shell offline, never caches video (range requests stream from origin/edge).
const CACHE = 'kinopulse-v2'
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './logo.svg', './pwa-192x192.png', './pwa-512x512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin || req.headers.has('range')) return

  if (req.mode === 'navigate') {
    // Network first so new releases show up immediately; fall back to the cached shell offline.
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')))
    return
  }

  // Hashed build assets are immutable: cache first.
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy))
          }
          return res
        }),
    ),
  )
})
