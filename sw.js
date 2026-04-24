// Simple offline-first service worker for Task Slayer
const CACHE = 'taskslayer-v15';
const CORE = [
  './',
  './index.html',
  './sync.js',
  './app.jsx',
  './faces.jsx',
  './cyberdog.jsx',
  './manifest.webmanifest',
  './faces/healthy.png','./faces/focused.png','./faces/strained.png',
  './faces/wounded.png','./faces/bloodied.png','./faces/critical.png',
  './faces/rage.png','./faces/dead.png',
  './dogs/happy.png','./dogs/alert.png','./dogs/neutral.png','./dogs/tired.png',
  './dogs/sad.png','./dogs/hurt.png','./dogs/teary.png','./dogs/crying.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(CORE.map((u) => c.add(u).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Network-first for our own HTML/JS/CSS so updates land immediately when online.
  // Cache-first is kept as a fallback for offline.
  const isOwn = url.origin === self.location.origin;
  if (isOwn) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }
  // Third-party (fonts, unpkg) — cache-first
  e.respondWith(
    caches.match(req).then((cached) => {
      const fetcher = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fetcher;
    })
  );
});
