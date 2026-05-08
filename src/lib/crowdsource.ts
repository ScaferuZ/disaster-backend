import { redis } from "./redis";

const QUEUE_PREFIX = "reports:queue";
const COOLDOWN_PREFIX = "reports:cooldown";
const WARNING_PREFIX = "warnings:active";

export type ActiveWarning = {
	codes: string[];
	triggeredAt: number;
	alertId: string;
};

/**
 * Adds a report's LIK codes to the crowdsource queue and returns which codes
 * have hit the threshold within the time window.
 */
export async function processReport(
	beachLocation: string,
	likCodes: string[],
	windowMs: number,
	threshold: number,
): Promise<{ triggeredCodes: string[]; codeCounts: Record<string, number> }> {
	const now = Date.now();
	const windowStart = now - windowMs;
	const triggeredCodes: string[] = [];
	const codeCounts: Record<string, number> = {};

	for (const code of likCodes) {
		const key = `${QUEUE_PREFIX}:${beachLocation}:${code.toLowerCase()}`;
		const cooldownKey = `${COOLDOWN_PREFIX}:${beachLocation}:${code}`;

		await redis.zAdd(key, { score: now, value: crypto.randomUUID() });
		await redis.zRemRangeByScore(key, 0, windowStart);
		const count = await redis.zCard(key);

		codeCounts[code] = count;

		if (count >= threshold) {
			const cooldownExists = await redis.get(cooldownKey);
			if (!cooldownExists) {
				triggeredCodes.push(code);
				await redis.set(cooldownKey, "1", { EX: Math.ceil(windowMs / 1000) });
			}
		}
	}

	return { triggeredCodes, codeCounts };
}

/**
 * Clears the queue for each triggered code (per-code reset, not full location reset).
 */
export async function resetQueues(beachLocation: string, codes: string[]): Promise<void> {
	for (const code of codes) {
		const key = `${QUEUE_PREFIX}:${beachLocation}:${code.toLowerCase()}`;
		await redis.del(key);
	}
}

/**
 * Returns the current active warning for a beach location, or null if none exists.
 */
export async function getActiveWarning(beachLocation: string): Promise<ActiveWarning | null> {
	const key = `${WARNING_PREFIX}:${beachLocation}`;
	const val = await redis.get(key);
	if (!val) return null;
	try {
		return JSON.parse(val) as ActiveWarning;
	} catch {
		return null;
	}
}

/**
 * Stores a new active warning for a beach location with a TTL.
 */
export async function setActiveWarning(
	beachLocation: string,
	codes: string[],
	alertId: string,
	ttlSeconds: number,
): Promise<void> {
	const key = `${WARNING_PREFIX}:${beachLocation}`;
	const warning: ActiveWarning = {
		codes,
		triggeredAt: Date.now(),
		alertId,
	};
	await redis.set(key, JSON.stringify(warning), { EX: ttlSeconds });
}
