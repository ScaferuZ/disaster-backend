const DB_NAME = "disaster-stage5";
const DB_VERSION = 1;
const STORE_NAME = "queued_reports";
const REPORT_ENDPOINT = "/api/report";
const SYNC_TAG = "report-sync";
const PUSH_VAPID_ENDPOINT = "/api/push/vapid-public-key";
const PUSH_SUBSCRIBE_ENDPOINT = "/api/push/subscribe";
const PUSH_UNSUBSCRIBE_ENDPOINT = "/api/push/unsubscribe";

const form = document.getElementById("report-form");
const flushNowButton = document.getElementById("flush-now");
const pushToggleButton = document.getElementById("push-toggle");
const logNode = document.getElementById("log");
const networkState = document.getElementById("network-state");

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  logNode.textContent = `${line}\n${logNode.textContent}`;
}

function updateNetworkState() {
  networkState.textContent = navigator.onLine ? "online" : "offline";
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

function setPushToggleState({ enabled, disabled }) {
  if (disabled) {
    pushToggleButton.disabled = true;
    pushToggleButton.textContent = "Push Unsupported";
    return;
  }

  pushToggleButton.disabled = false;
  pushToggleButton.textContent = enabled ? "Disable Push" : "Enable Push";
}

async function getPushSubscription() {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function refreshPushToggle() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    setPushToggleState({ enabled: false, disabled: true });
    return;
  }

  const subscription = await getPushSubscription();
  setPushToggleState({ enabled: Boolean(subscription), disabled: false });
}

async function subscribePush() {
  if (!("PushManager" in window) || !("Notification" in window)) {
    throw new Error("push api unsupported in this browser");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(`notification permission is ${permission}`);
  }

  const vapidResponse = await fetch(PUSH_VAPID_ENDPOINT);
  if (!vapidResponse.ok) {
    const detail = await vapidResponse.text().catch(() => "");
    throw new Error(`failed to fetch VAPID key (${vapidResponse.status}) ${detail}`);
  }

  const vapidPayload = await vapidResponse.json();
  const publicKey = vapidPayload.publicKey;
  if (!publicKey) {
    throw new Error("missing VAPID public key from backend");
  }

  const reg = await navigator.serviceWorker.ready;
  let subscription = await reg.pushManager.getSubscription();
  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  const subscribeResponse = await fetch(PUSH_SUBSCRIBE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });

  if (!subscribeResponse.ok) {
    const detail = await subscribeResponse.text().catch(() => "");
    throw new Error(`subscribe API failed (${subscribeResponse.status}) ${detail}`);
  }

  log("push enabled");
}

async function unsubscribePush() {
  const existing = await getPushSubscription();
  if (!existing) {
    log("push already disabled");
    return;
  }

  await fetch(PUSH_UNSUBSCRIBE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: existing.endpoint }),
  }).catch(() => {});

  await existing.unsubscribe();
  log("push disabled");
}

async function togglePush() {
  try {
    const subscription = await getPushSubscription();
    if (subscription) {
      await unsubscribePush();
    } else {
      await subscribePush();
    }
    await refreshPushToggle();
  } catch (err) {
    log(`push toggle failed: ${String(err)}`);
  }
}

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

async function queueReport(report) {
  const db = await openDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  await idbRequest(store.put(report));
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  log(`queued report ${report.clientReportId}`);
}

async function getQueuedReports() {
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

async function sendReport(report) {
  const response = await fetch(REPORT_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(report),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`report send failed (${response.status}) ${detail}`);
  }

  return response.json();
}

async function registerBackgroundSync() {
  if (!("serviceWorker" in navigator)) return false;

  const reg = await navigator.serviceWorker.ready;
  if (!("sync" in reg)) {
    return false;
  }

  try {
    await reg.sync.register(SYNC_TAG);
    log("background sync registered");
    return true;
  } catch (err) {
    log(`background sync registration failed: ${String(err)}`);
    return false;
  }
}

async function flushQueue(source) {
  const queued = await getQueuedReports();
  if (queued.length === 0) {
    log(`flush skipped (${source}): queue empty`);
    return;
  }

  log(`flush started (${source}): ${queued.length} queued`);

  for (const report of queued) {
    try {
      await sendReport(report);
      await removeQueuedReport(report.clientReportId);
      log(`synced report ${report.clientReportId}`);
    } catch (err) {
      log(`sync halted for ${report.clientReportId}: ${String(err)}`);
      break;
    }
  }
}

function buildReportFromForm() {
  const likCodesRaw = document.getElementById("lik_codes").value;
  const lik_codes = likCodesRaw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  return {
    lik_codes,
    level_of_interaction_with_disaster: Number(document.getElementById("level_of_interaction_with_disaster").value),
    age: Number(document.getElementById("age").value),
    usage_duration: Number(document.getElementById("usage_duration").value),
    min_frequency_of_usage: Number(document.getElementById("min_frequency_of_usage").value),
    fishing_experience: Number(document.getElementById("fishing_experience").value),
    clientReportId: crypto.randomUUID(),
    createdAtClient: Date.now(),
  };
}

async function handleSubmit(event) {
  event.preventDefault();
  const report = buildReportFromForm();

  if (!Array.isArray(report.lik_codes) || report.lik_codes.length === 0) {
    log("submit blocked: lik_codes is empty");
    return;
  }

  if (!navigator.onLine) {
    await queueReport(report);
    const syncRegistered = await registerBackgroundSync();
    if (!syncRegistered) {
      log("background sync unavailable; waiting for online/app-open flush");
    }
    return;
  }

  try {
    await sendReport(report);
    log(`sent report ${report.clientReportId}`);
  } catch (err) {
    log(`online send failed; queued ${report.clientReportId}: ${String(err)}`);
    await queueReport(report);
    const syncRegistered = await registerBackgroundSync();
    if (!syncRegistered) {
      log("background sync unavailable; waiting for online/app-open flush");
    }
  }
}

async function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    log("service worker unsupported in this browser");
    return;
  }

  await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  log("service worker ready");

  navigator.serviceWorker.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.type !== "SYNC_LOG") return;
    log(`sw: ${data.message}`);
  });
}

window.addEventListener("online", async () => {
  updateNetworkState();
  await flushQueue("online-event");
});

window.addEventListener("offline", () => {
  updateNetworkState();
  log("network offline");
});

flushNowButton.addEventListener("click", async () => {
  await flushQueue("manual");
});
pushToggleButton.addEventListener("click", () => {
  togglePush();
});

form.addEventListener("submit", (event) => {
  handleSubmit(event).catch((err) => {
    log(`submit error: ${String(err)}`);
  });
});

(async () => {
  updateNetworkState();
  await setupServiceWorker();
  await refreshPushToggle();
  await flushQueue("app-open");
})();
