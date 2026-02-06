import { Hono } from "hono";
import { ALERTS_CHANNEL, ALERTS_STREAM, ACKS_STREAM, ML_BASE_URL } from "../config";
import { redis } from "../lib/redis";

const route = new Hono();

route.get("/health", async (c) => {
	const pong = await redis.ping();
	return c.json({
		ok: true,
		redis: pong,
		mlBaseUrl: ML_BASE_URL,
		channel: ALERTS_CHANNEL,
		streams: { alerts: ALERTS_STREAM, acks: ACKS_STREAM },
		ts: Date.now(),
	});
});

export default route;
