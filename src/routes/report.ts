import { Hono } from "hono";
import { redis } from "../lib/redis";
import { ALERTS_CHANNEL, ALERTS_STREAM, ML_BASE_URL } from "../config";
import type { MlResult, PredictionInput } from "../types";

const route = new Hono();

route.post("/report", async (c) => {
	const input = await c.req.json<PredictionInput>().catch(() => null);
	if (!input) return c.json({ ok: false, error: "Invalid JSON" }, 400);

	if (!Array.isArray(input.lik_codes) || input.lik_codes.length === 0) {
		return c.json({ ok: false, error: "lik_codes required" }, 400);
	}

	const serverTimestamp = Date.now();
	const reportId = crypto.randomUUID();

	const mlRes = await fetch(`${ML_BASE_URL}/predict`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(input),
	});

	if (!mlRes.ok) {
		const detail = await mlRes.text().catch(() => "");
		return c.json(
			{ ok: false, error: "ML /predict failed", status: mlRes.status, detail },
			502,
		);
	}

	const result = (await mlRes.json()) as MlResult;

	const isMultisign = input.lik_codes.length > 3;
	const shouldDistribute = result.is_high_risk || isMultisign;

	const alertEvent = {
		eventType: "DISASTER_ALERT",
		alertId: crypto.randomUUID(),
		reportId,
		serverTimestamp,
		decision: {
			is_high_risk: result.is_high_risk,
			is_multisign: isMultisign,
			shouldDistribute,
		},
		input: { lik_codes: input.lik_codes },
		ml: result,
	};

	const alertJson = JSON.stringify(alertEvent);

	await redis.xAdd(ALERTS_STREAM, "*", { json: alertJson });

	if (shouldDistribute) {
		await redis.publish(ALERTS_CHANNEL, alertJson);
	}

	return c.json({
		ok: true,
		reportId,
		serverTimestamp,
		shouldDistribute,
		alertEvent,
	});
});

export default route;
