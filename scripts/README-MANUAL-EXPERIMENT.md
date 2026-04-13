# WhatsApp Manual Experiment Runner

Interactive script for testing WhatsApp message experiments with sequential experiment IDs and PWA triggering.

## Usage

```bash
# Run with defaults (5 trials, message="message")
bun run scripts/run-manual-experiment.ts

# Custom number of trials
bun run scripts/run-manual-experiment.ts --count 10

# Custom message text
bun run scripts/run-manual-experiment.ts --text "test banjir"

# Combine options
bun run scripts/run-manual-experiment.ts --count 20 --text "experiment message"
```

## CLI Arguments

- `--count <n>`: Number of trials to run (default: 5)
- `--text <msg>`: Message text to use in WhatsApp messages (default: "message")
- `--help, -h`: Show help message

## Workflow

For each trial, the script:

1. **Generates experiment ID**: EXP-001, EXP-002, etc.
2. **Formats WhatsApp message**: `!lapor {text} [{experimentId}]`
3. **Displays formatted message** in a bordered box
4. **Countdown 3...2...1...** for timing
5. **Triggers PWA** via POST /api/report with:
   - `_experimentId`: The experiment ID
   - `_channel`: "PWA"
   - `lik_codes`: ["Wn-5"]
   - `beach_location`: "pantai_lampuuk"
6. **Shows response**: Report ID, Alert ID, or error details
7. **Waits 3 seconds** for webhook processing
8. **Saves trial data** to `experiments/manual-<timestamp>/trials.ndjson`
9. **Moves to next trial**

## Output Data

Trial data is saved in NDJSON format (one JSON object per line):

```json
{
  "experimentId": "EXP-001",
  "index": 1,
  "pwaTriggeredAt": 1776084645555,
  "messageText": "!lapor test [EXP-001]",
  "pwaReportId": "uuid-here",
  "pwaAlertId": "uuid-here",
  "pwaSuccess": true,
  "pwaStatus": 200
}
```

## Environment Variables

- `BASE_URL`: Backend URL (default: `http://localhost:3000`)

## Example Session

```bash
$ bun run scripts/run-manual-experiment.ts --count 3 --text "flood test"

╔══════════════════════════════════════════╗
║  WhatsApp Manual Experiment Runner  ║
╚══════════════════════════════════════════╝

Configuration:
  Trials:      3
  Message:     "flood test"
  Base URL:   http://localhost:3000
  Output:     experiments/manual-2026-04-13T12-50-42-518Z/trials.ndjson

═══════════════════════════════════════════════════════════
  Trial 1/3 - EXP-001
═══════════════════════════════════════════════════════════

┌─────────────────────────────┐
│ Send this WhatsApp message: │
├─────────────────────────────┤
│ !lapor flood test [EXP-001] │
└─────────────────────────────┘

1. Copy the message above
2. Paste it in WhatsApp
3. Send to your test group

Triggering PWA in 3...
Triggering PWA in 2...
Triggering PWA in 1...
Triggering PWA now!

Calling POST /api/report...
✓ PWA report successful!
  Report ID:  uuid-123
  Alert ID:   uuid-456

Waiting for webhooks to process...
3...2...1...
✓ Webhook wait complete
```

## Integration with Experiment Utils

The script uses utilities from `src/lib/experiment-utils.ts`:

- `formatWhatsAppMessage(text, experimentId)`: Formats the message with experiment tag
- `generateExperimentId(index)`: Generates EXP-001, EXP-002, etc.
- `ExperimentTrial`: TypeScript interface for trial data

## Color Output

The script uses ANSI colors for clear visual feedback:
- 🟢 Green: Success
- 🔴 Red: Errors
- 🔵 Blue: Trial headers
- 🟡 Yellow: Countdowns and warnings
- 🟣 Magenta: Title banners
- ⚪ Cyan: Info and progress
