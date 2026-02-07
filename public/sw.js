const DB_NAME = "disaster-stage5";
const DB_VERSION = 1;
const STORE_NAME = "queued_reports";
const REPORT_ENDPOINT = "/api/report";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "clientReportId" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function listQueuedReports() {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  const reports = await idbRequest(store.getAll());
  return reports.sort((a, b) => a.createdAtClient - b.createdAtClient);
}

async function removeQueuedReport(clientReportId) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  await idbRequest(store.delete(clientReportId));
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function broadcastSyncLog(message) {
  const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of allClients) {
    client.postMessage({ type: "SYNC_LOG", message });
  }
}

async function flushQueuedReports(source) {
  const reports = await listQueuedReports();
  if (reports.length === 0) {
    await broadcastSyncLog(`flush skipped (${source}): queue empty`);
    return;
  }

  await broadcastSyncLog(`flush started (${source}): ${reports.length} queued`);

  for (const report of reports) {
    try {
      const response = await fetch(REPORT_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(report),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} ${detail}`);
      }

      await removeQueuedReport(report.clientReportId);
      await broadcastSyncLog(`synced report ${report.clientReportId}`);
    } catch (err) {
      await broadcastSyncLog(`flush halted at ${report.clientReportId}: ${String(err)}`);
      break;
    }
  }
}

self.addEventListener("sync", (event) => {
  if (event.tag !== "report-sync") return;
  event.waitUntil(flushQueuedReports("background-sync"));
});

self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "FLUSH_QUEUE") return;
  event.waitUntil(flushQueuedReports("message"));
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
            serverTimestamp,
          }),
        }).catch(() => {})
      : Promise.resolve();

  event.waitUntil(Promise.allSettled([showPromise, deliveredAckPromise]));
});

self.addEventListener("notificationclick", (event) => {
  const noteData = event.notification.data || {};
  event.notification.close();

  event.waitUntil(
    (async () => {
      await fetch("/api/ack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          alertId: noteData.alertId,
          transport: "PUSH",
          ackStage: "OPENED",
          receivedAtClient: Date.now(),
          serverTimestamp: noteData.serverTimestamp,
        }),
      }).catch(() => {});

      const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
      if (all.length > 0) {
        await all[0].focus();
        return;
      }
      await clients.openWindow(noteData.clickUrl || "/");
    })(),
  );
});
