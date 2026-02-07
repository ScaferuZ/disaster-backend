import { Hono } from "hono";
import { redis } from "../lib/redis";
import { ACKS_STREAM } from "../config";
import type { AckInput } from "../types";

const route = new Hono();

route.post("/ack", async (c) => {
	const input = await c.req.json<AckInput>().catch(() => null);
	if (!input) return c.json({ ok: false, error: "Invalid JSON" }, 400);

	if (!input.alertId || typeof input.alertId !== "string") {
		return c.json({ ok: false, error: "alertId required" }, 400);
	}
	if (!input.transport) {
		return c.json({ ok: false, error: "transport required" }, 400);
	}
	if (typeof input.receivedAtClient !== "number" || typeof input.serverTimestamp !== "number") {
		return c.json({
			ok: false,
			error: "receivedAtClient and serverTimestamp must be numbers",
		}, 400);
	}
	if (
		input.ackStage !== undefined &&
		input.ackStage !== "DELIVERED" &&
		input.ackStage !== "OPENED"
	) {
		return c.json({ ok: false, error: "ackStage must be DELIVERED or OPENED" }, 400);
	}

	const receivedAtServer = Date.now();
	const ackStage = input.ackStage ?? "UNSPECIFIED";
	const ackKey = `${input.alertId}:${input.transport}:${ackStage}:${input.clientId ?? "anon"}`;

	const ackEvent = {
		...input,
		ackStage,
		receivedAtServer,
		ackKey,
		endToEndLatencyMs: input.receivedAtClient - input.serverTimestamp,
	};

	await redis.xAdd(ACKS_STREAM, "*", { json: JSON.stringify(ackEvent) });

	return c.json({ ok: true });
});

export default route;
