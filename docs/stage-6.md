# Stage 6 - Experimentation Toolkit

## Goal
Run controlled protocol experiments (SSE-only, WS-only, PUSH-only) under unstable network conditions and produce reproducible datasets for latency, delivery rate, sync success rate, and CPU/RAM.

## What Was Added

### 1) Protocol Isolation Flags
Server fan-out now supports runtime protocol gating via env vars:
- `ENABLE_SSE_DELIVERY` (default `true`)
- `ENABLE_WS_DELIVERY` (default `true`)
- `ENABLE_PUSH_DELIVERY` (default `true`)

Health endpoint now reports active delivery toggles at `GET /api/health` -> `delivery`.

### 2) Receiver Harness (`/receiver`)
A browser page for SSE/WS experiments with one-click connections and automatic ACK posting:
- `public/receiver.html`
- `public/receiver.js`

Use this page during SSE/WS runs so ACK data is consistently captured.

### 3) Stage 6 Scripts
- `bun run stage6:run`
  - full single-iteration orchestrator: reset(before) -> resource sampling -> load -> export -> wait sampler -> analyze -> reset(after).
- `bun run stage6:load`
  - sends repeatable report traffic to `/api/report` with `clientReportId` + `createdAtClient`.
- `bun run stage6:export`
  - exports Redis streams (`alerts:stream`, `alerts:acks`, `reports:sync`) to NDJSON.
- `bun run stage6:analyze`
  - computes summary JSON and CSV outputs from exported NDJSON.
- `bun run stage6:sample:resources`
  - samples backend process CPU/RAM into CSV by PID.

## Canonical Trial Workflow

### One-command Iteration (Recommended)
```sh
bun run stage6:run -- --label=sse_3g_r1
```

Optional overrides:
```sh
bun run stage6:run -- \
  --label=ws_normal_r2 \
  --pid=<BACKEND_PID> \
  --duration-s=180 \
  --count=50 \
  --interval-ms=1000 \
  --base-url=http://localhost:3000
```

Notes:
- `--label` is required if you do not want interactive prompt.
- `protocol` and `network` are inferred from label (`sse_3g_r1` -> `SSE`, `3G`).
- Add `--skip-final-reset` if you want data to remain in Redis after run completion.

### 0) Choose run labels
Example:
- protocol: `SSE`
- network: `3G`
- run id: `sse_3g_r1`

Output base directory:
`experiments/stage6/sse_3g_r1`

Reset data before each run:
```sh
bun run stage6:reset
```

### 1) Start backend with protocol gating

#### SSE-only
```sh
ENABLE_SSE_DELIVERY=true ENABLE_WS_DELIVERY=false ENABLE_PUSH_DELIVERY=false bun run dev
```

#### WS-only
```sh
ENABLE_SSE_DELIVERY=false ENABLE_WS_DELIVERY=true ENABLE_PUSH_DELIVERY=false bun run dev
```

#### PUSH-only
```sh
ENABLE_SSE_DELIVERY=false ENABLE_WS_DELIVERY=false ENABLE_PUSH_DELIVERY=true bun run dev
```

Verify mode:
```sh
curl -s http://localhost:3000/api/health | jq .delivery
```

### 2) Prepare browser clients

#### SSE/WS runs
- Open `http://localhost:3000/receiver`
- Click `Connect SSE + ACK` for SSE runs or `Connect WS + ACK` for WS runs

#### PUSH runs
- Open `http://localhost:3000`
- Click `Enable Push`
- Ensure subscription exists:
```sh
docker exec -i thesis-redis redis-cli HLEN alerts:push:subscriptions
```

### 3) Apply network profile
Use browser/network tooling to emulate `2G`, `3G`, or high latency before load starts.

### 4) Start CPU/RAM sampling
Find backend PID in another terminal:
```sh
pgrep -f "bun run --hot src/index.ts"
```

Start sampler:
```sh
bun run stage6:sample:resources -- \
  --pid=<PID> \
  --interval-ms=2000 \
  --duration-s=180 \
  --output=experiments/stage6/<run-id>/raw/resources.csv
```

### 5) Generate report load
```sh
bun run stage6:load -- \
  --count=50 \
  --interval-ms=1000 \
  --output=experiments/stage6/<run-id>/load.ndjson
```

### 6) Export raw streams
```sh
bun run stage6:export -- \
  --out-dir=experiments/stage6/<run-id>/raw
```

### 7) Analyze run
```sh
bun run stage6:analyze -- \
  --raw-dir=experiments/stage6/<run-id>/raw \
  --out-dir=experiments/stage6/<run-id>/analysis \
  --protocol=<SSE|WS|PUSH> \
  --network=<2G|3G|HIGH_LATENCY>
```

Outputs:
- `summary.json`
- `protocol-summary.csv`
- `latency.csv`

## Metric Definitions
- End-to-end latency: `endToEndLatencyMs` from ACK events.
- Delivery rate per protocol: unique delivered `alertId` ACKs / total alerts in `alerts:stream`.
- Sync success rate: `(ACCEPTED + DEDUPED) / (ACCEPTED + DEDUPED + FAILED_ML)` from `reports:sync`.
- CPU/RAM: summary statistics from `resources.csv`.

## Recommended Minimum Sample Size
- At least 30-50 alerts per condition.
- Repeat each condition 3 times (r1, r2, r3) before final aggregation.

## Notes
- Keep only one protocol enabled in backend per controlled run.
- For PUSH trials, browser support/network access to push service must be healthy.
- `experiments/` is git-ignored for large generated artifacts.
