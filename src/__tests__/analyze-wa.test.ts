import { describe, expect, test } from "bun:test";

import { collectAckRows, computePwaLatency, parseAckRow } from "../../scripts/analyze-whatsapp-webhooks";

describe("computePwaLatency", () => {
	test("parses XRANGE json ack rows and filters by experimentId", () => {
		const rows = [
			[
				"1-0",
				{
					json: JSON.stringify({
						alertId: "alert-a",
						transport: "SSE",
						experimentId: "exp-a",
						receivedAtClient: 1330,
						serverTimestamp: 1200,
						ackStage: "DELIVERED",
					}),
				},
			],
			[
				"1-1",
				{
					json: JSON.stringify({
						alertId: "alert-b",
						transport: "SSE",
						experimentId: "exp-b",
						receivedAtClient: 1400,
						serverTimestamp: 1200,
						ackStage: "DELIVERED",
					}),
				},
			],
		] as Array<readonly [string, Record<string, string>]>;

		const firstRow = rows[0];
		expect(firstRow).toBeDefined();
		const parsed = parseAckRow(firstRow![1]);
		expect(parsed?.experimentId).toBe("exp-a");
		expect(parsed?.receivedAtClient).toBe(1330);
		expect(collectAckRows(rows, "exp-a")).toHaveLength(1);
		expect(collectAckRows(rows, "exp-a")[0]?.alertId).toBe("alert-a");
	});

	test("matches PWA trigger and ACK by experimentId and alertId", () => {
		const triggers = [
			{
				runId: "run-1",
				alertId: "alert-b",
				channel: "PWA" as const,
				triggeredAt: "900",
				experimentId: "exp-b",
			},
			{
				runId: "run-1",
				alertId: "alert-a",
				channel: "PWA" as const,
				triggeredAt: "1000",
				experimentId: "exp-a",
			},
		];

		const acks = [
			{
				alertId: "alert-a",
				experimentId: "exp-b",
				channel: "PWA" as const,
				receivedAtClient: "5000",
				serverTimestamp: "4800",
				ackStage: "DELIVERED",
			},
			{
				alertId: "alert-a",
				experimentId: "exp-a",
				channel: "PWA" as const,
				receivedAtClient: "1330",
				serverTimestamp: "1200",
				ackStage: "DELIVERED",
			},
		];

		expect(computePwaLatency(triggers, acks, "exp-a")).toBe(330);
	});

	test("returns null when no matching ACK exists for the experimentId", () => {
		const triggers = [
			{
				runId: "run-1",
				alertId: "alert-a",
				channel: "PWA" as const,
				triggeredAt: "1000",
				experimentId: "exp-a",
			},
		];

		const acks = [
			{
				alertId: "alert-a",
				experimentId: "exp-b",
				channel: "PWA" as const,
				receivedAtClient: "1330",
				serverTimestamp: "1200",
				ackStage: "DELIVERED",
			},
			{
				alertId: "alert-b",
				experimentId: "exp-a",
				channel: "PWA" as const,
				receivedAtClient: "1400",
				serverTimestamp: "1200",
				ackStage: "DELIVERED",
			},
		];

		expect(computePwaLatency(triggers, acks, "exp-a")).toBeNull();
	});
});
