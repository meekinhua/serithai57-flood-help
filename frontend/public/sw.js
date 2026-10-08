// Service worker: only for notifications (no offline cache, so a deploy is never stuck behind an old copy).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (_) {
    d = { body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || "เสรีไทย 57", {
      body: d.body || "",
      icon: "/icon-192.png",
      tag: d.tag || undefined,
      renotify: !!d.tag,
      lang: "th",
      data: { url: d.url || "/" },
    }),
  );
});

// tap → the app, opened at the item (an open tab is reused)
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if (new URL(c.url).origin !== self.location.origin) continue;
        await c.focus();
        c.postMessage({ go: url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
