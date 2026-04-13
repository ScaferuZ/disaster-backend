# Comparison Experiment Scripts

This directory contains scripts for running and analyzing dual-channel comparison experiments between PWA and WhatsApp disaster alert delivery.

## Scripts

### `run-comparison.ts`

CLI wrapper for running automated comparison experiments with multiple trials.

#### Usage

```bash
# Basic usage (uses defaults: 10 trials, 2000ms interval, default text)
bun run compare:run

# Custom configuration
bun run scripts/run-comparison.ts --count=30 --interval=1000 --text="ada lumba2 menggiring perahu" --run-id=my-experiment --network-profile=4g

# Quick test with 2 trials
bun run scripts/run-comparison.ts --count=2 --interval=500
```

#### CLI Arguments

- `--count`: Number of trials to run (default: `10`)
- `--interval`: Milliseconds between trials (default: `2000`)
- `--text`: Report text to send (default: `"ada lumba2 menggiring perahu di tepi pantai"`)
- `--run-id`: Unique identifier for this run (default: auto-generated timestamp like `run-1776081883542`)
- `--network-profile`: Network profile label (default: `"unknown"`)

#### Output

Creates a directory `experiments/<run-id>/` containing:

- `manifest.json`: Complete experiment metadata including:
  - Configuration (count, interval, text, network profile)
  - Start/end timestamps
  - Trial results with experiment IDs and success status

Example manifest:
```json
{
  "runId": "test-run",
  "count": 2,
  "interval": 1000,
  "text": "test message",
  "networkProfile": "4g",
  "startedAt": "2026-04-13T12:05:15.738Z",
  "trials": [
    {
      "trialNumber": 1,
      "experimentId": "bd580bda-65cc-4f63-bcc3-aceb1e1002cc",
      "timestamp": "2026-04-13T12:05:15.739Z",
      "success": true
    }
  ],
  "endedAt": "2026-04-13T12:05:19.985Z"
}
```

#### Features

- **Progress indicator**: Shows current trial number (e.g., "Running trial 3/10...")
- **Error handling**: Continues running trials even if some fail
- **Real-time updates**: Manifest saved after each trial
- **Summary statistics**: Shows success rate and trial counts on completion
- **Exit codes**: Returns exit code 1 if any trials failed

### `compare-channels.ts`

Core dual-trigger implementation. Can be run directly for single experiments:

```bash
bun run scripts/compare-channels.ts "ada lumba2 menggiring perahu di tepi pantai"
```

This script provides the `triggerDualReport()` function used by `run-comparison.ts`.

### `analyze-comparison.ts`

Analysis script for processing experiment results (see separate documentation).

## Experiment Workflow

1. **Run experiment**: Use `run-comparison.ts` to execute multiple trials
2. **Collect data**: Each trial generates a unique `experimentId` for correlation
3. **Analyze results**: Use analysis scripts to compare PWA vs WhatsApp performance

## Example Experiment Session

```bash
# Run a 30-trial experiment on 4G network
bun run scripts/run-comparison.ts \
  --count=30 \
  --interval=1000 \
  --text="ada lumba2 menggiring perahu di tepi pantai" \
  --run-id=4g-trial-1 \
  --network-profile=4g

# Results saved to experiments/4g-trial-1/manifest.json
```

## Integration with Backend

The `triggerDualReport()` function sends requests to:
- **PWA**: `https://backend.fruz.cloud/api/report` (POST with disaster report data)
- **WhatsApp**: `https://waha.fruz.cloud/api/sendText` (POST with WAHA API)

Both requests are executed in parallel using `Promise.allSettled()` to ensure fair timing comparison.
