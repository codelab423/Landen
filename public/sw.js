// Landen service worker: keeps a copy of the app's own files so the page can appear
// right away while the free Render server is still waking up (then the app shows
// "server is waking up"). The network always wins when it answers quickly, so new
// versions arrive as soon as they are deployed. API calls are never cached.
const CACHE = 'landen-shell-v2';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) =>
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const network = fetch(req).then((res) => {
    if (res.ok) {
      cache.put(req, res.clone());
      // Drop copies of the same file from older builds (?v=…).
      const url = new URL(req.url);
      if (url.searchParams.has('v'))
        cache.keys().then((keys) =>
          keys.forEach((k) => {
            const ku = new URL(k.url);
            if (ku.pathname === url.pathname && ku.search !== url.search) cache.delete(k);
          })
        );
    }
    return res;
  });
  network.catch(() => {});
  const cached = await cache.match(req);
  if (!cached) return network;
  const slow = new Promise((resolve) => setTimeout(() => resolve(null), 2500));
  return (await Promise.race([network.catch(() => null), slow])) || cached;
}
