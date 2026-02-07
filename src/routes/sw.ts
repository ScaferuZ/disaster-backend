import { Hono } from "hono";

const route = new Hono();

route.get("/sw.js", (c) => {
	const script = `
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "Disaster Alert";
  const body = data.body || "New alert received";
  const alertId = data.alertEvent?.alertId;
  const serverTimestamp = data.alertEvent?.serverTimestamp;

  const showPromise = self.registration.showNotification(title, {
    body,
    data: { alertId, serverTimestamp, clickUrl: "/" },
  });

  // Best-effort delivery ACK; this can fail offline and is expected.
  const deliveredAckPromise =
    alertId && typeof serverTimestamp === "number"
      ? fetch("/api/ack", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            alertId,
            transport: "PUSH",
            ackStage: "DELIVERED",
            receivedAtClient: Date.now(),
            serverTimestamp
          })
        }).catch(() => {})
      : Promise.resolve();

  event.waitUntil(Promise.allSettled([showPromise, deliveredAckPromise]));
});

self.addEventListener("notificationclick", (event) => {
  const noteData = event.notification.data || {};
  event.notification.close();

  event.waitUntil((async () => {
    await fetch("/api/ack", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        alertId: noteData.alertId,
        transport: "PUSH",
        ackStage: "OPENED",
        receivedAtClient: Date.now(),
        serverTimestamp: noteData.serverTimestamp
      })
    }).catch(() => {});

    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    if (all.length > 0) {
      await all[0].focus();
      return;
    }
    await clients.openWindow(noteData.clickUrl || "/");
  })());
});
`.trim();

	return c.body(script, 200, {
		"content-type": "application/javascript; charset=utf-8",
		"cache-control": "no-store",
	});
});

export default route;
