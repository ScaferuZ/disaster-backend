# Task List

## Stage 2 - Live Delivery (SSE + ACK logging)
- [x] Add GET /api/sse streaming alerts to connected clients.
- [x] Stream only canonical alertEvent from Redis Pub/Sub or Stream.
- [x] Add receipt ACK endpoint/schema (client -> server) with timestamps.
- [x] Log receipt ACKs for latency and delivery-rate metrics.
- [x] Include protocol tag (SSE/WS/PUSH) in ACK logs for clean slicing.
- [x] Verify reconnect behavior (client can reconnect and receive new alerts).

Definition of done:
- 1 report -> 1 alert -> SSE client receives in real time.
- ACK received and logged for that alert.

## Stage 3 - WebSocket Delivery
- [x] Add GET /api/ws.
- [x] Broadcast the same alertEvent to WS clients.
- [x] Log WS receipt ACKs with timestamps.
- [x] Include protocol tag (SSE/WS/PUSH) in ACK logs for clean slicing.
- [x] Compare WS vs SSE latency metrics.

Definition of done:
- Same alertEvent reaches WS clients with ACK logging.

## Stage 4 - Web Push Delivery
- [x] Generate VAPID keys.
- [x] Store push subscriptions (Redis or DB).
- [x] Send push notifications for alertEvent.
- [x] Capture ACK/open/click metrics.
- [x] Include protocol tag (SSE/WS/PUSH) in ACK logs for clean slicing.

Definition of done:
- Alert arrives as background notification; ACKs logged.

## Stage 5 - Offline-First Reporting
- [x] PWA report form.
- [x] IndexedDB queue + Background Sync.
- [x] Server endpoint to receive queued reports reliably.
- [x] Log sync success rate.

Definition of done:
- Offline report queues; reconnect auto-syncs; server logs and distributes.

## Stage 6 - Experimentation
- [ ] Run controlled trials per protocol (SSE-only, WS-only, Push-only) under 2G/3G/high latency.
- [ ] Collect: end-to-end latency, delivery rate, sync success rate, CPU/RAM.
- [ ] Generate dataset + plots + interpretation.

Definition of done:
- Chapter IV dataset + plots + interpretation completed.
