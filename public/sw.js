// Starman Reborn service worker: offline play after the first visit.
// Page loads are network-first (so new deploys show up), hashed assets are cache-first.
// Once the game is up, the page sends the list of every file the build has ({ type: 'keep' });
// they are kept here, and build files no longer on the list are dropped (src/main.ts).
const CACHE = 'starman-reborn-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Keeps every listed file of this origin (from the browser's cache, mostly) and drops old build files. */
async function keep(urls) {
  const cache = await caches.open(CACHE);
  const wanted = new Set(urls);
  await Promise.all(
    urls.map(async (url) => {
      // The page itself is refreshed on every visit; build files never change under one name.
      if (!url.endsWith('/') && (await cache.match(url))) return;
      try {
        const res = await fetch(url);
        if (res.ok) await cache.put(url, res);
      } catch {
        // Offline already: keep what there is.
      }
    }),
  );
  for (const req of await cache.keys()) {
    if (new URL(req.url).pathname.includes('/assets/') && !wanted.has(req.url)) await cache.delete(req);
  }
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'keep' || !Array.isArray(data.urls)) return;
  const urls = data.urls.filter((u) => typeof u === 'string' && new URL(u, self.location.href).origin === self.location.origin);
  event.waitUntil(keep(urls.map((u) => new URL(u, self.location.href).href)));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./'))),
    );
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
