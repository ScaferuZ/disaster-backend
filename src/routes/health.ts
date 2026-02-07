import { Hono } from "hono";
import {
	ACKS_STREAM,
	ALERTS_CHANNEL,
	ALERTS_STREAM,
	ML_BASE_URL,
	PUSH_SUBSCRIPTIONS_HASH,
	REPORT_SYNC_STREAM,
} from "../config";
import { isPushConfigured } from "../lib/push";
import { redis } from "../lib/redis";

const route = new Hono();

route.get("/health", async (c) => {
	const pong = await redis.ping();
	const pushSubscriptions = await redis.hLen(PUSH_SUBSCRIPTIONS_HASH);
	return c.json({
		ok: true,
		redis: pong,
		mlBaseUrl: ML_BASE_URL,
		channel: ALERTS_CHANNEL,
		streams: {
			alerts: ALERTS_STREAM,
			acks: ACKS_STREAM,
			reportSync: REPORT_SYNC_STREAM,
			pushSubscriptions: PUSH_SUBSCRIPTIONS_HASH,
		},
		push: { configured: isPushConfigured(), subscriptions: pushSubscriptions },
		ts: Date.now(),
	});
});

export default route;
