import { createClient } from "redis";
import { REDIS_URL } from "../config";

export const redis = createClient({ url: REDIS_URL });
export const sub = redis.duplicate();

let initialized = false;

export async function initRedis() {
	if (initialized) return;
	initialized = true;

	registerRedisError("[redis]", redis);
	registerRedisError("[redis-sub]", sub);

	await redis.connect();
	await sub.connect();
}

function registerRedisError(label: string, client: ReturnType<typeof createClient>) {
	client.on("error", (err) => console.error(label, err));
}
