/* ==========================================================================
   ClassPulse — sw.js
   Cache-first app shell so the app opens instantly and works with no network.
   Data never goes through the service worker: scans live in localStorage and
   sync over fetch() to the optional ClassPulse server, which is bypassed here.

   Bump CACHE when you ship new files.
   ========================================================================== */
const CACHE = "classpulse-v1.5.0";
// Bump CACHE *and* V together when you ship new files: index.html asks for
// css/js with ?v=<V>, so old copies can never be served after an update.
const V = "?v=1.5.0";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/theme.css" + V,
  "./css/app.css" + V,
  "./icons/icon.svg",
  "./icons/icon-64.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./vendor/qrcode-generator.js" + V,
  "./vendor/jsQR.js" + V,
  "./js/util.js" + V,
  "./js/charts.js" + V,
  "./js/ui.js" + V,
  "./js/store.js" + V,
  "./js/qr.js" + V,
  "./js/curriculum.js" + V,
  "./js/export.js" + V,
  "./js/academic.js" + V,
  "./js/sync.js" + V,
  "./js/views-common.js" + V,
  "./js/views-setup.js" + V,
  "./js/views-dos.js" + V,
  "./js/views-head.js" + V,
  "./js/views-admin.js" + V,
  "./js/views-academic.js" + V,
  "./js/views-assess.js" + V,
  "./js/app.js" + V,
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // addAll is atomic; add files one by one so one miss cannot break install
      Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: "reload" })).catch(() => null)))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;          // never touch other origins
  if (/^\/api\//.test(url.pathname)) return;                // server traffic is live, not cached

  // Navigations: network first, fall back to the cached shell (offline start).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Everything else: cache first, then network (and remember it).
  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        // refresh quietly in the background
        fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
          }
        }).catch(() => {});
        return hit;
      }
      return fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});

/* ------------------------------------------------------------------ push */
self.addEventListener("push", (event) => {
  let data = { title: "ClassPulse", body: "New activity" };
  try { data = Object.assign(data, event.data ? event.data.json() : {}); } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "icons/icon-192.png",
      badge: "icons/icon-64.png",
      tag: data.tag || "classpulse",
      renotify: !!data.tag,
      data: { url: data.url || "./index.html" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "./index.html";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.indexOf(target) >= 0 && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
