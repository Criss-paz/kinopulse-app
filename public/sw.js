const CACHE = 'kinopulse-v3';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  // Nunca cachear llamadas a GitHub API, catálogo en vivo ni streams de video
  if (
    url.includes('raw.githubusercontent.com') ||
    url.includes('api.github.com') ||
    url.includes('huggingface.co') ||
    url.includes('catalog.json')
  ) {
    return;
  }
  // Network-first para que siempre traiga la interfaz más reciente si hay internet
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
