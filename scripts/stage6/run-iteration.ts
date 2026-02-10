import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { $ } from "bun";

type Args = {
  label?: string;
  protocol: string;
  network: string;
  baseUrl: string;
  pid?: number;
  durationS: number;
  count: number;
  intervalMs: number;
  skipFinalReset: boolean;
};

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
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

function inferFromLabel(label: string) {
  const parts = label.toLowerCase().split("_");
  const protocolToken = parts[0] ?? "mixed";
  const networkToken = parts[1] ?? "unknown";

  const protocol = protocolToken === "sse" || protocolToken === "ws" || protocolToken === "push"
    ? protocolToken.toUpperCase()
    : "MIXED";

  const network = networkToken === "normal"
    ? "NORMAL"
    : networkToken === "3g"
      ? "3G"
      : networkToken === "2g"
        ? "2G"
        : networkToken.startsWith("high")
          ? "HIGH_LATENCY"
          : "UNKNOWN";

  return { protocol, network };
}

async function resolveLabel(labelArg: string | undefined): Promise<string> {
  if (labelArg && labelArg.trim().length > 0) {
    return labelArg.trim();
  }

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question("Stage 6 run label (example: sse_3g_r1): ")).trim();
    if (!answer) throw new Error("label is required");
    return answer;
  } finally {
    rl.close();
  }
}

async function detectBackendPid(): Promise<number> {
  const output = (await $`pgrep -f ${"bun run --hot src/index.ts"}`.text()).trim();
  const first = output.split("\n").map((row) => row.trim()).find(Boolean);
  if (!first) {
    throw new Error("unable to auto-detect backend pid; pass --pid=<number>");
  }

  const pid = Number(first);
  if (!Number.isFinite(pid)) {
    throw new Error("invalid auto-detected pid; pass --pid=<number>");
  }

  return pid;
}

function getArgs(): Args {
  return {
    label: getArg("label"),
    protocol: (getArg("protocol") ?? "").toUpperCase(),
    network: (getArg("network") ?? "").toUpperCase(),
    baseUrl: getArg("base-url") ?? "http://localhost:3000",
    pid: parseNumberArg("pid"),
    durationS: parseNumberArg("duration-s", 180) ?? 180,
    count: parseNumberArg("count", 50) ?? 50,
    intervalMs: parseNumberArg("interval-ms", 1000) ?? 1000,
    skipFinalReset: hasFlag("skip-final-reset"),
  };
}

async function runCommand(label: string, cmd: string[]) {
  console.log(`[stage6] ${label}: ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}`);
  }
}

async function run() {
  const args = getArgs();
  const label = await resolveLabel(args.label);
  const inferred = inferFromLabel(label);
  const protocol = args.protocol || inferred.protocol;
  const network = args.network || inferred.network;

  const pid = args.pid ?? (await detectBackendPid());

  const runDir = `experiments/stage6/${label}`;
  const rawDir = `${runDir}/raw`;
  const analysisDir = `${runDir}/analysis`;
  const loadOutput = `${runDir}/load.ndjson`;
  const resourcesOutput = `${rawDir}/resources.csv`;

  console.log(`[stage6] run label=${label} protocol=${protocol} network=${network} pid=${pid}`);

  await runCommand("reset(before)", ["bun", "run", "stage6:reset"]);

  const resourceProc = Bun.spawn([
    "bun",
    "run",
    "stage6:sample:resources",
    "--",
    `--pid=${pid}`,
    `--interval-ms=2000`,
    `--duration-s=${args.durationS}`,
    `--output=${resourcesOutput}`,
  ], {
    stdout: "inherit",
    stderr: "inherit",
  });

  try {
    await runCommand("load", [
      "bun",
      "run",
      "stage6:load",
      "--",
      `--base-url=${args.baseUrl}`,
      `--count=${args.count}`,
      `--interval-ms=${args.intervalMs}`,
      `--output=${loadOutput}`,
    ]);

    await runCommand("export", [
      "bun",
      "run",
      "stage6:export",
      "--",
      `--out-dir=${rawDir}`,
    ]);
  } catch (error) {
    resourceProc.kill();
    throw error;
  }

  const resourceExit = await resourceProc.exited;
  if (resourceExit !== 0) {
    throw new Error(`resource sampler exited with code ${resourceExit}`);
  }

  await runCommand("analyze", [
    "bun",
    "run",
    "stage6:analyze",
    "--",
    `--raw-dir=${rawDir}`,
    `--out-dir=${analysisDir}`,
    `--protocol=${protocol}`,
    `--network=${network}`,
  ]);

  if (!args.skipFinalReset) {
    await runCommand("reset(after)", ["bun", "run", "stage6:reset"]);
  }

  console.log(`[stage6] iteration complete. outputs: ${runDir}`);
}

run().catch((error) => {
  console.error("[stage6] iteration fatal", error);
  process.exit(1);
});
