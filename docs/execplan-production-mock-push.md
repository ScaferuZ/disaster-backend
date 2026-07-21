# Add a production mock mode for Web Push fan-out

This ExecPlan is a living document and must be maintained in accordance with `.agent/PLANS.md`. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` are updated as implementation proceeds.

## Purpose / Big Picture

After this change, the production backend can fan out an alert to synthetic Redis subscriptions through a separately deployed HTTP mock sink instead of attempting Web Push encryption and vendor delivery. Operators select the behavior with `PUSH_DELIVERY_MODE=real` or `PUSH_DELIVERY_MODE=mock`. A completed fan-out records duration, throughput, delivery mode, and aggregate counts in `push:delivery`, allowing the thesis load test to measure the production backend without claiming real browser delivery.

## Progress

- [x] (2026-07-18 17:40Z) Inspected the existing push sender, health route, tests, Docker configuration, and official Bun fetch/environment guidance.
- [x] (2026-07-18 17:48Z) Added validated mock-delivery configuration and exposed the active mode in health output.
- [x] (2026-07-18 17:51Z) Added a mock HTTP delivery adapter while retaining real `web-push` behavior as the default.
- [x] (2026-07-18 17:52Z) Extended `push:delivery` evidence with duration, throughput, and delivery mode.
- [x] (2026-07-18 17:55Z) Added regression tests for mock success, expired targets, failures, and evidence fields.
- [x] (2026-07-18 18:00Z) Ran all 60 tests successfully and built `src/index.ts` successfully; repository-wide TypeScript validation remains blocked by pre-existing errors in unrelated scripts.
- [ ] Review the final diff, commit only intended feature files, and push `main`.

## Surprises & Discoveries

- Observation: The repository copy of `docker-compose.yml` does not currently show the mock-sink edits the user says were made.
  Evidence: `git diff -- docker-compose.yml` returned no diff and the file contains no `PUSH_DELIVERY_MODE` or mock-sink variables. The backend will therefore use the agreed environment variable names independently of the server-side Compose edit.

- Observation: Repository-wide `bunx tsc --noEmit` is already blocked by unrelated script errors.
  Evidence: Errors occur in existing files including `scripts/analyze-comparison.ts`, `scripts/compare-channels.ts`, `scripts/deploy-n8n-workflow.ts`, and `scripts/generate-thesis-defense-pptx.ts`; no reported error references the changed `src` files. `bun build src/index.ts --target bun` succeeds.

## Decision Log

- Decision: Keep `real` as the default delivery mode.
  Rationale: An omitted environment variable must never silently redirect production notifications to a mock service.
  Date/Author: 2026-07-18 / assistant

- Decision: Require both mock sink URL and token before mock delivery is considered configured.
  Rationale: A missing URL makes the mode unusable, while a token prevents accidental unauthenticated access even when the sink later becomes network-accessible.
  Date/Author: 2026-07-18 / assistant

- Decision: Preserve sequential fan-out semantics.
  Rationale: The current implementation sends subscriptions sequentially; changing concurrency would alter the system under test and is outside this deployment-mode feature.
  Date/Author: 2026-07-18 / assistant

## Outcomes & Retrospective

The backend now supports an explicit authenticated mock-sink mode without changing the default real Web Push path. Aggregate delivery evidence includes the active mode, start/completion timestamps, duration, and throughput. All 60 Bun tests pass and the production entry point bundles successfully. Deployment validation against the user's separate mock-sink container remains an operator step after the new image is built.

## Context and Orientation

`src/config.ts` reads environment configuration. `src/lib/push.ts` initializes VAPID credentials, reads subscriptions from the Redis Hash named by `PUSH_SUBSCRIPTIONS_HASH`, sends each notification, removes endpoints that return 404 or 410, and appends one aggregate record to `PUSH_DELIVERY_STREAM`. `src/index.ts` invokes that fan-out when an alert arrives on Redis Pub/Sub. `src/routes/health.ts` reports whether push delivery is configured. `src/__tests__/push-delivery.test.ts` verifies aggregate evidence using an in-memory Redis mock.

A mock sink is a separate HTTP service that accepts a JSON representation of the target endpoint and alert payload, then returns an HTTP status. It does not implement Web Push encryption or send to a browser. This change adapts only the backend sender; the user has separately changed production Compose configuration for the sink.

## Plan of Work

Add `PUSH_DELIVERY_MODE`, `MOCK_PUSH_SINK_URL`, and `MOCK_PUSH_SINK_TOKEN` to `src/config.ts`, accepting only `real` and `mock`. Update `src/lib/push.ts` so initialization validates VAPID variables in real mode and mock variables in mock mode. Extract one-target delivery behind injected dependencies so tests can exercise both modes without network access. In mock mode, post JSON to the configured sink with a Bearer token. Treat successful HTTP responses as sent, 404/410 as expired and removable, and all other failures as failed.

Measure the fan-out around subscription retrieval and sequential delivery. Extend the aggregate evidence with `startedAt`, `completedAt`, `durationMs`, `throughputPerSecond`, and `deliveryMode`, while preserving existing count fields. Expose the mode in `/api/health`. Expand tests to prove mode-specific behavior and evidence.

## Concrete Steps

From `/Users/scaf/code/disaster-backend`, edit the files described above. Then run:

    bun test
    bunx tsc --noEmit

Review only intended paths, stage them explicitly, create a Conventional Commit, and push `main` to `origin`.

## Validation and Acceptance

All existing tests must pass. New tests must show that mock mode posts once per subscription, sends the configured Bearer token, counts a 2xx response as sent, removes targets returning 404/410, counts a 5xx response as failed, and writes one `push:delivery` entry containing `deliveryMode: "mock"` plus non-negative timing and throughput fields. Real mode remains the default and existing no-subscription behavior remains valid. `/api/health` must expose the configured delivery mode without exposing the sink URL or token.

## Idempotence and Recovery

Tests use injected fetch and Redis mocks and do not contact production. Re-running tests is safe. Operators can roll back behavior without deleting data by setting `PUSH_DELIVERY_MODE=real` and restarting the app. If mock configuration is incomplete, push remains unconfigured rather than falling back silently to real delivery.

## Artifacts and Notes

The authoritative load-test evidence remains in `push:delivery`. Tokens and sink URLs must never be written to logs, health responses, test artifacts, or commits.

## Interfaces and Dependencies

`src/config.ts` exports `PUSH_DELIVERY_MODE` as `"real" | "mock"`, plus `MOCK_PUSH_SINK_URL` and `MOCK_PUSH_SINK_TOKEN`. `src/lib/push.ts` retains `sendPushAlertToAll(alertJson, deps?)` and expands its optional dependency object to permit injected Redis, fetch, delivery function, mode, URL, token, and clock values. No new package dependency is required; Bun's built-in `fetch` is used for mock HTTP delivery.
