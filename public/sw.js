// Neuron service worker: offline shell, cached reading, and push.
//
//  - Static build assets: cache-first (they are content-hashed).
//  - Pages: network-first, falling back to the last cached copy, then /offline.
//  - /api/deep-dive/* GETs: network-first with a cached fallback, so entries
//    you've opened can be re-read offline.
//  - Everything else under /api: never cached (it is per-user and changes).
const VERSION = "neuron-v1";
const STATIC = VERSION + "-static";
const PAGES = VERSION + "-pages";
const PRECACHE = ["/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw err;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request, STATIC));
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    if (/^\/api\/deep-dive\/\d+$/.test(url.pathname)) event.respondWith(networkFirst(request, PAGES));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGES, "/offline"));
  }
});

// Signing out clears anything cached for the previous account.
self.addEventListener("message", (event) => {
  if (event.data === "clear-private") event.waitUntil(caches.delete(PAGES));
});

self.addEventListener("push", (event) => {
  let data = { title: "Neuron", body: "", url: "/" };
  try {
    data = Object.assign(data, event.data.json());
  } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/192",
      badge: "/icons/192",
      data: { url: data.url },
      tag: "neuron-daily", // a new nudge replaces the old one rather than stacking
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
