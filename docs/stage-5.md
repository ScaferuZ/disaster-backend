# Stage 5 - Offline-First Reporting

## Goal
Provide a minimal PWA test harness that can submit reports online, queue reports offline, and auto-sync queued reports later for reproducible sync success metrics.

## What We Implemented
- Minimal PWA shell served by backend:
  - `GET /` -> `public/index.html`
  - `GET /app.js` -> queue/sync client logic
  - `GET /sw.js` -> service worker for background sync and push ACK handling
- Offline queue in IndexedDB (`queued_reports` store keyed by `clientReportId`).
- Sync behavior:
  - Background Sync (`sync` tag `report-sync`) when available.
  - Fallback flush on app open and browser `online` event.
- `/api/report` contract update:
  - accepts optional `clientReportId` and `createdAtClient`.
  - embeds client metadata in canonical `alertEvent.client`.
  - dedupes retries using `clientReportId` with Redis key cache.
- Sync evidence stream:
  - Redis stream `reports:sync` logs status events (`ACCEPTED`, `DEDUPED`, `FAILED_ML`).

## API Contract (Stage 5)

`POST /api/report`

Required fields remain unchanged:
- `lik_codes` (non-empty array)
- `level_of_interaction_with_disaster`
- `age`
- `usage_duration`
- `min_frequency_of_usage`
- `fishing_experience`

New optional fields:
- `clientReportId` (UUID string generated on device)
- `createdAtClient` (`Date.now()` when report created)

## Manual Validation

### 1) Start backend
```sh
bun run dev
```

### 2) Open app
- Navigate to `http://localhost:3000`
- Confirm log shows `service worker ready`.

### 3) Online submit test
- Submit form while online.
- Expected log: `sent report <uuid>`.
- Verify report metadata is in alert stream:
```sh
docker exec -i thesis-redis redis-cli --raw XRANGE alerts:stream - + COUNT 20 \
| jq -Rr 'fromjson? | select(type=="object") | .client'
```

### 4) Offline queue test
- In browser DevTools, set network offline.
- Submit form.
- Expected log: `queued report <uuid>`.

### 5) Sync on reconnect
- Restore network online.
- Expected log: `flush started ...` then `synced report <uuid>`.

### 6) Verify sync evidence stream
```sh
docker exec -i thesis-redis redis-cli --raw XRANGE reports:sync - + COUNT 200 \
| jq -Rr 'fromjson? | select(type=="object")'
```
Expected: entries with `status` values such as `ACCEPTED` and `DEDUPED`.

## Deduplication Behavior
- If the same `clientReportId` is retried, backend returns cached success payload and marks response with `deduped: true`.
- Deduplication cache key uses `REPORT_DEDUPE_PREFIX` and currently expires after 7 days.

## Notes
- This Stage 5 app is intentionally minimal for protocol/system validation and thesis evidence collection.
- A future full PWA can replace UI/UX while retaining the same API contract and queue/ACK semantics.
