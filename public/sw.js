const CACHE_NAME = 'batabitoo-mail-v25-nocache';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Never intercept or cache index.html, root, or API calls
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  // Network-first for static assets
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .catch(() => caches.match(event.request))
  );
});
