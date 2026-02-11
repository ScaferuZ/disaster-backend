# Implement Stage 6 Experimentation Toolkit

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `.agent/PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, the repository provides a reproducible Stage 6 experimentation toolkit: protocol-isolated delivery toggles, a load generator, stream exporters, CPU/RAM sampler, and dataset analyzers. A thesis reader can run controlled SSE-only, WS-only, and PUSH-only trials, export raw evidence, and produce summary tables for latency, delivery rate, sync success rate, and resource usage.

## Progress

- [x] (2026-02-07 14:48Z) Reviewed Stage 6 requirements and current project status in `TASKS.md`.
- [x] (2026-02-07 14:50Z) Consulted Context7 docs for `redis/node-redis` stream command usage and Bun file writing patterns.
- [x] (2026-02-07 14:52Z) Added protocol delivery gates (`ENABLE_SSE_DELIVERY`, `ENABLE_WS_DELIVERY`, `ENABLE_PUSH_DELIVERY`) and health visibility.
- [x] (2026-02-07 14:53Z) Added Stage 6 scripts for load generation, stream export, analysis, and process resource sampling under `scripts/stage6/`.
- [x] (2026-02-07 14:54Z) Added receiver harness page for automated SSE/WS ACK generation (`/receiver`).
- [x] (2026-02-07 14:54Z) Wrote Stage 6 runbook and validated script/runtime baseline (`bunx tsc --noEmit`, load/analyze smoke; export requires live Redis).
- [x] (2026-02-07 15:00Z) Added single-command iteration orchestrator (`stage6:run`) to chain reset, sampling, load, export, analyze, and final reset.

## Surprises & Discoveries

- Observation: Controlled protocol trials were hard to run with confidence because fan-out always sent to all transports.
  Evidence: `src/index.ts` previously broadcast to SSE, WS, and PUSH unconditionally.

- Observation: Existing Stage 5 app already covered report sync behavior, so Stage 6 only needed automation and data collection tooling instead of additional backend schema changes.
  Evidence: `reports:sync` stream and `clientReportId` dedupe already exist in `src/routes/report.ts`.

## Decision Log

- Decision: Add protocol gating via environment flags instead of creating separate binaries or branches.
  Rationale: Enables controlled trials with one codebase and low operational overhead (`ENABLE_*_DELIVERY=true/false`).
  Date/Author: 2026-02-07 / Codex

- Decision: Use Redis stream export + offline analyzer scripts for datasets.
  Rationale: Keeps raw evidence immutable and supports repeated analysis without rerunning trials.
  Date/Author: 2026-02-07 / Codex

- Decision: Add browser receiver harness (`/receiver`) for SSE/WS ACK automation.
  Rationale: Reduces manual console setup and improves repeatability of latency measurements.
  Date/Author: 2026-02-07 / Codex

- Decision: Add `stage6:run` orchestration script in addition to atomic scripts.
  Rationale: Users requested one-command execution per iteration label to reduce operator error and speed repeated trials.
  Date/Author: 2026-02-07 / Codex

## Outcomes & Retrospective

Stage 6 implementation scaffolding is complete: controlled protocol gating, receiver harness, and experiment scripts are in place with a documented runbook. Type-check and no-server smoke tests pass. The only remaining work is executing real trial batches with a live backend+Redis and collecting actual datasets for Chapter IV.

## Context and Orientation

Stage 6 requires controlled experimentation rather than new delivery features. Relevant modules now span three areas:

- Delivery control in backend runtime: `src/config.ts`, `src/index.ts`, `src/routes/health.ts`.
- Browser harness pages:
  - `public/index.html` + `public/app.js` for report generation/sync testing.
  - `public/receiver.html` + `public/receiver.js` for SSE/WS ACK collection.
- Experiment automation scripts:
  - `scripts/stage6/run-report-load.ts`
  - `scripts/stage6/export-streams.ts`
  - `scripts/stage6/analyze.ts`
  - `scripts/stage6/sample-resources.ts`

## Plan of Work

First make transport delivery configurable so each protocol can be tested in isolation with a single command-line environment setup. Then add scripts to generate load, export raw Redis streams, and compute analysis artifacts. Add process sampling for CPU/RAM and a dedicated receiver harness page for automatic ACK posting in SSE/WS trials. Document one canonical experiment loop in `docs/stage-6.md`.

## Concrete Steps

Run from repository root (`/Users/scaf/code/disaster-backend`).

1. Add protocol env gates and health metadata in backend.
2. Add Stage 6 scripts and package script aliases.
3. Add receiver harness static files and route mounts.
4. Write runbook (`docs/stage-6.md`).
5. Validate:

   bunx tsc --noEmit
   bun run stage6:load -- --count=2 --interval-ms=10
   bun run stage6:export -- --out-dir=experiments/stage6/smoke/raw
   bun run stage6:analyze -- --raw-dir=experiments/stage6/smoke/raw --out-dir=experiments/stage6/smoke/analysis

## Validation and Acceptance

Acceptance for toolkit completion:

- Server can run in isolated protocol mode via env flags.
- Browser receiver harness can produce SSE/WS ACKs without manual scripting.
- Load generator can submit repeatable reports to `/api/report`.
- Exporter can dump `alerts:stream`, `alerts:acks`, and `reports:sync` to NDJSON.
- Analyzer can output summary JSON and CSV files for protocol metrics.
- Resource sampler can produce CSV time-series of CPU/RAM for a given process PID.

## Idempotence and Recovery

Scripts are additive and can be rerun safely with different output directories. Export and analysis operations do not mutate Redis data. If a run is invalid, delete that run directory under `experiments/` and rerun. Protocol flags only affect runtime fan-out and can be reset by restarting with defaults.

## Artifacts and Notes

Validation transcript:

   bunx tsc --noEmit
   (exit code 0)

   bun run stage6:load -- --count=1 --interval-ms=1 --base-url=http://localhost:3000 --output=/tmp/stage6-load-smoke.ndjson
   [stage6] load complete success=0 failed=1 output=/tmp/stage6-load-smoke.ndjson
   (expected in smoke mode because no server was running on localhost:3000)

   bun run stage6:analyze -- --raw-dir=/tmp/stage6-smoke/raw --out-dir=/tmp/stage6-smoke/analysis --protocol=SSE --network=3G
   [stage6] analysis written to /tmp/stage6-smoke/analysis

   bun run stage6:export -- --out-dir=/tmp/stage6-export-smoke/raw
   failed to connect redis at redis://localhost:6379: AggregateError
   (expected because Redis was not running in this shell context)

## Interfaces and Dependencies

- Context7 references used:
  - `/redis/node-redis` for command/modifier behavior and stream command guidance.
  - `/oven-sh/bun` for `Bun.write` and script file I/O patterns.
- New environment flags:
  - `ENABLE_SSE_DELIVERY`
  - `ENABLE_WS_DELIVERY`
  - `ENABLE_PUSH_DELIVERY`
- New script entrypoints in `package.json`:
  - `stage6:load`
  - `stage6:export`
  - `stage6:analyze`
  - `stage6:sample:resources`

Revision note (2026-02-07): Updated progress/outcomes with completed implementation and actual validation evidence, including external runtime prerequisites.
