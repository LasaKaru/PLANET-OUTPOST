/* HELAO2: Planet Outpost — service worker for offline / installable play.
   Cache-first for our own files, network fallback; the Three.js CDN is
   cached opaquely on first load so the game runs offline afterwards. */
const CACHE = 'helao2-outpost-v1';
const ASSETS = [
  './', './index.html', './css/style.css', './js/net.js', './js/game.js',
  './manifest.json', './assets/icon-192.png', './assets/icon-512.png',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c =>
    // don't fail the whole install if one (e.g. the CDN) can't be fetched
    Promise.allSettled(ASSETS.map(u => c.add(new Request(u, { mode: 'no-cors' }))))
  ).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      // stash successful same-origin responses for next time
      if (res && res.status === 200 && e.request.url.startsWith(self.location.origin)) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
