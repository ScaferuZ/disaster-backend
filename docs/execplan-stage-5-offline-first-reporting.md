# Implement Stage 5 Offline-First Reporting

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `.agent/PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the project has a minimal, reproducible PWA test harness that can submit reports while online, queue reports while offline, and automatically flush queued reports when connectivity returns. The backend accepts client-side report metadata (`clientReportId`, `createdAtClient`), dedupes retries by stable client ID, and logs sync outcomes in a dedicated stream for Stage 5 sync success metrics.

## Progress

- [x] (2026-02-07 12:54Z) Reviewed Stage 5 requirements in `AGENTS.md` and `TASKS.md` and inspected current server routes.
- [x] (2026-02-07 12:54Z) Consulted Context7 docs for Hono/Bun static serving patterns before implementation.
- [x] (2026-02-07 12:58Z) Implemented backend Stage 5 report contract updates and sync logging stream (`src/routes/report.ts`, `src/types.ts`, `src/config.ts`, `src/routes/health.ts`).
- [x] (2026-02-07 12:58Z) Implemented minimal PWA static files (`public/index.html`, `public/app.js`, `public/sw.js`).
- [x] (2026-02-07 12:58Z) Wired static file serving routes in Hono/Bun (`src/routes/web.ts`, `src/index.ts`) and removed obsolete inline SW route.
- [x] (2026-02-07 12:58Z) Updated Stage 5 runbook/docs and `TASKS.md` checklist (`docs/stage-5.md`, `TASKS.md`).
- [x] (2026-02-07 12:59Z) Validated static/type baseline with `bunx tsc --noEmit` (pass) and `bun test` (no tests found).

## Surprises & Discoveries

- Observation: The repository initially had no `public/` folder or static file serving setup for a web app shell.
  Evidence: `ls -la public` returned `No such file or directory`.

- Observation: Existing Stage 4 push ACK behavior depended on inline `src/routes/sw.ts`; moving to static `public/sw.js` required carrying those handlers forward to avoid regression.
  Evidence: `src/routes/sw.ts` had `push` and `notificationclick` ACK logic that is now preserved in `public/sw.js`.

## Decision Log

- Decision: Build a minimal in-repo PWA harness rather than waiting for a future full UI implementation.
  Rationale: Stage 5 metrics (offline queue + sync success) depend on client behavior and need reproducible testing now.
  Date/Author: 2026-02-07 / Codex

- Decision: Add a new Redis stream (`reports:sync`) for sync evidence instead of overloading ACK stream.
  Rationale: ACK stream measures alert delivery; sync stream measures report ingestion/sync outcomes. Keeping streams separate improves analysis clarity.
  Date/Author: 2026-02-07 / Codex

- Decision: Dedupe by cached response keyed with `clientReportId` for 7 days.
  Rationale: Offline retry bursts should not create duplicate alert events; returning the cached success payload makes retries idempotent for the thesis test harness.
  Date/Author: 2026-02-07 / Codex

## Outcomes & Retrospective

Implementation is complete for Stage 5 scope defined in `TASKS.md`. The backend now supports offline-client metadata and dedupe semantics, and the frontend harness provides queue + sync behavior needed for reproducible experiments. Remaining work after this plan is Stage 6 experimentation and dataset analysis.

## Context and Orientation

This backend already supports report ingestion (`src/routes/report.ts`) and live distribution (SSE/WS/Push). Stage 5 adds offline-first report creation behavior in a minimal client and server metadata needed to measure synchronization quality.

Key files now involved:

- `src/routes/report.ts`: report ingestion, ML call, canonical alert event creation, dedupe, and sync stream logging.
- `src/routes/web.ts`: static file routes for PWA shell and service worker.
- `src/index.ts`: route mounting and app setup.
- `src/types.ts`: report payload typings now include optional client metadata.
- `src/config.ts`: now includes `REPORT_SYNC_STREAM` and `REPORT_DEDUPE_PREFIX`.
- `public/index.html`, `public/app.js`, `public/sw.js`: minimal PWA harness.

## Plan of Work

Backend contract changes were implemented first, so the API is ready for offline clients. `PredictionInput` now accepts optional `clientReportId` and `createdAtClient` and validates them. The canonical `alertEvent` now includes `client` metadata. The route logs sync outcomes (`ACCEPTED`, `DEDUPED`, `FAILED_ML`) to `REPORT_SYNC_STREAM` and uses a Redis dedupe cache keyed by `clientReportId`.

Frontend implementation is intentionally minimal: a form submits reports to `/api/report`, queues unsent payloads in IndexedDB, and provides deterministic sync by Background Sync when available or `online`/app-open fallback when not. A log panel on the page provides observable evidence for testing.

## Concrete Steps

Run from repository root (`/Users/scaf/code/disaster-backend`).

1. Backend contract and route updates:

   Edit `src/types.ts`, `src/config.ts`, `src/routes/report.ts`, `src/routes/health.ts`, `src/index.ts`, create `src/routes/web.ts`, remove `src/routes/sw.ts`.

2. Minimal PWA files:

   Create `public/index.html`, `public/app.js`, `public/sw.js`.

3. Documentation updates:

   Edit `TASKS.md`, create `docs/stage-5.md`, and update this ExecPlan.

4. Validation:

   bunx tsc --noEmit

## Validation and Acceptance

Acceptance behavior for Stage 5:

- `GET /` returns a minimal report form app shell.
- Service worker registers from the app and activates.
- Submitting while offline stores a report in IndexedDB queue and logs queued state.
- Queued report flushes later via Background Sync (if supported) or via fallback flush on connectivity return/app open.
- `POST /api/report` accepts optional `clientReportId` and `createdAtClient` and persists them in canonical `alertEvent` payload stored in Redis stream.
- Re-submitting same `clientReportId` returns cached response and avoids duplicate alert publication.
- Sync events are written to `reports:sync` for success-rate analysis.

## Idempotence and Recovery

Client queue entries use a stable `clientReportId` and are deleted only after successful server acknowledgement. Server dedupe by `clientReportId` makes retries safe. If background sync is unavailable, online/app-load flush remains available as deterministic recovery. If a sync attempt fails, entries remain in IndexedDB and can be retried without mutation.

## Artifacts and Notes

Validation transcript:

   bunx tsc --noEmit
   (exit code 0)

   bun test
   bun test v1.3.8 (b64edcb4)
   No tests found!

## Interfaces and Dependencies

- Existing framework/runtime patterns remain unchanged: Hono on Bun.
- Static hosting follows Context7-verified Hono Bun guidance (`serveStatic` from `hono/bun`).
- Browser APIs used in minimal PWA:
  - Service Worker API
  - IndexedDB API
  - Background Sync API (optional path)
  - `online` event fallback path

Revision note (2026-02-07): Updated with implemented Stage 5 backend and PWA changes, decision rationale, and validation results.
