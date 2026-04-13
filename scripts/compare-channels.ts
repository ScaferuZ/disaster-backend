import { WAHA_API_KEY, WAHA_TEST_GROUP_ID } from "../src/config.js";

interface PWAReportBody {
  lik_codes: string[];
  beach_location: string;
  _experimentId?: string;
  _channel: "PWA";
}

interface WAHASendTextBody {
  chatId: string;
  session: string;
  text: string;
}

interface ChannelResult {
  channel: "PWA" | "WhatsApp";
  success: boolean;
  timestamp: string;
  durationMs: number;
  status?: number;
  error?: string;
}

/**
 * Triggers a disaster report through both PWA and WhatsApp channels simultaneously.
 *
 * @param reportText - The disaster report text to send
 * @param experimentId - Optional experiment ID for correlation tracking
 * @returns The experimentId used for this dual-trigger
 */
export async function triggerDualReport(
  reportText: string,
  experimentId?: string
): Promise<string> {
  const expId = experimentId || crypto.randomUUID();
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Starting dual-trigger experiment=${expId}`);

  // Prepare both requests
  const pwaRequest = triggerPWAChannel(reportText, expId);
  const whatsappRequest = triggerWhatsAppChannel(reportText);

  // Execute both requests in parallel
  const results = await Promise.allSettled([
    pwaRequest,
    whatsappRequest,
  ]);

  const endTime = Date.now();
  const totalDuration = endTime - startTime;

  // Process results
  const pwaResult = results[0];
  const whatsappResult = results[1];

  if (pwaResult.status === "fulfilled") {
    console.log(
      `[${new Date().toISOString()}] PWA channel success status=${pwaResult.value.status} durationMs=${pwaResult.value.durationMs}`
    );
  } else {
    console.error(
      `[${new Date().toISOString()}] PWA channel failed error=${pwaResult.reason}`
    );
  }

  if (whatsappResult.status === "fulfilled") {
    console.log(
      `[${new Date().toISOString()}] WhatsApp channel success status=${whatsappResult.value.status} durationMs=${whatsappResult.value.durationMs}`
    );
  } else {
    console.error(
      `[${new Date().toISOString()}] WhatsApp channel failed error=${whatsappResult.reason}`
    );
  }

  console.log(`[${new Date().toISOString()}] Dual-trigger complete experiment=${expId} totalDurationMs=${totalDuration}`);

  return expId;
}

/**
 * Triggers the PWA channel report
 */
async function triggerPWAChannel(
  reportText: string,
  experimentId: string
): Promise<ChannelResult> {
  const startTime = Date.now();

  try {
    const body: PWAReportBody = {
      lik_codes: ["Wn-5"],
      beach_location: "pantai_lampuuk",
      _experimentId: experimentId,
      _channel: "PWA",
    };

    const response = await fetch("https://backend.fruz.cloud/api/report", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return {
      channel: "PWA",
      success: true,
      timestamp: new Date().toISOString(),
      durationMs,
      status: response.status,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      channel: "PWA",
      success: false,
      timestamp: new Date().toISOString(),
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Triggers the WhatsApp channel via WAHA
 */
async function triggerWhatsAppChannel(
  reportText: string
): Promise<ChannelResult> {
  const startTime = Date.now();

  try {
    const body: WAHASendTextBody = {
      chatId: WAHA_TEST_GROUP_ID,
      session: "default",
      text: `!lapor ${reportText}`,
    };

    const response = await fetch("https://waha.fruz.cloud/api/sendText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Api-Key": WAHA_API_KEY,
      },
      body: JSON.stringify(body),
    });

    const durationMs = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    return {
      channel: "WhatsApp",
      success: true,
      timestamp: new Date().toISOString(),
      durationMs,
      status: response.status,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      channel: "WhatsApp",
      success: false,
      timestamp: new Date().toISOString(),
      durationMs,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// CLI interface for direct execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: bun run scripts/compare-channels.ts <reportText> [experimentId]");
    process.exit(1);
  }

  const reportText = args[0];
  const experimentId = args[1];

  try {
    const resultExperimentId = await triggerDualReport(reportText, experimentId);
    console.log(`\nExperiment ID: ${resultExperimentId}`);
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

// Only run main if this file is executed directly
if (import.meta.main) {
  main();
}
