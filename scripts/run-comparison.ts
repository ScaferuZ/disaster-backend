import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { triggerDualReport } from "./compare-channels.js";

/**
 * CLI arguments for running comparison experiments
 */
interface ComparisonArgs {
  count: number;
  interval: number;
  text: string;
  runId: string;
  networkProfile: string;
}

/**
 * Manifest metadata saved for each experiment run
 */
interface ExperimentManifest {
  runId: string;
  count: number;
  interval: number;
  text: string;
  networkProfile: string;
  startedAt: string;
  endedAt?: string;
  trials: TrialResult[];
}

/**
 * Result of a single trial
 */
interface TrialResult {
  trialNumber: number;
  experimentId: string;
  timestamp: string;
  success: boolean;
  error?: string;
}

/**
 * Parse a command line argument
 */
function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

/**
 * Parse a numeric command line argument with fallback
 */
function parseNumberArg(name: string, fallback: number): number {
  const value = getArg(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid --${name}: ${value} (must be a non-negative number)`);
  }
  return parsed;
}

/**
 * Parse and validate CLI arguments
 */
function getArgs(): ComparisonArgs {
  const count = parseNumberArg("count", 10);
  const interval = parseNumberArg("interval", 2000);
  const text = getArg("text") ?? "ada lumba2 menggiring perahu di tepi pantai";
  const runId = getArg("run-id") ?? `run-${Date.now()}`;
  const networkProfile = getArg("network-profile") ?? "unknown";

  if (count < 1) {
    throw new Error("--count must be at least 1");
  }

  if (interval < 0) {
    throw new Error("--interval must be non-negative");
  }

  if (text.trim().length === 0) {
    throw new Error("--text cannot be empty");
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(runId)) {
    throw new Error("--run-id must contain only alphanumeric characters, hyphens, and underscores");
  }

  return { count, interval, text, runId, networkProfile };
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Update the manifest file with current state
 */
async function updateManifest(
  runDir: string,
  manifest: ExperimentManifest
): Promise<void> {
  const manifestPath = join(runDir, "manifest.json");
  await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));
}

/**
 * Run a single trial
 */
async function runTrial(trialNumber: number, text: string): Promise<TrialResult> {
  const experimentId = crypto.randomUUID();
  const timestamp = new Date().toISOString();

  try {
    await triggerDualReport(text, experimentId);
    return {
      trialNumber,
      experimentId,
      timestamp,
      success: true,
    };
  } catch (error) {
    return {
      trialNumber,
      experimentId,
      timestamp,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Main execution function
 */
async function run(): Promise<void> {
  const args = getArgs();

  // Create experiment directory
  const runDir = join("experiments", args.runId);
  await mkdir(runDir, { recursive: true });

  // Initialize manifest
  const manifest: ExperimentManifest = {
    runId: args.runId,
    count: args.count,
    interval: args.interval,
    text: args.text,
    networkProfile: args.networkProfile,
    startedAt: new Date().toISOString(),
    trials: [],
  };

  await updateManifest(runDir, manifest);

  console.log(`[run-comparison] Starting experiment run=${args.runId}`);
  console.log(`[run-comparison] Configuration:`);
  console.log(`[run-comparison]   - Trials: ${args.count}`);
  console.log(`[run-comparison]   - Interval: ${args.interval}ms`);
  console.log(`[run-comparison]   - Text: "${args.text}"`);
  console.log(`[run-comparison]   - Network Profile: ${args.networkProfile}`);
  console.log(`[run-comparison]   - Output Directory: ${runDir}`);
  console.log();

  // Run trials
  let successCount = 0;
  let failureCount = 0;

  for (let i = 1; i <= args.count; i++) {
    console.log(`[run-comparison] Running trial ${i}/${args.count}...`);

    const result = await runTrial(i, args.text);
    manifest.trials.push(result);

    if (result.success) {
      successCount++;
      console.log(`[run-comparison] Trial ${i}/${args.count} ✓ success (experimentId: ${result.experimentId})`);
    } else {
      failureCount++;
      console.error(`[run-comparison] Trial ${i}/${args.count} ✗ failed: ${result.error}`);
    }

    // Update manifest after each trial
    await updateManifest(runDir, manifest);

    // Sleep between trials (except after the last one)
    if (i < args.count && args.interval > 0) {
      await sleep(args.interval);
    }
  }

  // Finalize manifest
  manifest.endedAt = new Date().toISOString();
  await updateManifest(runDir, manifest);

  // Print summary
  console.log();
  console.log(`[run-comparison] Experiment complete`);
  console.log(`[run-comparison] Summary:`);
  console.log(`[run-comparison]   - Total Trials: ${args.count}`);
  console.log(`[run-comparison]   - Successful: ${successCount}`);
  console.log(`[run-comparison]   - Failed: ${failureCount}`);
  console.log(`[run-comparison]   - Success Rate: ${((successCount / args.count) * 100).toFixed(1)}%`);
  console.log(`[run-comparison]   - Output: ${runDir}/manifest.json`);
  console.log();

  if (failureCount > 0) {
    console.warn(`[run-comparison] Warning: ${failureCount} trial(s) failed. Check manifest.json for details.`);
    process.exit(1);
  }
}

// Execute main function
run().catch((error) => {
  console.error("[run-comparison] Fatal error:", error);
  process.exit(1);
});
