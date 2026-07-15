# Count distinct report submissions for active warnings

This ExecPlan is a living document maintained according to `.agent/PLANS.md`.

## Purpose / Big Picture

An active warning must report how many distinct report submissions supported its trigger. A submission containing four LIK codes must contribute one to `reportCount`, while each code still has its own value in `reportCounts`. Repeated copies of the same code inside one submission must not inflate the threshold or evidence count.

## Progress

- [x] (2026-07-15 16:25Z) Identified that `reportCount` currently sums per-code counts and inflates multi-code submissions.
- [x] (2026-07-15 16:30Z) Reused one evidence identifier across all code queues for a single submission and deduplicated codes case-insensitively within the submission.
- [x] (2026-07-15 16:32Z) Calculated the union of evidence identifiers for triggered codes and persisted its size as `reportCount`.
- [x] (2026-07-15 16:35Z) Added focused regression tests; 72 full-suite tests pass and the Bun production build succeeds.
- [x] (2026-07-15 16:45Z) Launched three Opus 4.8 review attempts; all were rejected by the provider with HTTP 429 account limits before producing findings. Completed a parent review, added partial-overlap coverage, and prepared only feature-related files for commit.

## Surprises & Discoveries

- Observation: `processReport` previously created a separate random Redis sorted-set member for each code, so the backend could not distinguish five multi-code submissions from twenty separate pieces of per-code evidence.
  Evidence: Before this change, `src/lib/crowdsource.ts` called `crypto.randomUUID()` inside the code loop.

- Observation: Cooldown keys were case-sensitive even though queue keys were lowercase, allowing casing differences to bypass cooldown lookup and making `/api/reports/active` report incorrect trigger state.
  Evidence: The queue used `code.toLowerCase()` while the cooldown used the original code and the active route looked up an uppercase variant. Both now use the lowercase queue suffix.

## Decision Log

- Decision: Define `reportCount` as the number of distinct submissions involved in the latest trigger, not a unique-person count.
  Rationale: A reliable unique-person count requires identity propagation across PWA and WhatsApp, which is outside this request. One shared random evidence identifier per accepted submission gives exact submission cardinality without storing personal data.
  Date/Author: 2026-07-15 / Pi

- Decision: Keep `reportCounts` as per-code counts and deduplicate repeated codes case-insensitively within one request.
  Rationale: Per-code evidence remains useful, while duplicate array entries must not let one request advance the same threshold multiple times.
  Date/Author: 2026-07-15 / Pi

## Outcomes & Retrospective

Implementation and validation are complete. Five four-code submissions now persist `reportCount: 5`, partial overlap uses exact set-union cardinality, and duplicate code variants count once per submission. The full suite passes 73 tests and the production build succeeds. Opus 4.8 was spawned three times as requested, but the provider rejected every attempt with HTTP 429 before returning review findings; a parent review found and fixed cooldown-key casing and added partial-overlap regression coverage.

## Context and Orientation

`src/lib/crowdsource.ts` adds report evidence to Redis sorted sets named `reports:queue:<beach>:<code>`. Each sorted-set member represents one submission and its score is the server timestamp. `src/routes/report.ts` calls this function, triggers ML when the threshold is reached, and stores an active warning in `warnings:active:<beach>`. The active warning currently derives `reportCount` by summing `reportCounts`, which double-counts a submission that contains multiple codes.

The Redis Node.js client supports reading sorted-set members by score. The implementation will give every invocation of `processReport` one random evidence identifier and insert that same identifier into every unique code queue. When one or more codes trigger, it will read the in-window members of those triggered queues, take their set union, and return the union size.

## Plan of Work

Update `processReport` in `src/lib/crowdsource.ts` to normalize duplicate LIK codes case-insensitively, create one evidence identifier before the loop, and reuse it across code queues. After determining all triggered codes, read their current in-window members and calculate an exact distinct submission count. Change `setActiveWarning` to accept explicit evidence containing both the distinct total and per-code counts instead of calculating a sum.

Update `src/routes/report.ts` to persist the explicit count. Add Redis mock support for sorted-set range reads in `src/__tests__/helpers/redis-mock.ts`, then add a focused tracked regression test proving that five four-code submissions produce `reportCount: 5`, and that duplicate entries for one code only count once per submission. Update API documentation wording if necessary.

## Concrete Steps

From `/Users/scaf/code/disaster-backend`, edit the files above and run:

    bun test src/__tests__/distinct-report-count.test.ts
    bun test
    bun build src/index.ts --target=bun --outdir /tmp/disaster-backend-build
    git diff --check

The focused test must pass with no failures. The full suite must pass. The build must produce `/tmp/disaster-backend-build/index.js`.

## Validation and Acceptance

Submit five reports for one beach where every report contains four different LIK codes. On the fifth report, the active warning must contain `reportCount: 5`; `reportCounts` may contain a value of five for each triggering code. Submit a request containing the same code multiple times and verify that request advances the code count by only one. Existing active warnings without evidence fields must remain readable.

## Idempotence and Recovery

The code change requires no Redis migration. Existing sorted-set members use unrelated random identifiers per code, so warnings triggered from a queue containing pre-deployment evidence may overcount until that ten-minute queue expires or is cleared. Clearing the selected beach through the PWA before validation gives a clean test. Reverting the feature commit restores the previous behavior without changing stored alert or experiment streams.

## Artifacts and Notes

Expected active-warning evidence after five multi-code submissions:

    {
      "reportCount": 5,
      "reportCounts": {
        "WN-1": 5,
        "WN-2": 5,
        "WN-3": 5,
        "WN-4": 5
      }
    }

## Interfaces and Dependencies

`processReport` will continue returning `triggeredCodes` and `codeCounts` and will add `reportCount: number`. `setActiveWarning` will accept an optional evidence object shaped as `{ reportCount: number; reportCounts: Record<string, number> }`. It will continue accepting no evidence so existing callers and old Redis records remain compatible. The implementation uses the existing `redis` v5 client and its `zRangeByScore` operation; no new dependency is required.

Revision note: Initial plan created to replace summed per-code evidence with exact distinct-submission evidence and to define the required Opus review and commit gate.

Revision note (2026-07-15 16:36Z): Updated progress and discoveries after implementation, tests, build validation, and the first rate-limited Opus review attempt.

Revision note (2026-07-15 16:45Z): Recorded final validation, three provider-rejected Opus review launches, parent-review fixes, and completion status before commit.
