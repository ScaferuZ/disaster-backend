#!/usr/bin/env bun
/**
 * Interactive WhatsApp Manual Experiment Runner
 *
 * Runs interactive experiments for WhatsApp testing with:
 * - Sequential experiment IDs (EXP-001, EXP-002, etc.)
 * - Formatted WhatsApp messages with experiment tags
 * - Visual progress indicators and colored output
 * - PWA triggering via POST /api/report
 * - Trial data saved to experiments/manual-<timestamp>/trials.ndjson
 */

import { formatWhatsAppMessage, generateExperimentId, type ExperimentTrial } from "../src/lib/experiment-utils.js";

// ANSI color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

interface PWAReportBody {
  lik_codes: string[];
  beach_location: string;
  _experimentId: string;
  _channel: "PWA";
}

interface ReportResponse {
  ok: boolean;
  reportId: string;
  serverTimestamp: number;
  shouldDistribute: boolean;
  alertEvent: {
    alertId: string;
    reportId: string;
    serverTimestamp: number;
  };
}

interface ExtendedTrial extends ExperimentTrial {
  pwaReportId?: string;
  pwaAlertId?: string;
  pwaSuccess: boolean;
  pwaStatus?: number;
  pwaError?: string;
}

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let count = 5;
  let text = "message";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--count" && i + 1 < args.length) {
      count = parseInt(args[i + 1], 10);
      if (isNaN(count) || count < 1) {
        console.error(`${colors.red}Error: --count must be a positive number${colors.reset}`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--text" && i + 1 < args.length) {
      text = args[i + 1];
      i++;
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log(`
${colors.bright}WhatsApp Manual Experiment Runner${colors.reset}

Usage: bun run scripts/run-manual-experiment.ts [options]

Options:
  --count <n>     Number of trials to run (default: 5)
  --text <msg>    Message text to use (default: "message")
  --help, -h      Show this help message

Example:
  bun run scripts/run-manual-experiment.ts --count 10 --text "test banjir"
      `);
      process.exit(0);
    }
  }

  return { count, text };
}

// Print a header box
function printBox(title: string, content: string, color: string = colors.cyan) {
  const lines = content.split("\n");
  const maxLength = Math.max(title.length, ...lines.map(l => l.length));
  const border = "─".repeat(maxLength + 2);

  console.log(color);
  console.log(`┌${border}┐`);
  console.log(`│ ${title.padEnd(maxLength)} │`);
  console.log(`├${border}┤`);
  lines.forEach(line => {
    console.log(`│ ${line.padEnd(maxLength)} │`);
  });
  console.log(`└${border}┘`);
  console.log(colors.reset);
}

// Print a progress indicator
function printProgress(current: number, total: number, message: string) {
  const percentage = Math.round((current / total) * 100);
  const barLength = 30;
  const filled = Math.round((current / total) * barLength);
  const bar = "█".repeat(filled) + "░".repeat(barLength - filled);

  process.stdout.write(`\r${colors.cyan}[${bar}] ${percentage}%${colors.reset} ${colors.dim}${message}${colors.reset}`);
}

// Countdown with visual feedback
async function countdown(seconds: number) {
  for (let i = seconds; i > 0; i--) {
    process.stdout.write(`\r${colors.yellow}${colors.bright}Triggering PWA in ${i}...${colors.reset}  `);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  console.log(`\r${colors.green}${colors.bright}Triggering PWA now!${colors.reset}    `);
}

// Trigger PWA report
async function triggerPWAReport(
  experimentId: string,
  baseUrl: string
): Promise<{ success: boolean; reportId?: string; alertId?: string; status?: number; error?: string }> {
  const startTime = Date.now();

  try {
    const body: PWAReportBody = {
      lik_codes: ["Wn-5"],
      beach_location: "pantai_lampuuk",
      _experimentId: experimentId,
      _channel: "PWA",
    };

    const response = await fetch(`${baseUrl}/api/report`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        status: response.status,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const data = (await response.json()) as ReportResponse;

    return {
      success: true,
      reportId: data.reportId,
      alertId: data.alertEvent.alertId,
      status: response.status,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Save trial data to NDJSON file
async function saveTrial(trial: ExtendedTrial, outputDir: string) {
  const filepath = `${outputDir}/trials.ndjson`;
  const line = JSON.stringify(trial);

  await Bun.write(filepath, line + "\n", { createPath: true, append: true });
}

// Main experiment runner
async function main() {
  const { count, text } = parseArgs();
  const baseUrl = process.env.BASE_URL || "http://localhost:3000";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = `experiments/manual-${timestamp}`;

  console.log(`\n${colors.bright}${colors.magenta}╔══════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║  WhatsApp Manual Experiment Runner  ║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}╚══════════════════════════════════════════╝${colors.reset}\n`);

  console.log(`${colors.dim}Configuration:${colors.reset}`);
  console.log(`  ${colors.cyan}Trials:${colors.reset}      ${count}`);
  console.log(`  ${colors.cyan}Message:${colors.reset}     "${text}"`);
  console.log(`  ${colors.cyan}Base URL:${colors.reset}   ${baseUrl}`);
  console.log(`  ${colors.cyan}Output:${colors.reset}     ${outputDir}/trials.ndjson\n`);

  const trials: ExtendedTrial[] = [];

  for (let i = 1; i <= count; i++) {
    const experimentId = generateExperimentId(i);
    const messageText = formatWhatsAppMessage(text, experimentId);

    // Print trial header
    console.log(`\n${colors.bright}${colors.blue}═══════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bright}${colors.blue}  Trial ${i}/${count} - ${experimentId}${colors.reset}`);
    console.log(`${colors.bright}${colors.blue}═══════════════════════════════════════════════════════════${colors.reset}\n`);

    // Display formatted message in a box
    printBox("Send this WhatsApp message:", messageText, colors.green);

    console.log(`\n${colors.dim}1. Copy the message above${colors.reset}`);
    console.log(`${colors.dim}2. Paste it in WhatsApp${colors.reset}`);
    console.log(`${colors.dim}3. Send to your test group${colors.reset}\n`);

    // Countdown
    await countdown(3);

    // Trigger PWA
    console.log(`${colors.cyan}Calling POST /api/report...${colors.reset}\n`);
    const pwaResult = await triggerPWAReport(experimentId, baseUrl);

    // Show result
    if (pwaResult.success) {
      console.log(`${colors.green}${colors.bright}✓ PWA report successful!${colors.reset}`);
      console.log(`  Report ID:  ${colors.dim}${pwaResult.reportId}${colors.reset}`);
      console.log(`  Alert ID:   ${colors.dim}${pwaResult.alertId}${colors.reset}`);
    } else {
      console.log(`${colors.red}${colors.bright}✗ PWA report failed!${colors.reset}`);
      console.log(`  Status: ${colors.dim}${pwaResult.status}${colors.reset}`);
      console.log(`  Error:  ${colors.dim}${pwaResult.error}${colors.reset}`);
    }

    // Save trial data
    const trial: ExtendedTrial = {
      experimentId,
      index: i,
      pwaTriggeredAt: Date.now(),
      messageText,
      pwaReportId: pwaResult.reportId,
      pwaAlertId: pwaResult.alertId,
      pwaSuccess: pwaResult.success,
      pwaStatus: pwaResult.status,
      pwaError: pwaResult.error,
    };

    await saveTrial(trial, outputDir);
    trials.push(trial);

    // Wait for webhook processing
    console.log(`\n${colors.yellow}Waiting for webhooks to process...${colors.reset}`);
    for (let j = 3; j > 0; j--) {
      process.stdout.write(`\r${colors.dim}${j}...${colors.reset}  `);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log(`\r${colors.green}✓${colors.reset} Webhook wait complete\n`);

    // Show progress if not last trial
    if (i < count) {
      printProgress(i, count, "Preparing next trial...");
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(); // New line after progress
    }
  }

  // Summary
  console.log(`\n${colors.bright}${colors.magenta}╔══════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}║           Experiment Complete!         ║${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}╚══════════════════════════════════════════╝${colors.reset}\n`);

  const successCount = trials.filter(t => t.pwaSuccess).length;
  const failCount = trials.filter(t => !t.pwaSuccess).length;

  console.log(`${colors.dim}Results:${colors.reset}`);
  console.log(`  ${colors.green}✓${colors.reset} Successful: ${successCount}/${count}`);
  console.log(`  ${colors.red}✗${colors.reset} Failed:     ${failCount}/${count}`);
  console.log(`\n${colors.dim}Data saved to:${colors.reset} ${colors.cyan}${outputDir}/trials.ndjson${colors.reset}\n`);
}

// Run main if executed directly
if (import.meta.main) {
  main().catch((error) => {
    console.error(`${colors.red}Fatal error:${colors.reset}`, error);
    process.exit(1);
  });
}
