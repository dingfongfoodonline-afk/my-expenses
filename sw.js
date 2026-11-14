/* Offline service worker: caches the app shell only (never your data).
   v1.6.1: every file comes from ONE versioned cache, so a new index.html can never run with an old app.js.
   Install fetches straight from the network (bypassing the HTTP cache), checks that the files carry this version,
   and fails on a half-finished deploy so the previous version keeps working until the next try. */
const VERSION = '1.6.2';
const CACHE = 'my-expenses-v' + VERSION;
const ASSETS = ['./', './index.html', './style.css', './logic.js', './vault.js', './db.js', './export.js', './app.js', './manifest.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png'];
const MUST_MATCH = { './index.html': 'content="' + VERSION + '"', './app.js': "APP_VERSION = '" + VERSION + "'", './export.js': "VERSION: '" + VERSION + "'" };

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    try {
      const fetched = [];
      for (const url of ASSETS) { // download everything first; write the cache only when the whole set is right
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (!res.ok) throw new Error('precache failed: ' + url + ' ' + res.status);
        if (MUST_MATCH[url] && !(await res.clone().text()).includes(MUST_MATCH[url])) throw new Error('stale file during deploy: ' + url);
        fetched.push([url, res]);
      }
      const cache = await caches.open(CACHE);
      for (const [url, res] of fetched) await cache.put(url, res);
    } catch (err) { await caches.delete(CACHE); throw err; }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE); // this version's cache only
    if (req.mode === 'navigate') {
      const hit = await cache.match('./index.html');
      if (hit) return hit;
      try { return await fetch(req); } catch (_) { return (await cache.match('./')) || Response.error(); }
    }
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return fetch(req);
  })());
});
