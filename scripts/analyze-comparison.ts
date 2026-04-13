import { createClient } from "redis";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

type TriggerEvent = {
  runId: string;
  alertId: string;
  channel: "PWA" | "WhatsApp";
  triggeredAt: string;
  metadata?: Record<string, unknown>;
};

type AckEvent = {
  alertId: string;
  experimentId?: string;
  channel: "PWA" | "WhatsApp";
  receivedAtClient: string;
  ackStage?: string;
};

type Manifest = {
  runId: string;
  startedAt: string;
  completedAt?: string;
  config: {
    protocol?: string;
    network?: string;
    count?: number;
    intervalMs?: number;
  };
  metadata?: Record<string, unknown>;
};

type Metrics = {
  count: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
};

type ChannelMetrics = {
  channel: "PWA" | "WhatsApp";
  totalTriggers: number;
  totalAcks: number;
  deliveryRate: number;
  latencyMs: Metrics;
  missingAcks: number;
  failedTriggers: number;
  outliers: number[];
};

type AnalysisResult = {
  runId: string;
  manifest: Manifest;
  channels: {
    pwa: ChannelMetrics;
    whatsapp: ChannelMetrics;
  };
  comparison: {
    latencyDiffMs: number;
    deliveryRateDiffPercent: number;
    winner: "PWA" | "WhatsApp" | "tie";
  };
  generatedAt: string;
};

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function parseNumberArg(name: string, fallback?: number): number | undefined {
  const value = getArg(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid --${name}: ${value}`);
  }
  return parsed;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
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

  // Detect outliers using IQR method
  const q1 = percentile(sorted, 25);
  const q3 = percentile(sorted, 75);
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  const outliers = sorted.filter((v) => v < lowerBound || v > upperBound);

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

async function readManifest(runId: string): Promise<Manifest | null> {
  const path = `experiments/${runId}/manifest.json`;
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }
  try {
    return await file.json();
  } catch {
    return null;
  }
}

async function readTriggersFromRedis(
  client: ReturnType<typeof createClient>,
  runId: string,
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
      "500",
    ]);

    if (!Array.isArray(reply) || reply.length === 0) break;

    for (const row of reply) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const id = String(row[0]);
      const fields = row[1];
      if (!Array.isArray(fields)) continue;

      const eventFields: Record<string, string> = {};
      for (let idx = 0; idx < fields.length; idx += 2) {
        const field = fields[idx];
        const value = fields[idx + 1];
        if (field !== undefined && value !== undefined) {
          eventFields[String(field)] = String(value);
        }
      }

      if (eventFields.runId !== runId) continue;

      let parsedJson: Record<string, unknown> = {};
      if (typeof eventFields.json === "string") {
        try {
          parsedJson = JSON.parse(eventFields.json);
        } catch {
          // ignore parse errors
        }
      }

      triggers.push({
        runId: eventFields.runId,
        alertId: eventFields.alertId,
        channel: eventFields.channel as "PWA" | "WhatsApp",
        triggeredAt: eventFields.triggeredAt,
        metadata: parsedJson,
      });

      start = `(${id}`;
    }

    if (reply.length < 500) break;
  }

  return triggers;
}

async function readAcksFromRedis(
  client: ReturnType<typeof createClient>,
  runId: string,
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
      "500",
    ]);

    if (!Array.isArray(reply) || reply.length === 0) break;

    for (const row of reply) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const id = String(row[0]);
      const fields = row[1];
      if (!Array.isArray(fields)) continue;

      const eventFields: Record<string, string> = {};
      for (let idx = 0; idx < fields.length; idx += 2) {
        const field = fields[idx];
        const value = fields[idx + 1];
        if (field !== undefined && value !== undefined) {
          eventFields[String(field)] = String(value);
        }
      }

      // Filter by experimentId correlation
      if (eventFields.experimentId !== runId) continue;

      let parsedJson: Record<string, unknown> = {};
      if (typeof eventFields.json === "string") {
        try {
          parsedJson = JSON.parse(eventFields.json);
        } catch {
          // ignore parse errors
        }
      }

      acks.push({
        alertId: eventFields.alertId,
        experimentId: eventFields.experimentId,
        channel: eventFields.channel as "PWA" | "WhatsApp",
        receivedAtClient: eventFields.receivedAtClient,
        ackStage: eventFields.ackStage,
      });

      start = `(${id}`;
    }

    if (reply.length < 500) break;
  }

  return acks;
}

function analyzeChannel(
  channel: "PWA" | "WhatsApp",
  triggers: TriggerEvent[],
  acks: AckEvent[],
): ChannelMetrics {
  const channelTriggers = triggers.filter((t) => t.channel === channel);
  const channelAcks = acks.filter((a) => a.channel === channel);

  const uniqueAlertIds = new Set(channelTriggers.map((t) => t.alertId));
  const ackedAlertIds = new Set(channelAcks.map((a) => a.alertId));

  const missingAcks = uniqueAlertIds.size - ackedAlertIds.size;
  const failedTriggers = channelTriggers.filter(
    (t) => t.metadata?.status === "failed" || t.metadata?.error,
  ).length;

  // Calculate latencies
  const latencies: number[] = [];
  const ackMap = new Map(channelAcks.map((a) => [a.alertId, a]));

  for (const trigger of channelTriggers) {
    const ack = ackMap.get(trigger.alertId);
    if (!ack) continue;

    const triggeredTime = new Date(trigger.triggeredAt).getTime();
    const receivedTime = new Date(ack.receivedAtClient).getTime();

    if (!isNaN(triggeredTime) && !isNaN(receivedTime)) {
      latencies.push(receivedTime - triggeredTime);
    }
  }

  const metrics = calculateMetrics(latencies);

  // Detect outliers (values > 3 std deviations from mean)
  const mean = metrics.mean;
  const stdDev = Math.sqrt(
    latencies.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / latencies.length,
  );
  const outliers = latencies.filter((v) => Math.abs(v - mean) > 3 * stdDev);

  return {
    channel,
    totalTriggers: channelTriggers.length,
    totalAcks: channelAcks.length,
    deliveryRate: uniqueAlertIds.size > 0
      ? Number((ackedAlertIds.size / uniqueAlertIds.size).toFixed(4))
      : 0,
    latencyMs: metrics,
    missingAcks: Math.max(0, missingAcks),
    failedTriggers,
    outliers,
  };
}

function formatConsoleTable(analysis: AnalysisResult): string {
  const lines: string[] = [];
  lines.push("");
  lines.push("=".repeat(80));
  lines.push(`EXPERIMENT ANALYSIS: ${analysis.runId}`);
  lines.push("=".repeat(80));
  lines.push("");

  // Manifest info
  lines.push("Configuration:");
  lines.push(`  Protocol:   ${analysis.manifest.config.protocol ?? "N/A"}`);
  lines.push(`  Network:    ${analysis.manifest.config.network ?? "N/A"}`);
  lines.push(`  Count:      ${analysis.manifest.config.count ?? "N/A"}`);
  lines.push(`  Interval:   ${analysis.manifest.config.intervalMs ?? "N/A"}ms`);
  lines.push("");

  // Channel comparison table
  lines.push("Channel Comparison:");
  lines.push("");
  lines.push(
    `┌─────────────────────────┬──────────────────────┬──────────────────────┐`,
  );
  lines.push(
    `│ Metric                  │ PWA                   │ WhatsApp              │`,
  );
  lines.push(
    `├─────────────────────────┼──────────────────────┼──────────────────────┤`,
  );

  const pwa = analysis.channels.pwa;
  const wa = analysis.channels.whatsapp;

  lines.push(
    `│ Total Triggers          │ ${String(pwa.totalTriggers).padEnd(20)} │ ${String(wa.totalTriggers).padEnd(20)} │`,
  );
  lines.push(
    `│ Total ACKs              │ ${String(pwa.totalAcks).padEnd(20)} │ ${String(wa.totalAcks).padEnd(20)} │`,
  );
  lines.push(
    `│ Delivery Rate           │ ${(pwa.deliveryRate * 100).toFixed(2)}%${" ".repeat(16)} │ ${(wa.deliveryRate * 100).toFixed(2)}%${" ".repeat(16)} │`,
  );
  lines.push(
    `├─────────────────────────┼──────────────────────┼──────────────────────┤`,
  );
  lines.push(
    `│ Mean Latency            │ ${pwa.latencyMs.mean}ms${" ".repeat(19 - String(pwa.latencyMs.mean).length)} │ ${wa.latencyMs.mean}ms${" ".repeat(19 - String(wa.latencyMs.mean).length)} │`,
  );
  lines.push(
    `│ Median Latency          │ ${pwa.latencyMs.median}ms${" ".repeat(19 - String(pwa.latencyMs.median).length)} │ ${wa.latencyMs.median}ms${" ".repeat(19 - String(wa.latencyMs.median).length)} │`,
  );
  lines.push(
    `│ P95 Latency             │ ${pwa.latencyMs.p95}ms${" ".repeat(19 - String(pwa.latencyMs.p95).length)} │ ${wa.latencyMs.p95}ms${" ".repeat(19 - String(wa.latencyMs.p95).length)} │`,
  );
  lines.push(
    `│ P99 Latency             │ ${pwa.latencyMs.p99}ms${" ".repeat(19 - String(pwa.latencyMs.p99).length)} │ ${wa.latencyMs.p99}ms${" ".repeat(19 - String(wa.latencyMs.p99).length)} │`,
  );
  lines.push(
    `│ Min/Max Latency         │ ${pwa.latencyMs.min}/${pwa.latencyMs.max}ms${" ".repeat(11 - String(pwa.latencyMs.min).length - String(pwa.latencyMs.max).length)} │ ${wa.latencyMs.min}/${wa.latencyMs.max}ms${" ".repeat(11 - String(wa.latencyMs.min).length - String(wa.latencyMs.max).length)} │`,
  );
  lines.push(
    `├─────────────────────────┼──────────────────────┼──────────────────────┤`,
  );
  lines.push(
    `│ Missing ACKs            │ ${String(pwa.missingAcks).padEnd(20)} │ ${String(wa.missingAcks).padEnd(20)} │`,
  );
  lines.push(
    `│ Failed Triggers         │ ${String(pwa.failedTriggers).padEnd(20)} │ ${String(wa.failedTriggers).padEnd(20)} │`,
  );
  lines.push(
    `│ Outliers Detected       │ ${String(pwa.outliers.length).padEnd(20)} │ ${String(wa.outliers.length).padEnd(20)} │`,
  );
  lines.push(
    `└─────────────────────────┴──────────────────────┴──────────────────────┘`,
  );
  lines.push("");

  // Comparison summary
  lines.push("Comparison Summary:");
  lines.push("");
  lines.push(
    `  Latency Difference:      ${analysis.comparison.latencyDiffMs > 0 ? "+" : ""}${analysis.comparison.latencyDiffMs.toFixed(2)}ms (${analysis.comparison.latencyDiffMs > 0 ? "WhatsApp slower" : analysis.comparison.latencyDiffMs < 0 ? "PWA slower" : "tie"})`,
  );
  lines.push(
    `  Delivery Rate Diff:      ${analysis.comparison.deliveryRateDiffPercent > 0 ? "+" : ""}${analysis.comparison.deliveryRateDiffPercent.toFixed(2)}% (${analysis.comparison.deliveryRateDiffPercent > 0 ? "WhatsApp better" : analysis.comparison.deliveryRateDiffPercent < 0 ? "PWA better" : "tie"})`,
  );
  lines.push(`  Winner:                  ${analysis.comparison.winner.toUpperCase()}`);
  lines.push("");

  lines.push("=".repeat(80));
  lines.push("");

  return lines.join("\n");
}

async function run() {
  const runId = getArg("run-id");
  if (!runId?.trim()) {
    console.error("Error: --run-id is required");
    console.error("Usage: bun run scripts/analyze-comparison.ts --run-id=<experiment-id>");
    process.exit(1);
  }

  // Read manifest
  const manifest = await readManifest(runId);
  if (!manifest) {
    console.error(`Error: manifest not found for run ${runId}`);
    console.error(`Expected file: experiments/${runId}/manifest.json`);
    process.exit(1);
  }

  console.log(`[analysis] analyzing experiment ${runId}...`);

  // Connect to Redis
  const redisUrl = getArg("redis-url") ?? process.env.REDIS_URL ?? "redis://localhost:6379";
  const client = createClient({ url: redisUrl });

  try {
    await client.connect();
  } catch (error) {
    console.error(`Error: failed to connect to Redis at ${redisUrl}`);
    console.error(error);
    process.exit(1);
  }

  try {
    // Read streams
    const triggers = await readTriggersFromRedis(client, runId);
    const acks = await readAcksFromRedis(client, runId);

    console.log(`[analysis] loaded ${triggers.length} triggers, ${acks.length} acks`);

    if (triggers.length === 0) {
      console.error(`Error: no triggers found for run ${runId}`);
      process.exit(1);
    }

    // Analyze each channel
    const pwaMetrics = analyzeChannel("PWA", triggers, acks);
    const whatsappMetrics = analyzeChannel("WhatsApp", triggers, acks);

    // Calculate comparison
    const latencyDiff = whatsappMetrics.latencyMs.mean - pwaMetrics.latencyMs.mean;
    const deliveryRateDiff =
      (whatsappMetrics.deliveryRate - pwaMetrics.deliveryRate) * 100;

    let winner: "PWA" | "WhatsApp" | "tie" = "tie";
    if (Math.abs(latencyDiff) > 50 || Math.abs(deliveryRateDiff) > 5) {
      if (latencyDiff < 0 && deliveryRateDiff >= 0) {
        winner = "WhatsApp";
      } else if (latencyDiff > 0 && deliveryRateDiff <= 0) {
        winner = "PWA";
      } else {
        // Mixed signals - use latency as primary metric
        winner = latencyDiff < 0 ? "WhatsApp" : "PWA";
      }
    }

    const analysis: AnalysisResult = {
      runId,
      manifest,
      channels: {
        pwa: pwaMetrics,
        whatsapp: whatsappMetrics,
      },
      comparison: {
        latencyDiffMs: latencyDiff,
        deliveryRateDiffPercent: deliveryRateDiff,
        winner,
      },
      generatedAt: new Date().toISOString(),
    };

    // Write output
    const outDir = `experiments/${runId}`;
    await mkdir(outDir, { recursive: true });

    await Bun.write(
      `${outDir}/analysis.json`,
      JSON.stringify(analysis, null, 2),
    );

    // Print console output
    console.log(formatConsoleTable(analysis));
    console.log(`[analysis] results written to ${outDir}/analysis.json`);

  } finally {
    await client.quit();
  }
}

run().catch((error) => {
  console.error("[analysis] fatal error:", error);
  process.exit(1);
});
