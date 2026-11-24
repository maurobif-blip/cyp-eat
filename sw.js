/* CYP EAT: keeps the app on the phone so it opens without internet. VERSION changes at every update. */
var VERSION = 'cyp-eat-alpha-0.22-6403f246';
var FILES = ['./', 'index.html', 'core.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-48.png', 'tokens.css', 'ds/bundle.css', 'fonts/Ubuntu-Medium.woff2', 'fonts/Ubuntu-Bold.woff2', 'fonts/OpenSans-Regular.woff2', 'fonts/OpenSans-Bold.woff2'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); })); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; /* the database is never kept here */
  /* always ask GitHub for a newer file (no-cache: the browser checks, and downloads only what changed) */
  e.respondWith(fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' }).then(function (res) { if (res && res.ok) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put(req, copy); }); } return res; }).catch(function () { return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('index.html'); }); }));
});
