import { Hono } from "hono";
import { ALERTS_STREAM } from "../config";
import { redis } from "../lib/redis";

const route = new Hono();
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const PAGE_SIZE = 100;
const MAX_SCAN_PAGES = 10;

function parseBooleanQuery(raw: string | undefined) {
	if (raw === undefined) return undefined;
	const normalized = raw.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return null;
}

function parseLimit(raw: string | undefined) {
	if (!raw) return DEFAULT_LIMIT;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) return null;
	return Math.min(parsed, MAX_LIMIT);
}

function parseMine(raw: string | undefined) {
	const parsed = parseBooleanQuery(raw);
	if (parsed === undefined || parsed === null) return true;
	return parsed;
}

function parseDistributed(raw: string | undefined) {
	return parseBooleanQuery(raw);
}

route.get("/history", async (c) => {
	const jwtPayload = c.get("jwtPayload") as { sub?: unknown } | undefined;
	const currentUserId = typeof jwtPayload?.sub === "string" ? jwtPayload.sub : null;
	const mine = parseMine(c.req.query("mine"));
	const limit = parseLimit(c.req.query("limit"));
	const distributed = parseDistributed(c.req.query("distributed"));

	if (limit === null) {
		return c.json({ ok: false, error: "limit must be a positive integer" }, 400);
	}

	if (distributed === null) {
		return c.json({ ok: false, error: "distributed must be a boolean" }, 400);
	}

	const items: Array<Record<string, unknown>> = [];
	let start = "+";
	let page = 0;

	while (items.length < limit && page < MAX_SCAN_PAGES) {
		const rows = await redis.xRevRange(ALERTS_STREAM, start, "-", { COUNT: PAGE_SIZE });
		if (rows.length === 0) break;

		for (const row of rows) {
			// XREVRANGE is inclusive. Skip duplicate cursor row when paginating.
			if (start !== "+" && row.id === start) continue;

			const encoded = row.message?.json;
			if (typeof encoded !== "string") continue;

			let alertEvent: Record<string, unknown>;
			try {
				alertEvent = JSON.parse(encoded) as Record<string, unknown>;
			} catch {
				continue;
			}

			const eventClient =
				alertEvent.client && typeof alertEvent.client === "object"
					? (alertEvent.client as Record<string, unknown>)
					: null;
			const eventDecision =
				alertEvent.decision && typeof alertEvent.decision === "object"
					? (alertEvent.decision as Record<string, unknown>)
					: null;
			const eventUserId = typeof eventClient?.userId === "string" ? eventClient.userId : null;
			const eventShouldDistribute =
				typeof eventDecision?.shouldDistribute === "boolean"
					? eventDecision.shouldDistribute
					: null;

			if (mine && currentUserId && eventUserId !== currentUserId) continue;
			if (distributed !== undefined && eventShouldDistribute !== distributed) continue;

			items.push({
				streamId: row.id,
				...alertEvent,
				shouldDistribute: eventShouldDistribute,
			});

			if (items.length >= limit) break;
		}

		start = rows[rows.length - 1]?.id ?? start;
		if (rows.length < PAGE_SIZE) break;
		page += 1;
	}

	return c.json({
		ok: true,
		items,
		count: items.length,
		filter: {
			mine,
			distributed,
			userId: mine ? currentUserId : null,
		},
	});
});

export default route;
