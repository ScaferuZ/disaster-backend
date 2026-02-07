export const PORT = Number(process.env.PORT ?? 3000);
export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
export const ML_BASE_URL = process.env.ML_BASE_URL ?? "http://localhost:8000";

function parseBoolEnv(value: string | undefined, fallback: boolean) {
	if (value === undefined) return fallback;
	const normalized = value.trim().toLowerCase();
	if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
		return true;
	}
	if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
		return false;
	}
	return fallback;
}

export const ALERTS_CHANNEL = process.env.ALERTS_CHANNEL ?? "alerts:high";
export const ALERTS_STREAM = process.env.ALERTS_STREAM ?? "alerts:stream";
export const ACKS_STREAM = process.env.ACKS_STREAM ?? "alerts:acks";
export const REPORT_SYNC_STREAM = process.env.REPORT_SYNC_STREAM ?? "reports:sync";
export const REPORT_DEDUPE_PREFIX = process.env.REPORT_DEDUPE_PREFIX ?? "reports:dedupe";
export const PUSH_SUBSCRIPTIONS_HASH = process.env.PUSH_SUBSCRIPTIONS_HASH ?? "alerts:push:subscriptions";
export const ENABLE_SSE_DELIVERY = parseBoolEnv(process.env.ENABLE_SSE_DELIVERY, true);
export const ENABLE_WS_DELIVERY = parseBoolEnv(process.env.ENABLE_WS_DELIVERY, true);
export const ENABLE_PUSH_DELIVERY = parseBoolEnv(process.env.ENABLE_PUSH_DELIVERY, true);

export const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "";
export const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
export const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
