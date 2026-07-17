/* 出國購物趣 · 最小 service worker
   只為了讓網站可安裝（PWA installability）。
   刻意不做積極快取——永遠優先抓網路，避免使用者卡在舊版 JS；
   只有在離線抓不到時才退回快取（幾乎不會發生）。 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
