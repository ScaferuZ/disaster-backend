export const PORT = Number(process.env.PORT ?? 3000);
export const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
export const ML_BASE_URL = process.env.ML_BASE_URL ?? "http://localhost:8000";

export const ALERTS_CHANNEL = process.env.ALERTS_CHANNEL ?? "alerts:high";
export const ALERTS_STREAM = process.env.ALERTS_STREAM ?? "alerts:stream";
export const ACKS_STREAM = process.env.ACKS_STREAM ?? "alerts:acks";
export const PUSH_SUBSCRIPTIONS_HASH = process.env.PUSH_SUBSCRIPTIONS_HASH ?? "alerts:push:subscriptions";

export const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "";
export const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
export const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
