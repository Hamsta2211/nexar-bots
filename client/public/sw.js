// Nexar Bots Service Worker: macht die Seite installierbar und startet das App-Gerüst schneller.
// API-Aufrufe werden nie zwischengespeichert.
const VERSION = "v1";
const SHELL = "nexar-shell-" + VERSION;
const ASSETS = "nexar-assets-" + VERSION;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/"]).catch(() => {})));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(async () => {
        // Asset-Cache begrenzen (alte Builds aufräumen)
        const c = await caches.open(ASSETS);
        const reqs = await c.keys();
        if (reqs.length > 90) await Promise.all(reqs.slice(0, reqs.length - 90).map((r) => c.delete(r)));
      })
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Seitenaufrufe: erst Netz (immer aktuell), offline das gespeicherte Gerüst
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || Response.error())),
    );
    return;
  }

  // Gehashte Build-Dateien und Icons: zuerst aus dem Cache
  if (url.pathname.startsWith("/assets/") || /\.(png|svg|webmanifest)$/.test(url.pathname)) {
    e.respondWith(
      caches.open(ASSETS).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
  }
});
