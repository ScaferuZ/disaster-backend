import {
	sendNotification,
	setVapidDetails,
	type PushSubscription,
} from "web-push";
import {
	PUSH_SUBSCRIPTIONS_HASH,
	VAPID_PRIVATE_KEY,
	VAPID_PUBLIC_KEY,
	VAPID_SUBJECT,
} from "../config";
import { redis } from "./redis";

let pushConfigured = false;

export function initWebPush() {
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

export async function listPushSubscriptions() {
	const rows = await redis.hVals(PUSH_SUBSCRIPTIONS_HASH);
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

export async function sendPushAlertToAll(alertJson: string) {
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

	const subscriptions = await listPushSubscriptions();
	let sent = 0;
	let removed = 0;
	let failed = 0;

	for (const subscription of subscriptions) {
		try {
			await sendNotification(subscription, payload, {
				TTL: 60,
				urgency: "high",
				topic:
					typeof alertEvent.alertId === "string" ? alertEvent.alertId.slice(0, 32) : undefined,
			});
			sent += 1;
		} catch (err) {
			const statusCode = (err as { statusCode?: number }).statusCode;
			if (statusCode === 404 || statusCode === 410) {
				await removePushSubscription(subscription.endpoint);
				removed += 1;
				continue;
			}
			failed += 1;
		}
	}

	return { sent, removed, failed };
}
