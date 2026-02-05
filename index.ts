import { Hono } from "hono";
import { createClient } from "redis";

type PredictionInput = {
	lik_codes: string[];
	level_of_interaction_with_disaster: number;
	age: number;
	usage_duration: number;
	min_frequency_of_usage: number;
	fishing_experience: number;
};

type MlResult = {
	is_high_risk: boolean;
	description: string;
	detected_signs: Array<{ code: string; desc: string }>;
};

const PORT = Number(process.env.PORT ?? 3000);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const ML_BASE_URL = process.env.ML_BASE_URL ?? "http://localhost:8000";

const ALERTS_CHANNEL = process.env.ALERTS_CHANNEL ?? "alerts:high";
const ALERTS_STREAM = process.env.ALERTS_STREAM ?? "alerts:stream";

const app = new Hono();

const redis = createClient({ url: REDIS_URL });
redis.on("error", (err) => console.error("[redis]", err));
await redis.connect();

app.get("/api/health", async (c) => {
	const pong = await redis.ping();
	return c.json({
		ok: true,
		redis: pong,
		mlBaseUrl: ML_BASE_URL,
		ts: Date.now(),
	});
});

app.post("/api/report", async (c) => {
	const input = await c.req.json<PredictionInput>().catch(() => null);
	if (!input) return c.json({ ok: false, error: "Invalid JSON" }, 400);

	// Minimal validation (tighten later with Zod)
	if (!Array.isArray(input.lik_codes) || input.lik_codes.length === 0) {
		return c.json({ ok: false, error: "lik_codes required" }, 400);
	}

	const serverTimestamp = Date.now();
	const reportId = crypto.randomUUID();

	// Call AI/ML /predict
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

	// Thesis rule: “multimodal” in your setup = >3 signs reported
	const isMultisign = input.lik_codes.length > 3;

	// Distribution decision (simple + explainable)
	const shouldDistribute = result.is_high_risk || isMultisign;

	// Canonical event
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

	// Log everything for later analysis
	await redis.xAdd(ALERTS_STREAM, "*", { json: alertJson });

	// Publish only if it should be broadcast
	if (shouldDistribute) {
		await redis.publish(ALERTS_CHANNEL, alertJson);
	}

	// Return enriched response to the submitting client
	return c.json({
		ok: true,
		reportId,
		serverTimestamp,
		shouldDistribute,
		alertEvent,
	});
});

export default {
	port: PORT,
	fetch: app.fetch,
};

