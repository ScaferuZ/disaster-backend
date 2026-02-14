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

function parseCsvEnv(value: string | undefined, fallback: string[]) {
	if (!value) return fallback;
	const items = value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	return items.length > 0 ? items : fallback;
}

export const JWT_AUTH_ENABLED = parseBoolEnv(process.env.JWT_AUTH_ENABLED, false);
export const JWT_SECRET = process.env.JWT_SECRET ?? "";
export const JWT_EXPIRES_SECONDS = Number(process.env.JWT_EXPIRES_SECONDS ?? 86400);
export const JWT_COOKIE_NAME = process.env.JWT_COOKIE_NAME ?? "auth_token";
export const JWT_PUBLIC_PATHS = parseCsvEnv(process.env.JWT_PUBLIC_PATHS, [
	"/api/health",
	"/api/docs",
	"/api/openapi.json",
	"/api/push/vapid-public-key",
	"/api/auth/register",
	"/api/auth/login",
]);
export const AUTH_USER_KEY_PREFIX = process.env.AUTH_USER_KEY_PREFIX ?? "auth:user";
export const AUTH_USER_EMAIL_KEY_PREFIX =
	process.env.AUTH_USER_EMAIL_KEY_PREFIX ?? "auth:user:email";
export const AUTH_USER_IDENTITY_KEY_PREFIX =
	process.env.AUTH_USER_IDENTITY_KEY_PREFIX ?? "auth:user:identity";

if (JWT_AUTH_ENABLED && !JWT_SECRET) {
	throw new Error("JWT_AUTH_ENABLED=true requires JWT_SECRET to be set");
}
if (!Number.isFinite(JWT_EXPIRES_SECONDS) || JWT_EXPIRES_SECONDS <= 0) {
	throw new Error("JWT_EXPIRES_SECONDS must be a positive number");
}
