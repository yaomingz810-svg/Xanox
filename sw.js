/* Minimal SW for home-screen install; no web push on plan B. */
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => { /* network-first passthrough */ });
