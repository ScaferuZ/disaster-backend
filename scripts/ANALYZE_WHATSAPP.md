# analyze-whatsapp-webhooks.ts

Analyzes WhatsApp webhook experiment results by comparing PWA and WhatsApp channel latencies.

## Usage

```bash
bun run analyze:whatsapp -- --run-id=<run-id>
```

### Example

```bash
bun run analyze:whatsapp -- --run-id=run-1776081883542
```

## What It Does

1. **Loads experiment manifest** from `experiments/<run-id>/manifest.json`
2. **Reads Redis streams** for each experimentId:
   - `whatsapp:incoming` - incoming WhatsApp messages
   - `whatsapp:outgoing` - outgoing WhatsApp messages
   - `experiments:triggers` - PWA trigger events
   - `alerts:acks` - PWA acknowledgment events
3. **Calculates latencies**:
   - WhatsApp: `outgoing.timestamp - incoming.timestamp`
   - PWA: `receivedAtClient - triggeredAt`
4. **Outputs comparison table** with columns:
   - Experiment ID
   - PWA Latency (ms)
   - WhatsApp Latency (ms)
   - Winner (PWA/WhatsApp/tie/N/A)
5. **Generates summary statistics**:
   - Count, mean, median, p95, p99, min, max for both channels
   - Determines overall winner based on mean latency
6. **Saves analysis** to `experiments/<run-id>/analysis.json`

## Output

### Console Output

```
╔═══════════════════════════════════════════════════════════════════════════════╗
║                    WhatsApp Webhook Experiment Results                       ║
╚═══════════════════════════════════════════════════════════════════════════════╝

┌──────────────────────┬─────────────────────┬─────────────────────┬──────────┐
│ Experiment ID        │ PWA Latency (ms)    │ WhatsApp Latency    │ Winner   │
├──────────────────────┼─────────────────────┼─────────────────────┼──────────┤
│ b779e939-4169-4da8  │ 123.45              │ 234.56              │ PWA      │
│ 877dbd88-968f-4451  │ N/A                 │ 345.67              │ WhatsApp │
└──────────────────────┴─────────────────────┴─────────────────────┴──────────┘

╔═══════════════════════════════════════════════════════════════════════════════╗
║                               Summary Statistics                            ║
╚═══════════════════════════════════════════════════════════════════════════════╝

┌────────────────┬─────────────────────┬─────────────────────┬─────────────────────┐
│ Metric         │ PWA                 │ WhatsApp            │ Winner              │
├────────────────┼─────────────────────┼─────────────────────┼─────────────────────┤
│ Count          │ 8.00                │ 9.00                │                     │
│ Mean (ms)      │ 145.67              │ 267.89              │ PWA                 │
│ Median (ms)    │ 142.30              │ 265.40              │                     │
│ P95 (ms)       │ 189.50              │ 312.80              │                     │
│ P99 (ms)       │ 201.20              │ 345.90              │                     │
│ Min (ms)       │ 98.20               │ 201.50              │                     │
│ Max (ms)       │ 234.56              │ 345.67              │                     │
└────────────────┴─────────────────────┴─────────────────────┴─────────────────────┘

Overall Winner: PWA
```

### JSON Output

The script generates `experiments/<run-id>/analysis.json` with detailed results:

```json
{
  "runId": "run-1776081883542",
  "manifest": { ... },
  "experiments": [
    {
      "experimentId": "b779e939-4169-4da8-994d-b00ea32865e1",
      "trialNumber": 1,
      "pwaLatencyMs": 123.45,
      "whatsappLatencyMs": 234.56,
      "winner": "PWA"
    }
  ],
  "summary": {
    "pwa": { "count": 8, "mean": 145.67, "median": 142.30, "p95": 189.50, "p99": 201.20, "min": 98.20, "max": 234.56 },
    "whatsapp": { "count": 9, "mean": 267.89, "median": 265.40, "p95": 312.80, "p99": 345.90, "min": 201.50, "max": 345.67 },
    "winner": "PWA"
  },
  "generatedAt": "2026-04-13T19:50:00.000Z"
}
```

## Requirements

- Redis server running (default: `redis://localhost:6379`)
- Experiment run directory with `manifest.json`
- Redis streams populated with experiment data

## Data Sources

### WhatsApp Streams
- **whatsapp:incoming**: Logged by `/api/waha/webhook` when `message.received` event occurs
- **whatsapp:outgoing**: Logged by `/api/waha/webhook` when `message.sent` event occurs

### PWA Streams
- **experiments:triggers**: Contains trigger events with `experimentId` field
- **alerts:acks**: Contains acknowledgment events with `experimentId` field

## Graceful Handling

The script handles missing data gracefully:
- Shows "N/A" for missing latencies
- Calculates statistics only on available data
- Shows "N/A" as winner when both channels have no data
- Shows "tie" when mean latencies are equal
