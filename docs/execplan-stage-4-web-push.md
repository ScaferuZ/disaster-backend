# Implement Stage 4 Web Push Delivery

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `.agent/PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the backend can deliver canonical `alertEvent` notifications through Web Push in addition to SSE and WebSocket. A client can subscribe once, then still receive alert notifications while the tab is closed via its service worker. Push acknowledgements continue to use `POST /api/ack` with `transport: "PUSH"`, so cross-protocol metrics remain comparable.

## Progress

- [x] (2026-02-06 13:02Z) Reviewed Stage 4 requirements in `TASKS.md` and repository constraints in `AGENTS.md`.
- [x] (2026-02-06 13:03Z) Consulted Context7 docs for `web-push` VAPID, `sendNotification`, and invalid-subscription cleanup patterns.
- [x] (2026-02-06 13:06Z) Added `web-push` and `@types/web-push` dependencies.
- [x] (2026-02-06 13:08Z) Implemented push service module (`src/lib/push.ts`) with VAPID setup, subscription storage, and broadcast send logic.
- [x] (2026-02-06 13:09Z) Added push routes (`src/routes/push.ts`) for VAPID public key and subscribe/unsubscribe APIs.
- [x] (2026-02-06 13:11Z) Wired push fan-out into Redis Pub/Sub path in `src/index.ts`.
- [x] (2026-02-06 13:12Z) Added Stage 4 runbook (`docs/stage-4.md`) and VAPID generation script in `package.json`.
- [x] (2026-02-06 13:12Z) Updated Stage 4 checklist in `TASKS.md`.
- [x] (2026-02-06 13:13Z) Verified type-check with `bunx tsc --noEmit`.

## Surprises & Discoveries

- Observation: `bun add` inside sandbox failed with tempdir permission errors.
  Evidence: `error: bun is unable to write files to tempdir: PermissionDenied`.

- Observation: Enabling a permissive startup path for missing VAPID keys allows local development without blocking non-push transports.
  Evidence: `initWebPush()` warns and disables push instead of crashing app startup.

## Decision Log

- Decision: Use `web-push` library rather than implementing Web Push protocol manually.
  Rationale: It handles VAPID signing and payload encryption correctly and is the documented standard approach.
  Date/Author: 2026-02-06 / Codex

- Decision: Store subscriptions in Redis hash keyed by endpoint.
  Rationale: Fast overwrite on resubscribe and O(1) deletion on unsubscribe; simple parsing for fan-out iteration.
  Date/Author: 2026-02-06 / Codex

- Decision: Automatically remove subscriptions on push send errors `404` or `410`.
  Rationale: These statuses indicate expired or invalid subscriptions; cleaning them keeps fan-out healthy.
  Date/Author: 2026-02-06 / Codex

## Outcomes & Retrospective

The backend now has complete Stage 4 server support: VAPID config, subscription management, and push fan-out from canonical alert publish events. Remaining work for full user-visible push behavior is client-side service worker registration and notification handling in the PWA repository (documented in `docs/stage-4.md`).

## Context and Orientation

Relevant backend flow:

- `src/routes/report.ts` creates canonical `alertEvent`, stores in `alerts:stream`, and publishes distributed alerts to Redis channel `alerts:high`.
- `src/index.ts` subscribes to `alerts:high` and fans out to all live transports.
- Stage 2 already delivers SSE and logs ACKs.
- Stage 3 already delivers WS and logs ACKs.

Stage 4 adds:

- `src/lib/push.ts` to initialize VAPID, persist subscriptions in Redis hash, send push notifications, and clean invalid subscriptions.
- `src/routes/push.ts` for public VAPID key lookup and subscribe/unsubscribe endpoints.
- `src/index.ts` fan-out call to push sender in the same Pub/Sub callback.

## Plan of Work

Implement VAPID and push send logic in a dedicated library so route handlers and fan-out code remain small. Add REST endpoints for subscription lifecycle and public key retrieval under `/api/push/*`. Integrate push sending into existing alert distribution callback so push receives exactly the same canonical alerts as SSE/WS. Keep ACK endpoint unchanged and use the existing `transport` enum (`"PUSH"`) for metrics tagging.

## Concrete Steps

Run from repository root (`/Users/scaf/code/disaster-backend`).

1. Install dependencies:

   bun add web-push
   bun add -d @types/web-push

2. Add push config and service code:

   Edit `src/config.ts` and create `src/lib/push.ts`.

3. Add push API routes:

   Create `src/routes/push.ts`.

4. Wire route and fan-out:

   Edit `src/index.ts` to call `initWebPush()`, mount push route, and call `sendPushAlertToAll()` in Pub/Sub handler.

5. Add runbook/docs and task updates:

   Edit `TASKS.md`, `package.json`, and create `docs/stage-4.md`.

6. Validate:

   bunx tsc --noEmit
   bun test

## Validation and Acceptance

Acceptance conditions:

- `GET /api/push/vapid-public-key` returns configured public key.
- `POST /api/push/subscribe` stores valid browser `PushSubscription` JSON.
- `POST /api/push/unsubscribe` removes by endpoint.
- Triggering `/api/report` results in push send attempts to all stored subscriptions.
- Invalid subscriptions (`404`/`410`) are removed from Redis hash.
- ACKs posted with `transport: "PUSH"` are stored in `alerts:acks` and are queryable alongside SSE/WS ACKs.

## Idempotence and Recovery

Subscription operations are idempotent by endpoint key. Re-subscribing overwrites prior stored JSON for that endpoint. If VAPID variables are unset, push is disabled without impacting SSE/WS/report paths. Recovery path is to set valid VAPID env vars and restart the app.

## Artifacts and Notes

Commands used to verify implementation:

  bunx tsc --noEmit
  (exit code 0)

  bun test
  bun test v1.3.8 (b64edcb4)
  No tests found!

## Interfaces and Dependencies

Dependencies introduced:

- `web-push`
- `@types/web-push`

New/updated interfaces:

- `src/lib/push.ts`
  - `initWebPush()`
  - `isPushConfigured()`
  - `savePushSubscription(subscription)`
  - `removePushSubscription(endpoint)`
  - `listPushSubscriptions()`
  - `sendPushAlertToAll(alertJson)`

- `src/routes/push.ts`
  - `GET /push/vapid-public-key`
  - `POST /push/subscribe`
  - `POST /push/unsubscribe`

Revision note (2026-02-06): Initial Stage 4 ExecPlan created after implementation to keep an explicit living artifact aligned with `.agent/PLANS.md` and preserve key design decisions.
