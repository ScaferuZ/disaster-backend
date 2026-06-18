# Learnings — data-integrity-fixes

## [2026-06-18] Environment constraints (Atlas, session start)
- Bun 1.3.8 available. `bun test` is the runner (AGENTS.md: no jest/vitest).
- **redis-cli NOT available and no Redis server running.** Unit tests MUST mock the `redis` client (createClient) instead of requiring a live Redis. Do NOT write tests that need a running Redis server, or they will fail in CI.
- Codebase uses `redis` npm package (src/lib/redis.ts: createClient({url})), NOT Bun.redis. Keep it that way (out of scope to change).
- tsconfig: strict=true, noUncheckedIndexedAccess=true, verbatimModuleSyntax=true, noEmit=true. Type checks via `bunx tsc --noEmit`.
- Redis stream write pattern: `redis.xAdd(STREAM, "*", { json: JSON.stringify(event) })` for JSON-encoded streams (alerts:stream, alerts:acks, reports:sync). WhatsApp streams use flat string fields (waha-webhook.ts).

## File-conflict map (avoid concurrent edits)
- analyze.ts: T3 (sync status) + T6 (latency clamp)
- config.ts: T4 (PUSH_DELIVERY_STREAM) + T5 (WA_SEND_STREAM)
- report.ts: T2 (experimentId) + T5 (sendWAAlert caller)
- types.ts: T2 (alertEvent type) + T7 (AckInput)
=> Execution order: T1 -> T2 -> T3 -> T6 -> T4 -> T5 -> T7 -> T8

## Status enum (source of truth = report.ts)
- QUEUED (below threshold), TRIGGERED (alert fired), DEDUPED (duplicate), FAILED_ML (ML error)
- Sync success numerator = TRIGGERED+QUEUED+DEDUPED (+ legacy ACCEPTED); failure = FAILED_ML

## [2026-06-18] T1: bun test harness + Redis mock
- Redis test helper path: `src/__tests__/helpers/redis-mock.ts`
- Exports: `createMockRedis()` and `parseStreamJson(entries)`
- `createMockRedis()` returns an in-memory client with recorded call arrays for `xAdd`, `get`, `set`, `del`, `hSet`, `hDel`, `hVals`, `zAdd`, `zRemRangeByScore`, `zCard`, and `publish`
- Bun test imports use `import { describe, expect, test } from "bun:test";`

## [2026-06-18] T1-fix: restore strict typecheck
- Fixed pre-existing `src/lib/experiment-utils.ts` bug by changing `parseExperimentIdFromMessage()` to `return match?.[1] ?? null`
- Restored `tsconfig.json` to its original strict project-wide config; no exclude hacks needed

## [2026-06-18] T2: alertEvent experimentId foundation
- Extracted pure function: `buildAlertEvent(params): AlertEvent` in `src/routes/report.ts`; it validates `experimentId` as string-only and serializes invalid/missing values as `null`.
- Alert event type location: exported `AlertEvent` in `src/types.ts` with top-level `experimentId: string | null` plus `MlPayload` for the canonical ML input shape.

## [2026-06-18] T3: stage6 sync analyzer guard + pure rate helper
- `scripts/stage6/analyze.ts` now exports `computeSyncSuccessRate(statusCounts)` for isolated testing.
- `run()` is guarded with `if (import.meta.main)` so importing the module in tests does not execute the CLI.
- Sync success mapping remains backward-compatible: `TRIGGERED`, `QUEUED`, `DEDUPED`, and legacy `ACCEPTED` count as success; `FAILED_ML` is failure.

## [2026-06-18] T6: clock-skew latency partitioning
- Added pure helper `partitionLatencies(values)` in `scripts/stage6/analyze.ts`.
- Negative ACK latencies are excluded from latency stats/CSV, counted as `negativeLatencyCount`, and documented as clock-skew anomalies in `scripts/ANALYSIS_FORMAT.md`.

## [2026-06-18] T4: persist Web Push results to push:delivery
- New const: `PUSH_DELIVERY_STREAM` in src/config.ts, default `push:delivery`, env-overridable via `process.env.PUSH_DELIVERY_STREAM`. F3 real-QA should XRANGE this stream.
- Refactor (production behavior unchanged): extracted pure `buildPushDeliveryRecord(alertEvent, result, totalSubscriptions): PushDeliveryRecord` in src/lib/push.ts (no Redis/web-push -> unit-testable).
- Record fields (JSON-encoded, same `{ json: JSON.stringify(record) }` pattern): `{ timestamp:Date.now(), alertId:string|null, experimentId:string|null, sent, removed, failed, totalSubscriptions }`.
- `sendPushAlertToAll(alertJson, deps={redis})` now takes injectable deps; `listPushSubscriptions(client=redis)` also injectable -> test uses createMockRedis(), no live Redis. xAdd wrapped in try/catch (warns, never throws). Writes even with 0 subscriptions. Early return at `!pushConfigured` writes NO entry (documented: push not configured = nothing to record).

## [2026-06-18] T5: structured WhatsApp send logging -> whatsapp:send
- New const: `WA_SEND_STREAM` in src/config.ts, default `whatsapp:send`, env-overridable via `process.env.WA_SEND_STREAM`. Placed right after WAHA_BROADCAST_GROUPS.
- `sendWAAlert(text, experimentId?, deps={redis,fetchFn})` now injectable: defaults redis=real redis (./redis), fetchFn=globalThis.fetch. report.ts:293-297 caller updated to `sendWAAlert(<text>, alertEvent.experimentId)`.
- Stream entry per chatId uses FLAT string fields (matches whatsapp:incoming/outgoing/acks, NOT json-wrapped): `{ timestamp:String(Date.now()), chatId, status:"SENT"|"FAILED", httpStatus:String(res.status)|"", messageId:string|"", experimentId:experimentId??"", error:string|"" }`. F3 real-QA: XRANGE whatsapp:send.
- SENT = res.ok; messageId via defensive `extractMessageId(body)` (handles {id}, {id:{id|_serialized}}, {_data:{id...}}), "" if unparseable. FAILED = non-ok (httpStatus set, error=body text) or thrown (httpStatus="", error=err.message).
- xAdd wrapped in try/catch inside per-chatId logSend -> a Redis failure logs+continues, never aborts broadcast. WAHA-not-configured early return writes NO stream entry (documented).
- Test: src/__tests__/waha-send.test.ts injects createMockRedis() + fake fetch (no live Redis/WAHA). NOTE: noUncheckedIndexedAccess makes `mock.calls.xAdd[].fields.X` typed `string|undefined` -> use `?? ""` when passing to toContain/toBe.

## [2026-06-18] T7: experimentId flows client -> alerts:acks stream
- Extracted pure exported function `buildAckEvent(input: AckInput, receivedAtServer: number): AckEvent` in `src/routes/ack.ts`. Route validates input (lines 12-33 untouched), then calls `buildAckEvent` + xAdd. Unit-tested directly in `src/__tests__/ack-event.test.ts` (no Redis needed).
- `AckInput` gained optional `experimentId?: string`; new exported `AckEvent` type uses `Omit<AckInput,"ackStage"|"experimentId">` then re-declares `ackStage: DELIVERED|OPENED|UNSPECIFIED` and `experimentId: string|null`. NOTE: a plain `AckInput & {...}` intersection does NOT override field types (TS narrows to the intersection) -> use Omit to widen/override.
- ackEvent now stores `experimentId: input.experimentId ?? null` alongside existing endToEndLatencyMs/ackKey/receivedAtServer/ackStage. Format of ackKey + latency unchanged.
- Client echo (browser JS, not covered by bun test, verified by static review):
  - receiver.js postAck: adds `experimentId: alert.experimentId ?? null` to ACK body (SSE & WS share this fn).
  - sw.js push: reads `data.alertEvent?.experimentId`, stores it in `showNotification(...).data`, sends it in DELIVERED ACK; notificationclick reads `noteData.experimentId` for OPENED ACK.
- T8 can rely on alerts:acks entries carrying experimentId (string|null) for per-experiment ACK correlation.

## [2026-06-18] T8: PWA analyzer correlation fix
- Added exported pure helper `computePwaLatency(triggers, acks, experimentId)` in `scripts/analyze-whatsapp-webhooks.ts` to correlate PWA trigger/ACK pairs by both `experimentId` and `alertId`.
- `analyzeExperiment` now uses `computePwaLatency`, and the script is wrapped with `if (import.meta.main)` so imports in tests do not execute the CLI.
- Unit coverage added in `src/__tests__/analyze-wa.test.ts` for correct experiment matching and the null no-match case.

## [2026-06-18] T8-fix: alerts:acks JSON parsing gotcha
- `alerts:acks` rows are JSON-wrapped under `fields.json`; they are not flat XRANGE fields.
- Added exported pure helpers `parseAckRow(fields)` and `collectAckRows(rows, experimentId)` in `scripts/analyze-whatsapp-webhooks.ts` so the analyzer parses `experimentId`, `alertId`, `transport`, `receivedAtClient`, `serverTimestamp`, and `ackStage` from the JSON payload before filtering.
- `experiments:triggers` and `whatsapp:incoming/outgoing` remain flat-field streams; only `alerts:acks` needs JSON parsing.

- 2026-06-18 F1 re-review: ACK analyzer now parses alerts:acks rows from fields.json via parseAckRow/collectAckRows; WhatsApp/triggers readers remain flat-field; bun test and bunx tsc --noEmit passed.

## 2026-06-18 F4 re-review
- Verified latest analyze-wa fix parses json-wrapped alerts:acks via parseAckRow/collectAckRows and preserves flat reads for whatsapp/triggers streams.
- git log/show-stat for last 9 commits shows scoped changes only; pre-existing dirty files were not included in committed changes.
- bun test and bunx tsc --noEmit passed after review.
