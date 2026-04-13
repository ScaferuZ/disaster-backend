# Experiment Analysis Output Format

## Overview

The `analyze-comparison.ts` script analyzes experiment results by reading from:
1. `experiments/<run-id>/manifest.json` - Experiment configuration
2. Redis stream `experiments:triggers` - Trigger events filtered by runId
3. Redis stream `alerts:acks` - ACK events filtered by experimentId correlation

## Usage

```bash
bun run analyze:comparison --run-id=<experiment-id>
```

Optional arguments:
- `--redis-url=<url>` - Redis connection URL (default: from REDIS_URL env var or redis://localhost:6379)

## Output Files

### 1. `experiments/<run-id>/analysis.json`

JSON output with full metrics:

```json
{
  "runId": "experiment-id",
  "manifest": {
    "runId": "experiment-id",
    "startedAt": "2026-04-13T12:00:00.000Z",
    "completedAt": "2026-04-13T12:05:00.000Z",
    "config": {
      "protocol": "SSE",
      "network": "NORMAL",
      "count": 50,
      "intervalMs": 1000
    }
  },
  "channels": {
    "pwa": {
      "channel": "PWA",
      "totalTriggers": 50,
      "totalAcks": 48,
      "deliveryRate": 0.96,
      "latencyMs": {
        "count": 48,
        "mean": 145.32,
        "median": 142,
        "p95": 198,
        "p99": 245,
        "min": 89,
        "max": 267
      },
      "missingAcks": 2,
      "failedTriggers": 0,
      "outliers": [267]
    },
    "whatsapp": {
      "channel": "WhatsApp",
      "totalTriggers": 50,
      "totalAcks": 47,
      "deliveryRate": 0.94,
      "latencyMs": {
        "count": 47,
        "mean": 1234.56,
        "median": 1198,
        "p95": 1567,
        "p99": 1823,
        "min": 892,
        "max": 2012
      },
      "missingAcks": 3,
      "failedTriggers": 0,
      "outliers": [2012, 1956]
    }
  },
  "comparison": {
    "latencyDiffMs": 1089.24,
    "deliveryRateDiffPercent": -2.0,
    "winner": "PWA"
  },
  "generatedAt": "2026-04-13T12:06:00.000Z"
}
```

### 2. Console Output

Human-readable table format:

```
================================================================================
EXPERIMENT ANALYSIS: sse_normal_r1
================================================================================

Configuration:
  Protocol:   SSE
  Network:    NORMAL
  Count:      50
  Interval:   1000ms

Channel Comparison:

┌─────────────────────────┬──────────────────────┬──────────────────────┐
│ Metric                  │ PWA                   │ WhatsApp              │
├─────────────────────────┼──────────────────────┼──────────────────────┤
│ Total Triggers          │ 50                    │ 50                    │
│ Total ACKs              │ 48                    │ 47                    │
│ Delivery Rate           │ 96.00%                │ 94.00%                │
├─────────────────────────┼──────────────────────┼──────────────────────┤
│ Mean Latency            │ 145ms                 │ 1234ms                │
│ Median Latency          │ 142ms                 │ 1198ms                │
│ P95 Latency             │ 198ms                 │ 1567ms                │
│ P99 Latency             │ 245ms                 │ 1823ms                │
│ Min/Max Latency         │ 89/267ms              │ 892/2012ms            │
├─────────────────────────┼──────────────────────┼──────────────────────┤
│ Missing ACKs            │ 2                     │ 3                     │
│ Failed Triggers         │ 0                     │ 0                     │
│ Outliers Detected       │ 1                     │ 2                     │
└─────────────────────────┴──────────────────────┴──────────────────────┘

Comparison Summary:

  Latency Difference:      +1089.24ms (WhatsApp slower)
  Delivery Rate Diff:      -2.00% (PWA better)
  Winner:                  PWA

================================================================================
```

## Metrics Explained

### Latency Metrics
- **Mean**: Average end-to-end latency (receivedAtClient - triggeredAt)
- **Median**: 50th percentile latency
- **P95**: 95th percentile latency
- **P99**: 99th percentile latency
- **Min/Max**: Minimum and maximum observed latencies

### Delivery Metrics
- **Total Triggers**: Number of alert triggers sent to this channel
- **Total ACKs**: Number of ACK events received
- **Delivery Rate**: (unique ACKs / unique triggers) * 100
- **Missing ACKs**: Number of triggers without corresponding ACKs
- **Failed Triggers**: Number of triggers marked as failed

### Outlier Detection
Outliers are detected using the IQR (Interquartile Range) method:
- Values below Q1 - 1.5×IQR or above Q3 + 1.5×IQR are flagged
- Additionally, values >3 standard deviations from mean are tracked

## Edge Cases Handled

1. **Missing ACKs**: Triggers without corresponding ACKs are counted but excluded from latency calculations
2. **Failed Triggers**: Triggers with `status: "failed"` or `error` field are tracked separately
3. **Empty Data**: Returns zero metrics if no data available
4. **Invalid Timestamps**: NaN timestamps are excluded from calculations
5. **Stream Pagination**: Handles Redis streams with >500 entries using batched XRANGE

## Integration with Paper Results

The JSON output is suitable for:
- Automated aggregation across multiple runs
- Statistical analysis in Python/R
- Generating publication-ready tables
- Plotting latency distributions

The console table format is ideal for:
- Quick experiment verification
- Presentation in paper figures
- Debugging experimental issues
