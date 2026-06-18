import { describe, expect, test } from "bun:test";

import { ACKS_STREAM } from "../config";
import { buildAckEvent } from "../routes/ack";
import type { AckInput } from "../types";
import { createMockRedis, parseStreamJson } from "./helpers/redis-mock";

describe("buildAckEvent", () => {
	test("stores experimentId from input", () => {
		const input: AckInput = {
			alertId: "alert-1",
			transport: "SSE",
			ackStage: "DELIVERED",
			receivedAtClient: 1_000,
			serverTimestamp: 700,
			experimentId: "EXP-42",
			clientId: "receiver-1",
		};

		const event = buildAckEvent(input, 1_500);

		expect(event.experimentId).toBe("EXP-42");
		expect(event.ackStage).toBe("DELIVERED");
		expect(event.receivedAtServer).toBe(1_500);
		expect(event.ackKey).toBe("alert-1:SSE:DELIVERED:receiver-1");
		expect(event.endToEndLatencyMs).toBe(300);
	});

	test("defaults experimentId to null when absent", () => {
		const input: AckInput = {
			alertId: "alert-2",
			transport: "WS",
			receivedAtClient: 2_000,
			serverTimestamp: 1_900,
		};

		const event = buildAckEvent(input, 2_100);

		expect(event.experimentId).toBeNull();
		expect(event.ackStage).toBe("UNSPECIFIED");
		expect(event.ackKey).toBe("alert-2:WS:UNSPECIFIED:anon");
		expect(event.endToEndLatencyMs).toBe(100);
	});

	test("ackEvent written to alerts:acks contains experimentId", async () => {
		const mock = createMockRedis();
		const event = buildAckEvent(
			{
				alertId: "alert-3",
				transport: "PUSH",
				ackStage: "OPENED",
				receivedAtClient: 5_000,
				serverTimestamp: 4_000,
				experimentId: "EXP-99",
			},
			5_200,
		);

		await mock.xAdd(ACKS_STREAM, "*", { json: JSON.stringify(event) });

		const [stored] = parseStreamJson(
			(mock.state.streams.get(ACKS_STREAM) ?? []).map((row) => ({
				id: row.id,
				fields: row.fields,
			})),
		);
		expect(stored?.parsedJson).toMatchObject({
			alertId: "alert-3",
			experimentId: "EXP-99",
			ackStage: "OPENED",
		});
	});
});
