# Task List

## Stage 2 - Live Delivery (SSE + ACK logging)
- [ ] Add GET /api/sse streaming alerts to connected clients.
- [ ] Stream only canonical alertEvent from Redis Pub/Sub or Stream.
- [ ] Add receipt ACK endpoint/schema (client -> server) with timestamps.
- [ ] Log receipt ACKs for latency and delivery-rate metrics.
- [ ] Verify reconnect behavior (client can reconnect and receive new alerts).

Definition of done:
- 1 report -> 1 alert -> SSE client receives in real time.
- ACK received and logged for that alert.

## Stage 3 - WebSocket Delivery
- [ ] Add GET /api/ws.
- [ ] Broadcast the same alertEvent to WS clients.
- [ ] Log WS receipt ACKs with timestamps.
- [ ] Compare WS vs SSE latency metrics.

Definition of done:
- Same alertEvent reaches WS clients with ACK logging.

## Stage 4 - Web Push Delivery
- [ ] Generate VAPID keys.
- [ ] Store push subscriptions (Redis or DB).
- [ ] Send push notifications for alertEvent.
- [ ] Capture ACK/open/click metrics.

Definition of done:
- Alert arrives as background notification; ACKs logged.

## Stage 5 - Offline-First Reporting
- [ ] PWA report form.
- [ ] IndexedDB queue + Background Sync.
- [ ] Server endpoint to receive queued reports reliably.
- [ ] Log sync success rate.

Definition of done:
- Offline report queues; reconnect auto-syncs; server logs and distributes.

## Stage 6 - Experimentation
- [ ] Run controlled trials per protocol (2G/3G/high latency).
- [ ] Collect: end-to-end latency, delivery rate, sync success rate, CPU/RAM.
- [ ] Generate dataset + plots + interpretation.

Definition of done:
- Chapter IV dataset + plots + interpretation completed.
