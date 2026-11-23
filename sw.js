/* Ascension service worker: the app opens instantly and offline.
   - The app itself (page, scripts, data, icons) is stored on install; a new version replaces it (bump VERSION).
   - Question pictures, solution pictures and formula PDFs are stored the first time each is opened.
   - GitHub (progress storage) is never cached: those requests always go to the network. */
const VERSION = 'ascension-2026-11-23e';
const SHELL = ['./', 'index.html', 'ghstore.js', 'manifest.webmanifest', 'papers/mock.js', 'formulas/index.js', 'formulas/practice.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION && k !== 'ascension-media').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname === 'api.github.com') return;   // progress storage: network only
  const media = /\.(png|jpe?g|pdf|woff2?)$/i.test(u.pathname) && !u.pathname.includes('/icons/');
  if (media) {   // pictures, PDFs, fonts: from storage if seen before, otherwise fetched once and kept
    e.respondWith(caches.open('ascension-media').then(c => c.match(e.request).then(hit => hit ||
      fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') c.put(e.request, r.clone()); return r; }))));
    return;
  }
  // the app: answer from storage at once, refresh it in the background for next time
  e.respondWith(caches.open(VERSION).then(c => c.match(e.request, {ignoreSearch: true}).then(hit => {
    const net = fetch(e.request).then(r => { if (r.ok && u.origin === location.origin) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  })));
});
