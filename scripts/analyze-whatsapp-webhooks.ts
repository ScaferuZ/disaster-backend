#!/usr/bin/env bun
import { createClient } from "redis";
import { mkdir } from "node:fs/promises";

// Types
interface Trial {
  trialNumber: number;
  experimentId: string;
  timestamp: string;
  success: boolean;
}

interface Manifest {
  runId: string;
  count: number;
  interval: number;
  text: string;
  networkProfile: string;
  startedAt: string;
  trials: Trial[];
  endedAt?: string;
}

interface WhatsAppIncoming {
  timestamp: string;
  from: string;
  text: string;
  experimentId?: string;
}

interface WhatsAppOutgoing {
  timestamp: string;
  to: string;
  text: string;
  experimentId?: string;
}

interface TriggerEvent {
  runId: string;
  alertId: string;
  channel: "PWA" | "WhatsApp";
  triggeredAt: string;
  experimentId?: string;
  metadata?: Record<string, unknown>;
}

interface AckEvent {
  alertId: string;
  experimentId?: string;
  channel: "PWA" | "WhatsApp";
  receivedAtClient: string;
  serverTimestamp: string;
  ackStage?: string;
}

interface ExperimentResult {
  experimentId: string;
  trialNumber: number;
  pwaLatencyMs: number | null;
  whatsappLatencyMs: number | null;
  winner: "PWA" | "WhatsApp" | "tie" | "N/A";
}

interface Metrics {
  count: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
}

interface Summary {
  pwa: Metrics;
  whatsapp: Metrics;
  winner: "PWA" | "WhatsApp" | "tie";
}

interface AnalysisOutput {
  runId: string;
  manifest: Manifest;
  experiments: ExperimentResult[];
  summary: Summary;
  generatedAt: string;
}

// CLI utilities
function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  const normalizedIndex = Math.max(0, Math.min(sorted.length - 1, index));
  return sorted[normalizedIndex] ?? 0;
}

function calculateMetrics(values: number[]): Metrics {
  if (values.length === 0) {
    return { count: 0, mean: 0, median: 0, p95: 0, p99: 0, min: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, value) => acc + value, 0);
  const mean = sum / values.length;

  return {
    count: values.length,
    mean: Number(mean.toFixed(2)),
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

// Data reading functions
async function readManifest(runId: string): Promise<Manifest | null> {
  const path = `experiments/${runId}/manifest.json`;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    console.error(`Manifest not found: ${path}`);
    return null;
  }
  try {
    return await file.json();
  } catch (error) {
    console.error(`Failed to parse manifest: ${error}`);
    return null;
  }
}

async function readWhatsAppStream(
  client: ReturnType<typeof createClient>,
  streamKey: "whatsapp:incoming" | "whatsapp:outgoing",
  experimentId: string,
): Promise<WhatsAppIncoming[] | WhatsAppOutgoing[]> {
  const entries: unknown[] = [];
  let start = "-";

  while (true) {
    const reply = await client.sendCommand([
      "XRANGE",
      streamKey,
      start,
      "+",
      "COUNT",
      "100",
    ]);

    const rows = Array.isArray(reply) ? reply : [];
    if (rows.length === 0) break;

    for (const item of rows) {
      const id = String(item[0]);
      const fields = item[1] as Record<string, string>;

      // Check if this entry belongs to our experiment
      if (fields.experimentId === experimentId) {
        entries.push({
          timestamp: fields.timestamp,
          from: fields.from,
          to: fields.to,
          text: fields.text,
          experimentId: fields.experimentId,
        });
      }

      start = id;
    }

    // If we got less than 100, we've reached the end
    if (rows.length < 100) break;
  }

  return entries as WhatsAppIncoming[] | WhatsAppOutgoing[];
}

async function readTriggersFromRedis(
  client: ReturnType<typeof createClient>,
  experimentId: string,
): Promise<TriggerEvent[]> {
  const triggers: TriggerEvent[] = [];
  let start = "-";

  while (true) {
    const reply = await client.sendCommand([
      "XRANGE",
      "experiments:triggers",
      start,
      "+",
      "COUNT",
      "100",
    ]);

    const rows = Array.isArray(reply) ? reply : [];
    if (rows.length === 0) break;

    for (const item of rows) {
      const id = String(item[0]);
      const fields = item[1] as Record<string, string>;

      if (fields.experimentId === experimentId) {
        triggers.push({
          runId: fields.runId ?? experimentId,
          alertId: fields.alertId ?? "",
          channel: fields.channel === "WhatsApp" ? "WhatsApp" : "PWA",
          triggeredAt: fields.triggeredAt ?? "",
          experimentId: fields.experimentId,
          metadata: fields.metadata ? JSON.parse(fields.metadata) : undefined,
        });
      }

      start = id;
    }

    if (rows.length < 100) break;
  }

  return triggers;
}

async function readAcksFromRedis(
  client: ReturnType<typeof createClient>,
  experimentId: string,
): Promise<AckEvent[]> {
  const acks: AckEvent[] = [];
  let start = "-";

  while (true) {
    const reply = await client.sendCommand([
      "XRANGE",
      "alerts:acks",
      start,
      "+",
      "COUNT",
      "100",
    ]);

    const rows = Array.isArray(reply) ? reply : [];
    if (rows.length === 0) break;

    for (const item of rows) {
      const id = String(item[0]);
      const fields = item[1] as Record<string, string>;

      if (fields.experimentId === experimentId) {
        acks.push({
          alertId: fields.alertId ?? "",
          experimentId: fields.experimentId ?? experimentId,
          channel: fields.transport === "WhatsApp" ? "WhatsApp" : "PWA",
          receivedAtClient: fields.receivedAtClient ?? "",
          serverTimestamp: fields.serverTimestamp ?? "",
          ackStage: fields.ackStage ?? "",
        });
      }

      start = id;
    }

    if (rows.length < 100) break;
  }

  return acks;
}

export function computePwaLatency(
  triggers: TriggerEvent[],
  acks: AckEvent[],
  experimentId: string,
): number | null {
  const pwaTrigger = triggers.find(
    (trigger) => trigger.channel === "PWA" && trigger.experimentId === experimentId,
  );

  if (!pwaTrigger) return null;

  const pwaAck = acks.find(
    (ack) =>
      ack.channel === "PWA" &&
      ack.experimentId === experimentId &&
      ack.alertId === pwaTrigger.alertId,
  );

  if (!pwaAck) return null;

  const triggeredAt = toNumber(pwaTrigger.triggeredAt);
  const receivedAt = toNumber(pwaAck.receivedAtClient);

  if (triggeredAt === null || receivedAt === null) return null;

  return receivedAt - triggeredAt;
}

// Analysis functions
async function analyzeExperiment(
  client: ReturnType<typeof createClient>,
  experimentId: string,
  trialNumber: number,
): Promise<ExperimentResult> {
  console.log(`Analyzing experiment ${experimentId}...`);

  // Read WhatsApp streams
  const incoming = await readWhatsAppStream(client, "whatsapp:incoming", experimentId);
  const outgoing = await readWhatsAppStream(client, "whatsapp:outgoing", experimentId);

  // Match incoming/outgoing pairs
  let whatsappLatencyMs: number | null = null;
  if (incoming.length > 0 && outgoing.length > 0) {
    const firstIncoming = incoming[0];
    const firstOutgoing = outgoing[0];
    const incomingTs = toNumber(firstIncoming?.timestamp ?? null);
    const outgoingTs = toNumber(firstOutgoing?.timestamp ?? null);
    if (incomingTs !== null && outgoingTs !== null) {
      whatsappLatencyMs = outgoingTs - incomingTs;
    }
  }

  // Read PWA data
  const triggers = await readTriggersFromRedis(client, experimentId);
  const acks = await readAcksFromRedis(client, experimentId);

  // Calculate PWA latency
  const pwaLatencyMs = computePwaLatency(triggers, acks, experimentId);

  // Determine winner
  let winner: "PWA" | "WhatsApp" | "tie" | "N/A" = "N/A";
  if (pwaLatencyMs !== null && whatsappLatencyMs !== null) {
    if (pwaLatencyMs < whatsappLatencyMs) {
      winner = "PWA";
    } else if (whatsappLatencyMs < pwaLatencyMs) {
      winner = "WhatsApp";
    } else {
      winner = "tie";
    }
  }

  return {
    experimentId,
    trialNumber,
    pwaLatencyMs,
    whatsappLatencyMs,
    winner,
  };
}

function generateTable(results: ExperimentResult[]): string {
  const lines: string[] = [];

  lines.push("\n╔═══════════════════════════════════════════════════════════════════════════════╗");
  lines.push("║                    WhatsApp Webhook Experiment Results                       ║");
  lines.push("╚═══════════════════════════════════════════════════════════════════════════════╝\n");

  lines.push("┌──────────────────────┬─────────────────────┬─────────────────────┬──────────┐");
  lines.push("│ Experiment ID        │ PWA Latency (ms)    │ WhatsApp Latency    │ Winner   │");
  lines.push("├──────────────────────┼─────────────────────┼─────────────────────┼──────────┤");

  for (const result of results) {
    const expId = result.experimentId.slice(0, 20);
    const pwa = result.pwaLatencyMs !== null ? result.pwaLatencyMs.toFixed(2) : "N/A";
    const wa = result.whatsappLatencyMs !== null ? result.whatsappLatencyMs.toFixed(2) : "N/A";
    const winner = result.winner.padEnd(8);

    lines.push(`│ ${expId.padEnd(20)} │ ${pwa.padEnd(19)} │ ${wa.padEnd(19)} │ ${winner} │`);
  }

  lines.push("└──────────────────────┴─────────────────────┴─────────────────────┴──────────┘");

  return lines.join("\n");
}

function generateSummary(results: ExperimentResult[]): Summary {
  const pwaLatencies = results
    .map((r) => r.pwaLatencyMs)
    .filter((latency): latency is number => latency !== null);

  const whatsappLatencies = results
    .map((r) => r.whatsappLatencyMs)
    .filter((latency): latency is number => latency !== null);

  const pwaMetrics = calculateMetrics(pwaLatencies);
  const whatsappMetrics = calculateMetrics(whatsappLatencies);

  let winner: "PWA" | "WhatsApp" | "tie" = "tie";
  if (pwaMetrics.count > 0 && whatsappMetrics.count > 0) {
    if (pwaMetrics.mean < whatsappMetrics.mean) {
      winner = "PWA";
    } else if (whatsappMetrics.mean < pwaMetrics.mean) {
      winner = "WhatsApp";
    }
  }

  return {
    pwa: pwaMetrics,
    whatsapp: whatsappMetrics,
    winner,
  };
}

function generateSummaryTable(summary: Summary): string {
  const lines: string[] = [];

  lines.push("\n╔═══════════════════════════════════════════════════════════════════════════════╗");
  lines.push("║                               Summary Statistics                            ║");
  lines.push("╚═══════════════════════════════════════════════════════════════════════════════╝\n");

  lines.push("┌────────────────┬─────────────────────┬─────────────────────┬─────────────────────┐");
  lines.push("│ Metric         │ PWA                 │ WhatsApp            │ Winner              │");
  lines.push("├────────────────┼─────────────────────┼─────────────────────┼─────────────────────┤");

  const metrics = [
    { label: "Count", pwa: summary.pwa.count, wa: summary.whatsapp.count },
    { label: "Mean (ms)", pwa: summary.pwa.mean, wa: summary.whatsapp.mean },
    { label: "Median (ms)", pwa: summary.pwa.median, wa: summary.whatsapp.median },
    { label: "P95 (ms)", pwa: summary.pwa.p95, wa: summary.whatsapp.p95 },
    { label: "P99 (ms)", pwa: summary.pwa.p99, wa: summary.whatsapp.p99 },
    { label: "Min (ms)", pwa: summary.pwa.min, wa: summary.whatsapp.min },
    { label: "Max (ms)", pwa: summary.pwa.max, wa: summary.whatsapp.max },
  ];

  for (const metric of metrics) {
    const pwaStr = metric.pwa.toFixed(2);
    const waStr = metric.wa.toFixed(2);
    let winnerStr = "";
    if (metric.label === "Mean (ms)" && summary.winner !== "tie") {
      winnerStr = summary.winner;
    }

    lines.push(
      `│ ${metric.label.padEnd(14)} │ ${pwaStr.padEnd(19)} │ ${waStr.padEnd(19)} │ ${winnerStr.padEnd(19)} │`
    );
  }

  lines.push("└────────────────┴─────────────────────┴─────────────────────┴─────────────────────┘");

  lines.push(`\nOverall Winner: ${summary.winner.toUpperCase()}`);

  return lines.join("\n");
}

// Main function
async function main() {
  const runId = getArg("run-id");

  if (!runId) {
    console.error("Usage: bun run scripts/analyze-whatsapp-webhooks.ts --run-id=<run-id>");
    console.error("Example: bun run scripts/analyze-whatsapp-webhooks.ts --run-id=run-1776081883542");
    process.exit(1);
  }

  console.log(`Connecting to Redis...`);
  const client = createClient({ url: process.env.REDIS_URL ?? "redis://localhost:6379" });
  await client.connect();

  try {
    console.log(`Reading manifest for ${runId}...`);
    const manifest = await readManifest(runId);

    if (!manifest) {
      console.error(`Failed to load manifest for run: ${runId}`);
      process.exit(1);
    }

    console.log(`Found ${manifest.trials.length} trials to analyze...\n`);

    const results: ExperimentResult[] = [];

    for (const trial of manifest.trials) {
      const result = await analyzeExperiment(client, trial.experimentId, trial.trialNumber);
      results.push(result);
    }

    const summary = generateSummary(results);

    // Print tables
    console.log(generateTable(results));
    console.log(generateSummaryTable(summary));
    console.log();

    // Create output directory
    const outDir = `experiments/${runId}`;
    await mkdir(outDir, { recursive: true });

    // Save analysis JSON
    const output: AnalysisOutput = {
      runId,
      manifest,
      experiments: results,
      summary,
      generatedAt: new Date().toISOString(),
    };

    const outputPath = `${outDir}/analysis.json`;
    await Bun.write(outputPath, JSON.stringify(output, null, 2));
    console.log(`Analysis saved to: ${outputPath}`);

  } finally {
    await client.quit();
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
