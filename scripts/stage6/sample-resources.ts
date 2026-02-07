import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { $ } from "bun";

type Args = {
  pid: number;
  intervalMs: number;
  durationMs: number | null;
  output: string;
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

function getArgs(): Args {
  const pid = parseNumberArg("pid");
  if (!pid) {
    throw new Error("missing required --pid=<number>");
  }

  const durationSeconds = parseNumberArg("duration-s");
  return {
    pid,
    intervalMs: parseNumberArg("interval-ms", 2000) ?? 2000,
    durationMs: durationSeconds !== undefined ? durationSeconds * 1000 : null,
    output: getArg("output") ?? "experiments/stage6/latest/raw/resources.csv",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePsOutput(line: string) {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const cpuPercent = Number(parts[0]);
  const rssKb = Number(parts[1]);
  if (!Number.isFinite(cpuPercent) || !Number.isFinite(rssKb)) return null;
  return { cpuPercent, rssKb };
}

async function run() {
  const args = getArgs();
  await mkdir(dirname(args.output), { recursive: true });

  const lines: string[] = ["ts,cpuPercent,rssKb"];
  const startedAt = Date.now();

  console.log(`[stage6] resource sampling pid=${args.pid} intervalMs=${args.intervalMs} output=${args.output}`);

  while (true) {
    if (args.durationMs !== null && Date.now() - startedAt > args.durationMs) {
      break;
    }

    try {
      const result = await $`ps -p ${String(args.pid)} -o %cpu=,rss=`.text();
      const parsed = parsePsOutput(result);
      if (!parsed) {
        console.warn("[stage6] process not found or parse error, stopping sampler");
        break;
      }

      lines.push(`${Date.now()},${parsed.cpuPercent},${parsed.rssKb}`);
      await Bun.write(args.output, `${lines.join("\n")}\n`);
    } catch (error) {
      console.warn("[stage6] sampler stopped", error);
      break;
    }

    await sleep(args.intervalMs);
  }

  await Bun.write(args.output, `${lines.join("\n")}\n`);
  console.log(`[stage6] resource sampling complete samples=${Math.max(0, lines.length - 1)}`);
}

run().catch((error) => {
  console.error("[stage6] sampler fatal", error);
  process.exit(1);
});
