import {
	sendNotification,
	setVapidDetails,
	type PushSubscription,
} from "web-push";
import {
	MOCK_PUSH_SINK_TOKEN,
	MOCK_PUSH_SINK_URL,
	PUSH_DELIVERY_MODE,
	PUSH_DELIVERY_STREAM,
	PUSH_SUBSCRIPTIONS_HASH,
	VAPID_PRIVATE_KEY,
	VAPID_PUBLIC_KEY,
	VAPID_SUBJECT,
} from "../config";
import { redis } from "./redis";

export type PushDeliveryResult = {
	sent: number;
	removed: number;
	failed: number;
};

export type PushDeliveryRecord = {
	timestamp: number;
	startedAt: number;
	completedAt: number;
	durationMs: number;
	throughputPerSecond: number;
	deliveryMode: "real" | "mock";
	alertId: string | null;
	experimentId: string | null;
	sent: number;
	removed: number;
	failed: number;
	totalSubscriptions: number;
};

type PushStreamClient = {
	xAdd: (stream: string, id: string, fields: Record<string, string>) => Promise<unknown>;
	hVals: (key: string) => Promise<string[]>;
	hDel: (key: string, field: string) => Promise<unknown>;
};

type DeliveryError = Error & { statusCode?: number };

type SendNotificationFn = typeof sendNotification;

type PushRuntimeConfig = {
	mode?: "real" | "mock";
	mockSinkUrl?: string;
	mockSinkToken?: string;
};

type SendPushAlertDeps = {
	redis?: PushStreamClient;
	fetchFn?: typeof fetch;
	sendNotificationFn?: SendNotificationFn;
	deliveryMode?: "real" | "mock";
	mockSinkUrl?: string;
	mockSinkToken?: string;
	now?: () => number;
};

export function buildPushDeliveryRecord(
	alertEvent: Record<string, unknown>,
	result: PushDeliveryResult,
	totalSubscriptions: number,
	metadata: {
		startedAt?: number;
		completedAt?: number;
		deliveryMode?: "real" | "mock";
	} = {},
): PushDeliveryRecord {
	const completedAt = metadata.completedAt ?? Date.now();
	const startedAt = metadata.startedAt ?? completedAt;
	const durationMs = Math.max(0, completedAt - startedAt);
	const alertId = typeof alertEvent.alertId === "string" ? alertEvent.alertId : null;
	const experimentId = typeof alertEvent.experimentId === "string" ? alertEvent.experimentId : null;
	return {
		timestamp: completedAt,
		startedAt,
		completedAt,
		durationMs,
		throughputPerSecond: durationMs > 0 ? totalSubscriptions / (durationMs / 1000) : 0,
		deliveryMode: metadata.deliveryMode ?? PUSH_DELIVERY_MODE,
		alertId,
		experimentId,
		sent: result.sent,
		removed: result.removed,
		failed: result.failed,
		totalSubscriptions,
	};
}

let pushConfigured = false;

export function initWebPush(runtime: PushRuntimeConfig = {}) {
	const mode = runtime.mode ?? PUSH_DELIVERY_MODE;
	if (mode === "mock") {
		const sinkUrl = runtime.mockSinkUrl ?? MOCK_PUSH_SINK_URL;
		const sinkToken = runtime.mockSinkToken ?? MOCK_PUSH_SINK_TOKEN;
		if (!sinkUrl || !sinkToken) {
			console.warn("[push] mock sink URL or token missing, push disabled");
			pushConfigured = false;
			return;
		}
		console.log("[push] delivery mode: mock");
		pushConfigured = true;
		return;
	}

	const hasAnyVapid = Boolean(VAPID_SUBJECT || VAPID_PUBLIC_KEY || VAPID_PRIVATE_KEY);
	const hasAllVapid = Boolean(VAPID_SUBJECT && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

	if (!hasAnyVapid) {
		console.warn("[push] VAPID env vars missing, push disabled");
		pushConfigured = false;
		return;
	}
	if (!hasAllVapid) {
		console.warn("[push] partial VAPID env vars found, push disabled");
		pushConfigured = false;
		return;
	}

	setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
	console.log("[push] delivery mode: real");
	pushConfigured = true;
}

export function isPushConfigured() {
	return pushConfigured;
}

export async function savePushSubscription(subscription: PushSubscription) {
	await redis.hSet(
		PUSH_SUBSCRIPTIONS_HASH,
		subscription.endpoint,
		JSON.stringify(subscription),
	);
}

export async function removePushSubscription(endpoint: string) {
	await redis.hDel(PUSH_SUBSCRIPTIONS_HASH, endpoint);
}

export async function listPushSubscriptions(client: { hVals: (key: string) => Promise<string[]> } = redis) {
	const rows = await client.hVals(PUSH_SUBSCRIPTIONS_HASH);
	const subscriptions: PushSubscription[] = [];
	for (const row of rows) {
		try {
			const parsed = JSON.parse(row) as PushSubscription;
			if (parsed.endpoint && parsed.keys?.auth && parsed.keys?.p256dh) {
				subscriptions.push(parsed);
			}
		} catch {
			// skip malformed subscription rows
		}
	}
	return subscriptions;
}

export function isValidPushSubscription(input: unknown): input is PushSubscription {
	if (!input || typeof input !== "object") return false;
	const obj = input as PushSubscription;
	if (typeof obj.endpoint !== "string" || obj.endpoint.length === 0) return false;
	if (!obj.keys || typeof obj.keys !== "object") return false;
	if (typeof obj.keys.auth !== "string" || obj.keys.auth.length === 0) return false;
	if (typeof obj.keys.p256dh !== "string" || obj.keys.p256dh.length === 0) return false;
	return true;
}

async function sendToMockSink(
	subscription: PushSubscription,
	payload: string,
	options: { fetchFn: typeof fetch; sinkUrl: string; sinkToken: string },
) {
	const response = await options.fetchFn(options.sinkUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${options.sinkToken}`,
		},
		body: JSON.stringify({
			endpoint: subscription.endpoint,
			payload: JSON.parse(payload) as unknown,
		}),
	});
	if (!response.ok) {
		const error = new Error(`mock push sink returned HTTP ${response.status}`) as DeliveryError;
		error.statusCode = response.status;
		throw error;
	}
}

export async function sendPushAlertToAll(
	alertJson: string,
	deps: SendPushAlertDeps = {},
) {
	if (!pushConfigured) return { sent: 0, removed: 0, failed: 0 };

	let alertEvent: Record<string, unknown>;
	try {
		alertEvent = JSON.parse(alertJson) as Record<string, unknown>;
	} catch {
		return { sent: 0, removed: 0, failed: 0 };
	}

	const payload = JSON.stringify({
		type: "DISASTER_ALERT",
		title: "Disaster Alert",
		body: "New high-risk alert received.",
		alertEvent,
	});

	const redisClient = deps.redis ?? redis;
	const deliveryMode = deps.deliveryMode ?? PUSH_DELIVERY_MODE;
	const fetchFn = deps.fetchFn ?? globalThis.fetch;
	const sendNotificationFn = deps.sendNotificationFn ?? sendNotification;
	const mockSinkUrl = deps.mockSinkUrl ?? MOCK_PUSH_SINK_URL;
	const mockSinkToken = deps.mockSinkToken ?? MOCK_PUSH_SINK_TOKEN;
	const now = deps.now ?? Date.now;
	const startedAt = now();
	const subscriptions = await listPushSubscriptions(redisClient);
	let sent = 0;
	let removed = 0;
	let failed = 0;

	for (const subscription of subscriptions) {
		try {
			if (deliveryMode === "mock") {
				if (!mockSinkUrl || !mockSinkToken) throw new Error("mock push sink is not configured");
				await sendToMockSink(subscription, payload, {
					fetchFn,
					sinkUrl: mockSinkUrl,
					sinkToken: mockSinkToken,
				});
			} else {
				await sendNotificationFn(subscription, payload, {
					TTL: 60,
					urgency: "high",
					topic:
						typeof alertEvent.alertId === "string" ? alertEvent.alertId.slice(0, 32) : undefined,
				});
			}
			sent += 1;
		} catch (err) {
			const statusCode = (err as DeliveryError).statusCode;
			if (statusCode === 404 || statusCode === 410) {
				await redisClient.hDel(PUSH_SUBSCRIPTIONS_HASH, subscription.endpoint);
				removed += 1;
				continue;
			}
			failed += 1;
		}
	}

	const result = { sent, removed, failed };
	const completedAt = now();
	const record = buildPushDeliveryRecord(alertEvent, result, subscriptions.length, {
		startedAt,
		completedAt,
		deliveryMode,
	});
	try {
		await redisClient.xAdd(PUSH_DELIVERY_STREAM, "*", { json: JSON.stringify(record) });
	} catch (err) {
		console.warn("[push] failed to persist push:delivery record", err);
	}

	return result;
}
