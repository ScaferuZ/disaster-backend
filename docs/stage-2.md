# Stage 2 - SSE + ACK Logging

## Goal
Prove a working live delivery channel (SSE) and confirm receipt logging (ACKs) for metrics.

## What We Implemented
- `GET /api/sse`: Server-Sent Events stream that broadcasts `alertEvent` payloads.
- `POST /api/ack`: ACK endpoint that logs receipt events to Redis stream.
- Redis Pub/Sub bridge: server subscribes to `alerts:high` and fan-outs to all SSE clients.
- Redis Streams:
  - `alerts:stream` stores all alert events (canonical history)
  - `alerts:acks` stores ACK events for metrics

### Key Code Paths
- SSE:
  - `src/routes/sse.ts`
  - Keep-alive ping every 10s
  - Added safe abort handling
- ACK logging:
  - `src/routes/ack.ts`
  - Persists ACK events via `XADD` to `alerts:acks`
- Pub/Sub fan-out:
  - `src/index.ts`
  - Subscribes once on startup and broadcasts to connected SSE clients

### Operational Fixes
- Added `idleTimeout: 0` in `src/index.ts` to prevent Bun from closing long-lived SSE connections.
- Reduced SSE ping interval to 10s to keep proxies/mobile networks from closing the stream.

## Tests (Manual)

### 1) Start server
```sh
bun run dev
```

### 2) Open SSE in browser console
```js
const es = new EventSource("http://localhost:3000/api/sse");
es.addEventListener("hello", e => console.log("hello", e.data));
es.addEventListener("ping", e => console.log("ping", e.data));
es.addEventListener("alert", e => {
  const alertEvent = JSON.parse(e.data);
  console.log("ALERT", alertEvent);

  fetch("http://localhost:3000/api/ack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      alertId: alertEvent.alertId,
      transport: "SSE",
      receivedAtClient: Date.now(),
      serverTimestamp: alertEvent.serverTimestamp
    })
  }).then(async r => console.log("ACK status", r.status, await r.text()))
    .catch(err => console.error("ACK error", err));
});
```

Expected console output:
- `hello {connectedAt: ...}`
- `ping ...` every ~10s
- `ALERT {...}` after `/api/report`

### 3) Trigger a report
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

### 4) Confirm ACK stored
```sh
docker exec -it thesis-redis redis-cli XRANGE alerts:acks - + COUNT 5
```

Expected result: one entry with JSON containing `alertId`, `transport`, and timestamps.

## Result
Stage 2 is complete:
- One report creates one alert
- SSE delivers alert in real time
- ACK is logged to Redis with protocol tag and timestamps

## Future-Proofing Note
ACKs can be duplicated due to retries or reconnects. Consider logging an idempotency key for later dedupe:

`ackKey = alertId + ":" + transport + ":" + clientId`

Even without `clientId`, this provides a simple dedupe signal (`alertId:transport`).
