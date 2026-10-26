// Minimal service worker: makes the app installable. No caching of data —
// everything always comes fresh from the server so nothing gets lost or stale.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
