// Only the static offline page is cached. Seat identities, API and socket traffic
// and authorized match data are never written to CacheStorage.
const cacheName = 'quadrant-offline-v1';
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(cacheName).then((cache) => cache.add('/offline.html')),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith('quadrant-offline-') && key !== cacheName,
            )
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});
self.addEventListener('fetch', (event) => {
  if (
    event.request.mode !== 'navigate' ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match('/offline.html')),
  );
});
