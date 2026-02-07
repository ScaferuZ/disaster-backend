import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

type Args = {
  baseUrl: string;
  count: number;
  intervalMs: number;
  output: string;
};

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function parseNumberArg(name: string, fallback: number): number {
  const value = getArg(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid --${name}: ${value}`);
  }
  return parsed;
}

function getArgs(): Args {
  return {
    baseUrl: getArg("base-url") ?? "http://localhost:3000",
    count: parseNumberArg("count", 30),
    intervalMs: parseNumberArg("interval-ms", 1000),
    output: getArg("output") ?? "experiments/stage6/latest/load.ndjson",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildReport() {
  return {
    lik_codes: ["wn-1", "wn-2", "wn-3", "wn-4"],
    level_of_interaction_with_disaster: 5,
    age: 35,
    usage_duration: 10,
    min_frequency_of_usage: 10,
    fishing_experience: 5,
    clientReportId: crypto.randomUUID(),
    createdAtClient: Date.now(),
  };
}

async function run() {
  const args = getArgs();
  await mkdir(dirname(args.output), { recursive: true });

  let success = 0;
  let failed = 0;
  const lines: string[] = [];

  console.log(`[stage6] load start count=${args.count} intervalMs=${args.intervalMs} baseUrl=${args.baseUrl}`);

  for (let index = 0; index < args.count; index += 1) {
    const report = buildReport();
    const startedAt = Date.now();

    try {
      const response = await fetch(`${args.baseUrl}/api/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(report),
      });

      const bodyText = await response.text();
      const durationMs = Date.now() - startedAt;
      if (!response.ok) {
        failed += 1;
        console.error(`[stage6] report ${index + 1}/${args.count} failed status=${response.status}`);
      } else {
        success += 1;
      }

      lines.push(JSON.stringify({
        ts: Date.now(),
        index: index + 1,
        clientReportId: report.clientReportId,
        createdAtClient: report.createdAtClient,
        status: response.status,
        ok: response.ok,
        durationMs,
        responseBody: bodyText,
      }));
    } catch (error) {
      failed += 1;
      console.error(`[stage6] report ${index + 1}/${args.count} threw`, error);
      lines.push(JSON.stringify({
        ts: Date.now(),
        index: index + 1,
        clientReportId: report.clientReportId,
        createdAtClient: report.createdAtClient,
        ok: false,
        error: String(error),
      }));
    }

    if (index < args.count - 1) {
      await sleep(args.intervalMs);
    }
  }

  await Bun.write(args.output, lines.length > 0 ? `${lines.join("\n")}\n` : "");
  console.log(`[stage6] load complete success=${success} failed=${failed} output=${args.output}`);
}

run().catch((error) => {
  console.error("[stage6] load runner fatal", error);
  process.exit(1);
});
