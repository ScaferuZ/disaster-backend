import { Hono } from "hono";
import { redis } from "../lib/redis";
import { sendWAAlert } from "../lib/waha";
import { processReport, resetQueues, getActiveWarning, setActiveWarning } from "../lib/crowdsource";
import {
	ALERTS_CHANNEL,
	ALERTS_STREAM,
	ML_BASE_URL,
	REPORT_DEDUPE_PREFIX,
	REPORT_SYNC_STREAM,
	REPORT_WINDOW_MS,
	REPORT_THRESHOLD,
	ACTIVE_WARNING_TTL_SECONDS,
} from "../config";
import { ALLOWED_BEACH_LOCATIONS } from "../types";
import type { MlResult, PredictionInput } from "../types";

const route = new Hono();
const REPORT_DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;
const REPORT_DEDUPE_LOCK_TTL_SECONDS = 30;
const REPORT_DEDUPE_LOCK_WAIT_MS = 2000;
const REPORT_DEDUPE_LOCK_POLL_MS = 100;
const UUID_V4_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReportResponse = {
	ok: true;
	reportId: string;
	serverTimestamp: number;
	shouldDistribute: boolean;
	alertEvent: Record<string, unknown>;
};

async function logReportSyncEvent(event: Record<string, unknown>) {
	await redis.xAdd(REPORT_SYNC_STREAM, "*", { json: JSON.stringify(event) });
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

route.post("/report", async (c) => {
	const jwtPayload = c.get("jwtPayload") as { sub?: unknown; email?: unknown } | undefined;
	const reporterUserId = typeof jwtPayload?.sub === "string" ? jwtPayload.sub : null;
	const reporterEmail = typeof jwtPayload?.email === "string" ? jwtPayload.email : null;

	const input = await c.req.json<PredictionInput>().catch(() => null);
	if (!input) return c.json({ ok: false, error: "Invalid JSON" }, 400);

	if (!Array.isArray(input.lik_codes) || input.lik_codes.length === 0) {
		return c.json({ ok: false, error: "lik_codes required" }, 400);
	}

	if (typeof input.beach_location !== "string" || input.beach_location.trim().length === 0) {
		return c.json({ ok: false, error: "beach_location required" }, 400);
	}
	const beachLocation = input.beach_location.trim().toLowerCase();
	if (!ALLOWED_BEACH_LOCATIONS.includes(beachLocation as (typeof ALLOWED_BEACH_LOCATIONS)[number])) {
		return c.json(
			{
				ok: false,
				error: `beach_location must be one of: ${ALLOWED_BEACH_LOCATIONS.join(", ")}`,
			},
			400,
		);
	}

	if (input.clientReportId !== undefined) {
		if (typeof input.clientReportId !== "string" || !UUID_V4_REGEX.test(input.clientReportId)) {
			return c.json({ ok: false, error: "clientReportId must be a UUID string" }, 400);
		}
	}

	if (input.createdAtClient !== undefined) {
		if (!Number.isFinite(input.createdAtClient) || input.createdAtClient <= 0) {
			return c.json({ ok: false, error: "createdAtClient must be a positive number" }, 400);
		}
	}

	const receivedAtServer = Date.now();
	const clientReportId = input.clientReportId;
	const createdAtClient = input.createdAtClient;
	const syncDelayMs = typeof createdAtClient === "number" ? receivedAtServer - createdAtClient : null;
	const dedupeKey = clientReportId ? `${REPORT_DEDUPE_PREFIX}:${clientReportId}` : null;
	const dedupeLockKey = dedupeKey ? `${dedupeKey}:lock` : null;
	let holdsDedupeLock = false;

	if (dedupeKey) {
		const existing = await redis.get(dedupeKey);
		if (existing) {
			const cached = JSON.parse(existing) as ReportResponse;
			await logReportSyncEvent({
				status: "DEDUPED",
				clientReportId,
				createdAtClient: createdAtClient ?? null,
				receivedAtServer,
				syncDelayMs,
				reportId: cached.reportId,
				alertId: cached.alertEvent.alertId,
			});
			return c.json({ ...cached, deduped: true });
		}

		const lockResult = await redis.set(dedupeLockKey!, "1", {
			NX: true,
			EX: REPORT_DEDUPE_LOCK_TTL_SECONDS,
		});
		holdsDedupeLock = lockResult === "OK";
		if (!holdsDedupeLock) {
			const deadline = Date.now() + REPORT_DEDUPE_LOCK_WAIT_MS;
			while (Date.now() < deadline) {
				const eventual = await redis.get(dedupeKey);
				if (eventual) {
					const cached = JSON.parse(eventual) as ReportResponse;
					await logReportSyncEvent({
						status: "DEDUPED",
						clientReportId,
						createdAtClient: createdAtClient ?? null,
						receivedAtServer: Date.now(),
						syncDelayMs,
						reportId: cached.reportId,
						alertId: cached.alertEvent.alertId,
					});
					return c.json({ ...cached, deduped: true });
				}
				await sleep(REPORT_DEDUPE_LOCK_POLL_MS);
			}

			return c.json(
				{ ok: false, error: "report with this clientReportId is processing, retry shortly" },
				409,
			);
		}
	}

	try {
		const serverTimestamp = Date.now();
		const reportId = crypto.randomUUID();

		// Crowdsource queue: accumulate reports per (beach, code) and check threshold
		const { triggeredCodes } = await processReport(
			beachLocation,
			input.lik_codes,
			REPORT_WINDOW_MS,
			REPORT_THRESHOLD,
		);

		if (triggeredCodes.length === 0) {
			await logReportSyncEvent({
				status: "QUEUED",
				clientReportId: clientReportId ?? null,
				createdAtClient: createdAtClient ?? null,
				receivedAtServer: Date.now(),
				syncDelayMs,
				beachLocation,
				lik_codes: input.lik_codes,
			});
			return c.json({ ok: true, reportId, serverTimestamp, status: "queued" });
		}

		// Threshold hit — reset triggered code queues and proceed to ML
		await resetQueues(beachLocation, triggeredCodes);

		const existingWarning = await getActiveWarning(beachLocation);

		const mlPayload = {
			lik_codes: triggeredCodes,
			beach_location: beachLocation,
			is_active_warning: existingWarning !== null,
			active_warning: existingWarning?.codes ?? [],
		};

		const mlRes = await fetch(`${ML_BASE_URL}/predict`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(mlPayload),
		});

		if (!mlRes.ok) {
			const detail = await mlRes.text().catch(() => "");
			await logReportSyncEvent({
				status: "FAILED_ML",
				clientReportId: clientReportId ?? null,
				createdAtClient: createdAtClient ?? null,
				receivedAtServer: Date.now(),
				syncDelayMs,
				reportId,
				mlStatus: mlRes.status,
			});
			return c.json(
				{ ok: false, error: "ML /predict failed", status: mlRes.status, detail },
				502,
			);
		}

		const result = (await mlRes.json()) as MlResult;

		const isMultisign = triggeredCodes.length > 1;
		const isActionable = result.community_characteristics === "Actionable";
		const shouldDistribute = true;

		const alertEvent = {
			eventType: "DISASTER_ALERT",
			alertId: crypto.randomUUID(),
			reportId,
			serverTimestamp,
			client: {
				clientReportId: clientReportId ?? null,
				createdAtClient: createdAtClient ?? null,
				userId: reporterUserId,
				email: reporterEmail,
			},
			decision: {
				community_characteristics: result.community_characteristics,
				is_multisign: isMultisign,
				is_actionable: isActionable,
				shouldDistribute,
			},
			input: mlPayload,
			ml: result,
		};

		// Store new active warning with 12h TTL
		await setActiveWarning(beachLocation, triggeredCodes, alertEvent.alertId, ACTIVE_WARNING_TTL_SECONDS);

		const alertJson = JSON.stringify(alertEvent);

		// Detect channel and log to experiments:triggers
		const isWA = input._channel === "WA";
		const channel = isWA ? "WHATSAPP" : (input._channel ?? "PWA");

		if (input._experimentId && typeof input._experimentId === "string") {
			await redis.xAdd("experiments:triggers", "*", {
				experimentId: input._experimentId,
				channel,
				triggeredAt: String(Date.now()),
				alertId: alertEvent.alertId,
			});
		} else if (isWA) {
			await redis.xAdd("experiments:triggers", "*", {
				experimentId: "untagged",
				channel,
				triggeredAt: String(Date.now()),
				alertId: alertEvent.alertId,
			});
		}

		await redis.xAdd(ALERTS_STREAM, "*", { json: alertJson });

		console.log("[report] publishing to Redis channel", ALERTS_CHANNEL, "channel:", channel, "alertId:", alertEvent.alertId);
		await redis.publish(ALERTS_CHANNEL, alertJson);
		console.log("[report] published OK");

		if (channel !== "WHATSAPP") {
			await sendWAAlert(
				`⚠️ PERINGATAN CUACA\n\n${result.action_recommendations}\n\nLokasi Laporan:\n${beachLocation}\n\nMohon berhati-hati saat melaut.`,
			);
		}

		const responsePayload: ReportResponse = {
			ok: true,
			reportId,
			serverTimestamp,
			shouldDistribute,
			alertEvent,
		};

		if (dedupeKey) {
			await redis.set(dedupeKey, JSON.stringify(responsePayload), { EX: REPORT_DEDUPE_TTL_SECONDS });
		}

		await logReportSyncEvent({
			status: "TRIGGERED",
			clientReportId: clientReportId ?? null,
			createdAtClient: createdAtClient ?? null,
			receivedAtServer: Date.now(),
			syncDelayMs,
			reportId,
			alertId: alertEvent.alertId,
			shouldDistribute,
			triggeredCodes,
		});

		return c.json(responsePayload);
	} finally {
		if (holdsDedupeLock && dedupeLockKey) {
			await redis.del(dedupeLockKey);
		}
	}
});

export default route;
