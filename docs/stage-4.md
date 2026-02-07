# Stage 4 - Web Push Delivery

## Goal
Deliver `alertEvent` as background notifications using Web Push, so alerts can reach users even when the app tab is closed.

## What We Implemented
- VAPID support via env vars and startup initialization.
- Push subscription lifecycle endpoints:
  - `GET /api/push/vapid-public-key`
  - `POST /api/push/subscribe`
  - `POST /api/push/unsubscribe`
- Redis-backed subscription storage (`HSET`): one field per subscription endpoint.
- Push fan-out in the existing Redis Pub/Sub callback:
  - each distributed alert is sent to all stored push subscriptions.
  - invalid subscriptions (`404`/`410`) are removed automatically.
- ACK flow remains shared at `POST /api/ack` using `transport: "PUSH"`.

## Environment
Generate keys once:
```sh
bun run push:vapid:generate
```

Set env vars in `.env`:
```env
VAPID_SUBJECT=mailto:you@example.com
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

Optional:
```env
PUSH_SUBSCRIPTIONS_HASH=alerts:push:subscriptions
```

## Backend Endpoints

### `GET /api/push/vapid-public-key`
Returns the public key the PWA uses for `pushManager.subscribe`.

### `POST /api/push/subscribe`
Body must be a browser `PushSubscription` JSON:
```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "expirationTime": null,
  "keys": {
    "p256dh": "...",
    "auth": "..."
  }
}
```

### `POST /api/push/unsubscribe`
```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/..."
}
```

## Service Worker / Client Integration

### `sw.js`
```js
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "Disaster Alert";
  const body = data.body || "New alert received";
  const alertId = data.alertEvent?.alertId;
  const serverTimestamp = data.alertEvent?.serverTimestamp;

  event.waitUntil(
    (async () => {
      // Best-effort delivery ACK: may fail while offline
      if (alertId && typeof serverTimestamp === "number") {
        await fetch("/api/ack", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            alertId,
            transport: "PUSH",
            ackStage: "DELIVERED",
            receivedAtClient: Date.now(),
            serverTimestamp
          })
        }).catch(() => {});
      }

      await self.registration.showNotification(title, {
        body,
        data: {
          alertId,
          serverTimestamp,
          clickUrl: "/",
        },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  const noteData = event.notification.data || {};
  event.notification.close();

  event.waitUntil((async () => {
    // ACK on click/open (most reliable metric for push interaction)
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
```

### Subscribe from app code
```js
const reg = await navigator.serviceWorker.register("/sw.js");

const keyRes = await fetch("/api/push/vapid-public-key");
const { publicKey } = await keyRes.json();

const sub = await reg.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: urlBase64ToUint8Array(publicKey)
});

await fetch("/api/push/subscribe", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(sub)
});
```

## Manual Validation
1. Start server with valid VAPID env vars:
```sh
bun run dev
```
2. Register SW and subscribe from client.
3. Trigger report:
```sh
curl -X POST http://localhost:3000/api/report \
  -H "content-type: application/json" \
  -d '{
    "lik_codes":["wn-1","wn-2","wn-3","wn-4"],
    "level_of_interaction_with_disaster": 5.0,
    "age": 35.0,
    "usage_duration": 10.0,
    "min_frequency_of_usage": 10.0,
    "fishing_experience": 5.0
  }'
```
4. Confirm push subscription storage:
```sh
docker exec -i thesis-redis redis-cli HLEN alerts:push:subscriptions
```
5. Confirm push ACK:
```sh
docker exec -i thesis-redis redis-cli --raw XRANGE alerts:acks - + COUNT 200 \
| jq -Rr 'fromjson? | select(type=="object" and .transport=="PUSH")'
```

## Localhost Debug Flow (Step-by-Step)
Use this flow when push does not appear in the browser.

### 0) Clean previous subscriptions
```sh
docker exec -i thesis-redis redis-cli DEL alerts:push:subscriptions
docker exec -i thesis-redis redis-cli HLEN alerts:push:subscriptions
```
Expected: `0`

### 1) Start backend
```sh
bun run dev
```

### 2) Browser prep
- Open `http://localhost:3000` in Firefox.
- DevTools -> Application/Storage -> Service Workers -> Unregister old worker.
- Hard refresh page.

### 3) Subscribe again from console
```js
const reg = await navigator.serviceWorker.register("/sw.js");
await navigator.serviceWorker.ready;

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) output[i] = rawData.charCodeAt(i);
  return output;
}

const { publicKey } = await (await fetch("/api/push/vapid-public-key")).json();
const sub = await reg.pushManager.subscribe({
  userVisibleOnly: true,
  applicationServerKey: urlBase64ToUint8Array(publicKey),
});

await fetch("/api/push/subscribe", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(sub.toJSON()),
});

console.log("subscribed:", sub.endpoint);
```

### 4) Confirm backend stored one subscription
```sh
docker exec -i thesis-redis redis-cli HLEN alerts:push:subscriptions
curl -s http://localhost:3000/api/health | jq .push
```
Expected:
- `HLEN` is `1`
- `configured: true`
- `subscriptions: 1`

### 5) Verify notification UI works locally
Run in browser console:
```js
const swReg = await navigator.serviceWorker.ready;
await swReg.showNotification("Local SW Test", { body: "UI test" });
```
If this does not appear, fix browser/OS notification settings first.

### 6) Trigger an alert
```sh
curl -X POST http://localhost:3000/api/report \
  -H "content-type: application/json" \
  -d '{
    "lik_codes":["wn-1","wn-2","wn-3","wn-4"],
    "level_of_interaction_with_disaster": 5.0,
    "age": 35.0,
    "usage_duration": 10.0,
    "min_frequency_of_usage": 10.0,
    "fishing_experience": 5.0
  }'
```

### 7) Click notification, then verify PUSH ACK
```sh
docker exec -i thesis-redis redis-cli --raw XRANGE alerts:acks - + COUNT 500 \
| jq -Rr 'fromjson? | select(type=="object" and .transport=="PUSH")'
```

Note: `service worker stopped` status in DevTools is normal. It wakes up on events (`push`, `notificationclick`) and sleeps when idle.
