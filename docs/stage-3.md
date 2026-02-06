# Stage 3 - WebSocket Delivery

## Goal
Add a WebSocket live delivery channel that receives the same canonical `alertEvent` as SSE and logs ACK receipts for latency comparison.

## What We Implemented
- `GET /api/ws`: WebSocket endpoint for live alert delivery.
- Redis Pub/Sub bridge fan-out now targets both:
  - SSE clients (`/api/sse`)
  - WS clients (`/api/ws`)
- ACK logging remains protocol-aware (`transport: "SSE" | "WS" | "PUSH"`), so WS receipts are sliced cleanly from the same stream.

## Key Code Paths
- WS route:
  - `src/routes/ws.ts`
  - Registers clients on open, removes on close/error, and emits a one-time `hello` message.
- Unified fan-out:
  - `src/index.ts`
  - On each `alerts:high` Pub/Sub message, sends:
    - SSE event `"alert"` with raw `alertEvent` JSON
    - WS text frame with the same raw `alertEvent` JSON
- ACK logging:
  - `src/routes/ack.ts`
  - Stores transport-tagged ACK events in `alerts:acks`.

## Tests (Manual)

### 1) Start server
```sh
bun run dev
```

### 2) Open WebSocket client
In browser console:
```js
const ws = new WebSocket("ws://localhost:3000/api/ws");
ws.onopen = () => console.log("ws connected");
ws.onmessage = async (event) => {
  const payload = JSON.parse(event.data);

  if (payload.event === "hello") {
    console.log("hello", payload);
    return;
  }

  console.log("ALERT(WS)", payload);

  await fetch("http://localhost:3000/api/ack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      alertId: payload.alertId,
      transport: "WS",
      receivedAtClient: Date.now(),
      serverTimestamp: payload.serverTimestamp
    })
  });
};
```

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

### 4) Confirm WS ACK stored
```sh
docker exec -it thesis-redis redis-cli XRANGE alerts:acks - + COUNT 20
```

Expected: an entry JSON containing `"transport":"WS"` and timestamps.

### 5) Compare SSE vs WS latency
```sh
docker exec -i thesis-redis redis-cli XRANGE alerts:acks - + COUNT 200 \
| awk -F'json\" \"' 'NF>1 {print $2}' \
| sed 's/\"$//' \
| jq -r 'fromjson | [.transport, .endToEndLatencyMs] | @tsv'
```

Expected: rows grouped by transport, for example:
- `SSE   120`
- `WS    75`

## Result
Stage 3 is complete:
- Same canonical `alertEvent` is delivered to WS clients in real time.
- WS ACKs are logged with protocol tag and timestamps.
- WS/SSE latency can be compared from shared ACK stream data.
