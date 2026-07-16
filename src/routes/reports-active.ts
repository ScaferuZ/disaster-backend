import { Hono } from "hono";
import { redis } from "../lib/redis";
import { getActiveWarning } from "../lib/crowdsource";
import { REPORT_WINDOW_MS, REPORT_THRESHOLD } from "../config";
import { apiJwtAuth } from "../middleware/jwtAuth";
import { ALLOWED_BEACH_LOCATIONS, type BeachLocation } from "../types";

const route = new Hono();

function parseBeachLocation(value: string | undefined): BeachLocation | null {
	const normalized = value?.trim().toLowerCase();
	if (!normalized || !ALLOWED_BEACH_LOCATIONS.includes(normalized as BeachLocation)) return null;
	return normalized as BeachLocation;
}

route.get("/reports/active", async (c) => {
	const rawBeachLocation = c.req.query("beach_location");
	const beachLocation = parseBeachLocation(rawBeachLocation);

	if (!rawBeachLocation?.trim()) {
		return c.json({ ok: false, error: "beach_location query param required" }, 400);
	}

	if (!beachLocation) {
		return c.json(
			{
				ok: false,
				error: `beach_location must be one of: ${ALLOWED_BEACH_LOCATIONS.join(", ")}`,
			},
			400,
		);
	}

	const windowStart = Date.now() - REPORT_WINDOW_MS;
	const pattern = `reports:queue:${beachLocation}:*`;
	const keys = await redis.keys(pattern);

	const counts: Record<string, { count: number; triggered: boolean }> = {};

	for (const key of keys) {
		const suffix = key.slice(`reports:queue:${beachLocation}:`.length);
		const code = suffix.toUpperCase();

		const count = await redis.zCount(key, windowStart, "+inf");
		if (count === 0) continue;

		const cooldownKey = `reports:cooldown:${beachLocation}:${suffix}`;
		const cooldownExists = await redis.get(cooldownKey);

		counts[code] = { count, triggered: cooldownExists !== null };
	}

	const activeWarning = await getActiveWarning(beachLocation);

	return c.json({
		ok: true,
		beach_location: beachLocation,
		window_ms: REPORT_WINDOW_MS,
		threshold: REPORT_THRESHOLD,
		counts,
		active_warning: activeWarning,
	});
});

route.delete("/reports/active", apiJwtAuth, async (c) => {
	const rawBeachLocation = c.req.query("beach_location");
	const beachLocation = parseBeachLocation(rawBeachLocation);

	if (!rawBeachLocation?.trim()) {
		return c.json({ ok: false, error: "beach_location query param required" }, 400);
	}
	if (!beachLocation) {
		return c.json(
			{
				ok: false,
				error: `beach_location must be one of: ${ALLOWED_BEACH_LOCATIONS.join(", ")}`,
			},
			400,
		);
	}

	let deleted = 0;
	for (const pattern of [
		`reports:queue:${beachLocation}:*`,
		`reports:cooldown:${beachLocation}:*`,
	]) {
		for await (const keys of redis.scanIterator({ MATCH: pattern, COUNT: 100 })) {
			if (keys.length > 0) deleted += await redis.del(keys);
		}
	}
	deleted += await redis.del(`warnings:active:${beachLocation}`);

	return c.json({ ok: true, beach_location: beachLocation, deleted });
});

export default route;
