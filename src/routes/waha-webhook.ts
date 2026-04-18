import { Hono } from "hono";
import { redis } from "../lib/redis";

const route = new Hono();

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

const EXPERIMENT_ID_REGEX = /\[([A-Z0-9-]+)\]/;

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
			const match = payload.text.match(EXPERIMENT_ID_REGEX);
			if (match && match[1]) {
				experimentId = match[1];
				console.log("[waha-webhook] Extracted experimentId:", experimentId);
			}
		}

		if (event === "message.received") {
			if (!payload?.from || !payload?.text) {
				console.log("[waha-webhook] Missing required fields for message.received");
				return c.json({ success: false, error: "Missing from or text" }, 400);
			}

			await redis.xAdd("whatsapp:incoming", "*", {
				timestamp: String(timestamp),
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

			await redis.xAdd("whatsapp:outgoing", "*", {
				timestamp: String(timestamp),
				to: payload.to,
				text: payload.text,
				...(experimentId && { experimentId }),
			});

			console.log("[waha-webhook] Logged to whatsapp:outgoing stream");
		} else if (event === "message.ack" || event === "message.ack.group") {
			if (!payload?.id || !payload?.from) {
				console.log("[waha-webhook] Missing required fields for message.ack");
				return c.json({ success: false, error: "Missing id or from" }, 400);
			}

			// ack: 1=sent, 2=delivered, 3=read — we only care about delivered (2)
			const ackLevel = payload.ack ?? 0;

			await redis.xAdd("whatsapp:acks", "*", {
				timestamp: String(timestamp),
				messageId: payload.id,
				chatId: payload.from,
				ack: String(ackLevel),
				...(experimentId && { experimentId }),
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

export default route;
