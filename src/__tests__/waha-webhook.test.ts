import { describe, expect, test } from "bun:test";

import { createMockRedis } from "./helpers/redis-mock";
import { createWahaWebhookRoute, extractExperimentId } from "../routes/waha-webhook";

describe("extractExperimentId", () => {
	test("extracts id from tagged text", () => {
		expect(extractExperimentId("Laporan cuaca buruk [EXP-001]")).toBe("EXP-001");
	});

	test("extracts uppercase/numeric/hyphen id", () => {
		expect(extractExperimentId("[WA-3G-R2] pesan uji")).toBe("WA-3G-R2");
	});

	test("returns null when no tag present", () => {
		expect(extractExperimentId("halo tidak ada tag")).toBeNull();
	});

	test("returns null for empty/undefined/null", () => {
		expect(extractExperimentId("")).toBeNull();
		expect(extractExperimentId(undefined)).toBeNull();
		expect(extractExperimentId(null)).toBeNull();
	});

	test("accepts valid lowercase identifiers", () => {
		expect(extractExperimentId("[abc]")).toBe("abc");
	});

	test("normalizes malformed tagged identifiers", () => {
		expect(extractExperimentId("[=PILOT-NET0-WA-001\n]")).toBe("PILOT-NET0-WA-001");
	});
});

describe("WAHA webhook evidence logging", () => {
	test("records normalized reporter timestamp before workflow processing", async () => {
		const mock = createMockRedis();
		const app = createWahaWebhookRoute(mock);
		const response = await app.request("/waha/webhook", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ event: "message.received", payload: { from: "reporter", text: "[=EXP-1\n] rain", timestamp: 1_700_000_000 } }),
		});
		expect(response.status).toBe(200);
		expect(mock.calls.xAdd[0]?.fields).toMatchObject({ reporterTimestamp: "1700000000000", experimentId: "EXP-1" });
	});

	test("accepts the native WAHA message event and body field", async () => {
		const mock = createMockRedis();
		const app = createWahaWebhookRoute(mock);
		const response = await app.request("/waha/webhook", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				event: "message",
				payload: { from: "reporter", fromMe: false, body: "!lapor hujan [EXP-NATIVE]", timestamp: 1_700_000_000 },
			}),
		});
		expect(response.status).toBe(200);
		expect(mock.calls.xAdd[0]).toMatchObject({
			stream: "whatsapp:incoming",
			fields: { reporterTimestamp: "1700000000000", experimentId: "EXP-NATIVE" },
		});
	});

	test("maps n8n-emitted message ids from tagged outbound responses", async () => {
		const mock = createMockRedis();
		const app = createWahaWebhookRoute(mock);
		const response = await app.request("/waha/webhook", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ event: "message.sent", payload: { id: "wamid.n8n", to: "group", text: "[EXP-N8N] warning" } }),
		});
		expect(response.status).toBe(200);
		expect(await mock.get("whatsapp:msg:wamid.n8n:experiment")).toBe("EXP-N8N");
	});

	test.each([[2, "DELIVERED"], [3, "READ"]] as const)("correlates ack:%i as %s", async (ack, ackStage) => {
		const mock = createMockRedis();
		await mock.set("whatsapp:msg:wamid.1:experiment", "=EXP-ACK\n", { EX: 60 });
		const app = createWahaWebhookRoute(mock);
		const response = await app.request("/waha/webhook", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ event: "message.ack", payload: { id: "wamid.1", from: "group", ack } }),
		});
		expect(response.status).toBe(200);
		const fields = mock.calls.xAdd.at(-1)?.fields;
		expect(fields).toMatchObject({ messageId: "wamid.1", ack: String(ack), experimentId: "EXP-ACK", ackStage, source: "waha" });
	});
});
