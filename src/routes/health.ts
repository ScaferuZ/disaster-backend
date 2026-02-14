import { Hono } from "hono";
import {
	ACKS_STREAM,
	ALERTS_CHANNEL,
	ALERTS_STREAM,
	AUTH_USER_EMAIL_KEY_PREFIX,
	AUTH_USER_IDENTITY_KEY_PREFIX,
	AUTH_USER_KEY_PREFIX,
	ENABLE_PUSH_DELIVERY,
	ENABLE_SSE_DELIVERY,
	ENABLE_WS_DELIVERY,
	JWT_AUTH_ENABLED,
	JWT_PUBLIC_PATHS,
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
				authUsers: AUTH_USER_KEY_PREFIX,
				authUserEmailIndex: AUTH_USER_EMAIL_KEY_PREFIX,
				authUserIdentityIndex: AUTH_USER_IDENTITY_KEY_PREFIX,
			},
			delivery: {
				sse: ENABLE_SSE_DELIVERY,
				ws: ENABLE_WS_DELIVERY,
				push: ENABLE_PUSH_DELIVERY,
			},
			auth: {
				enabled: JWT_AUTH_ENABLED,
				publicPaths: JWT_PUBLIC_PATHS,
			},
			push: { configured: isPushConfigured(), subscriptions: pushSubscriptions },
			ts: Date.now(),
		});
	});

export default route;
