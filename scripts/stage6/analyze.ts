import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

type ExportedRow = {
  id: string;
  fields?: Record<string, string>;
  parsedJson?: unknown;
};

type AckEvent = {
  alertId?: string;
  transport?: "SSE" | "WS" | "PUSH" | string;
  ackStage?: string;
  endToEndLatencyMs?: number;
};

type SyncEvent = {
  status?: string;
};

type ResourceRow = {
  ts: number;
  cpuPercent: number;
  rssKb: number;
};

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function parseNdjson<T>(text: string): T[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

async function readNdjsonIfExists<T>(path: string): Promise<T[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) return [];
  const text = await file.text();
  if (!text.trim()) return [];
  return parseNdjson<T>(text);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  const normalizedIndex = Math.max(0, Math.min(sorted.length - 1, index));
  return sorted[normalizedIndex] ?? null;
}

function summarizeNumbers(values: number[]) {
  if (values.length === 0) {
    return { count: 0, min: null, max: null, mean: null, p50: null, p95: null };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, value) => acc + value, 0);
  return {
    count: values.length,
    min: sorted[0] ?? null,
    max: sorted[sorted.length - 1] ?? null,
    mean: Number((sum / values.length).toFixed(2)),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

function parseAckEvents(rows: ExportedRow[]): AckEvent[] {
  return rows
    .map((row) => row.parsedJson)
    .filter((value): value is AckEvent => Boolean(value && typeof value === "object"));
}

function parseSyncEvents(rows: ExportedRow[]): SyncEvent[] {
  return rows
    .map((row) => row.parsedJson)
    .filter((value): value is SyncEvent => Boolean(value && typeof value === "object"));
}

function parseResourceCsv(text: string): ResourceRow[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const dataLines = lines.filter((line) => !line.startsWith("ts,"));
  const rows: ResourceRow[] = [];

  for (const line of dataLines) {
    const [ts, cpuPercent, rssKb] = line.split(",");
    const parsed: ResourceRow = {
      ts: Number(ts),
      cpuPercent: Number(cpuPercent),
      rssKb: Number(rssKb),
    };
    if (!Number.isFinite(parsed.ts) || !Number.isFinite(parsed.cpuPercent) || !Number.isFinite(parsed.rssKb)) {
      continue;
    }
    rows.push(parsed);
  }

  return rows;
}

async function run() {
  const rawDir = getArg("raw-dir") ?? "experiments/stage6/latest/raw";
  const outDir = getArg("out-dir") ?? "experiments/stage6/latest/analysis";
  const protocol = getArg("protocol") ?? "mixed";
  const network = getArg("network") ?? "unknown";

  await mkdir(outDir, { recursive: true });

  const alertsRows = await readNdjsonIfExists<ExportedRow>(`${rawDir}/alerts-stream.ndjson`);
  const ackRows = await readNdjsonIfExists<ExportedRow>(`${rawDir}/acks-stream.ndjson`);
  const syncRows = await readNdjsonIfExists<ExportedRow>(`${rawDir}/report-sync-stream.ndjson`);

  const ackEvents = parseAckEvents(ackRows);
  const syncEvents = parseSyncEvents(syncRows);

  const alertsCount = alertsRows.length;

  const transportSummary: Record<string, unknown> = {};
  const latencyCsvLines = ["transport,latencyMs"];

  for (const transport of ["SSE", "WS", "PUSH"] as const) {
    const events = ackEvents.filter((event) => event.transport === transport);
    const deliveredEvents = events.filter((event) => {
      const stage = event.ackStage ?? "UNSPECIFIED";
      if (transport === "PUSH") return stage === "DELIVERED";
      return stage === "UNSPECIFIED" || stage === "DELIVERED";
    });

    const uniqueDeliveredAlertIds = new Set(
      deliveredEvents
        .map((event) => event.alertId)
        .filter((alertId): alertId is string => typeof alertId === "string"),
    );

    const latencies = deliveredEvents
      .map((event) => toNumber(event.endToEndLatencyMs))
      .filter((value): value is number => value !== null);

    for (const latency of latencies) {
      latencyCsvLines.push(`${transport},${latency}`);
    }

    transportSummary[transport] = {
      ackCount: events.length,
      deliveredAckCount: deliveredEvents.length,
      deliveredUniqueAlerts: uniqueDeliveredAlertIds.size,
      deliveryRate: alertsCount > 0 ? Number((uniqueDeliveredAlertIds.size / alertsCount).toFixed(4)) : null,
      latencyMs: summarizeNumbers(latencies),
    };
  }

  const syncStatusCounts: Record<string, number> = {};
  for (const event of syncEvents) {
    const status = typeof event.status === "string" ? event.status : "UNKNOWN";
    syncStatusCounts[status] = (syncStatusCounts[status] ?? 0) + 1;
  }

  const accepted = syncStatusCounts.ACCEPTED ?? 0;
  const deduped = syncStatusCounts.DEDUPED ?? 0;
  const failedMl = syncStatusCounts.FAILED_ML ?? 0;
  const syncDenominator = accepted + deduped + failedMl;
  const syncSuccessRate =
    syncDenominator > 0 ? Number(((accepted + deduped) / syncDenominator).toFixed(4)) : null;

  let resourceSummary: Record<string, unknown> | null = null;
  const resourceFile = Bun.file(`${rawDir}/resources.csv`);
  if (await resourceFile.exists()) {
    const resources = parseResourceCsv(await resourceFile.text());
    const cpuValues = resources.map((row) => row.cpuPercent);
    const rssMbValues = resources.map((row) => row.rssKb / 1024);

    resourceSummary = {
      sampleCount: resources.length,
      cpuPercent: summarizeNumbers(cpuValues),
      rssMb: summarizeNumbers(rssMbValues),
    };
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    labels: { protocol, network },
    inputs: {
      rawDir,
      alertsCount,
      ackCount: ackEvents.length,
      syncCount: syncEvents.length,
    },
    protocols: transportSummary,
    sync: {
      statusCounts: syncStatusCounts,
      successRate: syncSuccessRate,
    },
    resources: resourceSummary,
  };

  await Bun.write(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
  await Bun.write(`${outDir}/latency.csv`, `${latencyCsvLines.join("\n")}\n`);

  const protocolRows = [
    "transport,ackCount,deliveredAckCount,deliveredUniqueAlerts,deliveryRate,latencyMeanMs,latencyP50Ms,latencyP95Ms",
  ];

  for (const transport of ["SSE", "WS", "PUSH"] as const) {
    const protocolMetrics = transportSummary[transport] as {
      ackCount: number;
      deliveredAckCount: number;
      deliveredUniqueAlerts: number;
      deliveryRate: number | null;
      latencyMs: {
        mean: number | null;
        p50: number | null;
        p95: number | null;
      };
    };

    protocolRows.push([
      transport,
      protocolMetrics.ackCount,
      protocolMetrics.deliveredAckCount,
      protocolMetrics.deliveredUniqueAlerts,
      protocolMetrics.deliveryRate ?? "",
      protocolMetrics.latencyMs.mean ?? "",
      protocolMetrics.latencyMs.p50 ?? "",
      protocolMetrics.latencyMs.p95 ?? "",
    ].join(","));
  }

  await Bun.write(`${outDir}/protocol-summary.csv`, `${protocolRows.join("\n")}\n`);

  await mkdir(dirname(`${outDir}/_ok`), { recursive: true });
  console.log(`[stage6] analysis written to ${outDir}`);
}

run().catch((error) => {
  console.error("[stage6] analyze fatal", error);
  process.exit(1);
});
