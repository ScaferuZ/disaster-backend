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
		body?: string;
		fromMe?: boolean;
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
		const normalizedEvent = event === "message"
			? (payload?.fromMe ? "message.sent" : "message.received")
			: event;
		const messageText = payload?.text ?? payload?.body;
		let experimentId: string | null = null;

		if (messageText) {
			experimentId = extractExperimentId(messageText);
			if (experimentId) {
				console.log("[waha-webhook] Extracted experimentId:", experimentId);
			}
		}

		if (normalizedEvent === "message.received") {
			if (!payload?.from || !messageText) {
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
				text: messageText,
				...(experimentId && { experimentId }),
			});

			console.log("[waha-webhook] Logged to whatsapp:incoming stream");
		} else if (normalizedEvent === "message.sent") {
			if (!payload?.to || !messageText) {
				console.log("[waha-webhook] Missing required fields for message.sent");
				return c.json({ success: false, error: "Missing to or text" }, 400);
			}

			await redisClient.xAdd("whatsapp:outgoing", "*", {
				timestamp: String(timestamp),
				to: payload.to,
				text: messageText,
				...(experimentId && { experimentId }),
			});
			if (payload.id && experimentId) {
				await redisClient.set(`whatsapp:msg:${payload.id}:experiment`, experimentId, { EX: 86_400 });
			}

			console.log("[waha-webhook] Logged to whatsapp:outgoing stream");
		} else if (normalizedEvent === "message.ack" || normalizedEvent === "message.ack.group") {
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
			console.log("[waha-webhook] Unknown event type:", normalizedEvent);
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
