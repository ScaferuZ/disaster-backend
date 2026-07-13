import { Hono } from "hono";
import { redis } from "../lib/redis";
import { normalizeExperimentId } from "../lib/experiment-utils";

type RedisLike = {
	xAdd: (stream: string, id: string, fields: Record<string, string>) => Promise<unknown>;
	get: (key: string) => Promise<string | null>;
	set: (key: string, value: string, options: { EX: number }) => Promise<unknown>;
};

type WAHAWebhookEvent = {
	event: string;
	session?: string;
	payload?: {
		from?: string;
		to?: string;
		text?: string;
		id?: string;
		timestamp?: number;
		ack?: number; // 1=sent, 2=delivered, 3=read
	};
};

const EXPERIMENT_ID_REGEX = /\[([^\]]+)\]/;

export function extractExperimentId(text: string | undefined | null): string | null {
	if (!text) return null;
	const match = text.match(EXPERIMENT_ID_REGEX);
	return normalizeExperimentId(match?.[1]);
}

export function createWahaWebhookRoute(redisClient: RedisLike = redis) {
	const route = new Hono();
	route.post("/waha/webhook", async (c) => {
	try {
		const body = await c.req.json<WAHAWebhookEvent>().catch(() => null);
		if (!body) {
			console.log("[waha-webhook] Invalid JSON body");
			return c.json({ success: false, error: "Invalid JSON" }, 400);
		}

		const { event, payload } = body;
		console.log("[waha-webhook] Received event:", { event, payload });

		if (!event) {
			console.log("[waha-webhook] Missing event type");
			return c.json({ success: false, error: "Missing event type" }, 400);
		}

		const timestamp = Date.now();
		let experimentId: string | null = null;

		if (payload?.text) {
			experimentId = extractExperimentId(payload.text);
			if (experimentId) {
				console.log("[waha-webhook] Extracted experimentId:", experimentId);
			}
		}

		if (event === "message.received") {
			if (!payload?.from || !payload?.text) {
				console.log("[waha-webhook] Missing required fields for message.received");
				return c.json({ success: false, error: "Missing from or text" }, 400);
			}

			const rawReporterTimestamp = payload.timestamp;
			const reporterTimestamp =
				typeof rawReporterTimestamp === "number" && Number.isFinite(rawReporterTimestamp) && rawReporterTimestamp > 0
					? (rawReporterTimestamp < 1e12 ? rawReporterTimestamp * 1000 : rawReporterTimestamp)
					: timestamp;
			await redisClient.xAdd("whatsapp:incoming", "*", {
				timestamp: String(timestamp),
				reporterTimestamp: String(reporterTimestamp),
				from: payload.from,
				text: payload.text,
				...(experimentId && { experimentId }),
			});

			console.log("[waha-webhook] Logged to whatsapp:incoming stream");
		} else if (event === "message.sent") {
			if (!payload?.to || !payload?.text) {
				console.log("[waha-webhook] Missing required fields for message.sent");
				return c.json({ success: false, error: "Missing to or text" }, 400);
			}

			await redisClient.xAdd("whatsapp:outgoing", "*", {
				timestamp: String(timestamp),
				to: payload.to,
				text: payload.text,
				...(experimentId && { experimentId }),
			});
			if (payload.id && experimentId) {
				await redisClient.set(`whatsapp:msg:${payload.id}:experiment`, experimentId, { EX: 86_400 });
			}

			console.log("[waha-webhook] Logged to whatsapp:outgoing stream");
		} else if (event === "message.ack" || event === "message.ack.group") {
			if (!payload?.id || !payload?.from) {
				console.log("[waha-webhook] Missing required fields for message.ack");
				return c.json({ success: false, error: "Missing id or from" }, 400);
			}

			const ackLevel = Number(payload.ack ?? 0);
			const mappedExperimentId = await redisClient.get(
				`whatsapp:msg:${payload.id}:experiment`,
			);
			experimentId = normalizeExperimentId(mappedExperimentId) ?? experimentId;
			const ackStage = ackLevel === 2 ? "DELIVERED" : ackLevel === 3 ? "READ" : "OTHER";

			await redisClient.xAdd("whatsapp:acks", "*", {
				timestamp: String(timestamp),
				messageId: payload.id,
				chatId: payload.from,
				ack: String(ackLevel),
				experimentId: experimentId ?? "",
				ackStage,
				source: "waha",
			});

			console.log("[waha-webhook] Logged to whatsapp:acks stream, ack level:", ackLevel);
		} else {
			console.log("[waha-webhook] Unknown event type:", event);
			return c.json({ success: false, error: "Unknown event type" }, 400);
		}

		return c.json({ success: true });
	} catch (error) {
		console.error("[waha-webhook] Error:", error);
		return c.json({ success: false, error: "Internal server error" }, 500);
	}
	});
	return route;
}

export default createWahaWebhookRoute();
