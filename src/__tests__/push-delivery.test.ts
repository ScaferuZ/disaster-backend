import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { PUSH_DELIVERY_STREAM } from "../config";
import {
	buildPushDeliveryRecord,
	initWebPush,
	sendPushAlertToAll,
} from "../lib/push";
import { createMockRedis, parseStreamJson } from "./helpers/redis-mock";

describe("buildPushDeliveryRecord", () => {
	test("captures counts, alertId and experimentId from the alert event", () => {
		const record = buildPushDeliveryRecord(
			{ alertId: "alert-1", experimentId: "EXP-001" },
			{ sent: 3, removed: 1, failed: 2 },
			6,
		);

		expect(record.alertId).toBe("alert-1");
		expect(record.experimentId).toBe("EXP-001");
		expect(record.sent).toBe(3);
		expect(record.removed).toBe(1);
		expect(record.failed).toBe(2);
		expect(record.totalSubscriptions).toBe(6);
		expect(record.deliveryMode).toBe("real");
		expect(record.durationMs).toBe(0);
		expect(record.throughputPerSecond).toBe(0);
		expect(typeof record.timestamp).toBe("number");
		expect(record.startedAt).toBe(record.completedAt);
		expect(record.timestamp).toBe(record.completedAt);
	});

	test("calculates mock fan-out duration and throughput", () => {
		const record = buildPushDeliveryRecord(
			{ alertId: "alert-2" },
			{ sent: 4, removed: 0, failed: 1 },
			5,
			{ startedAt: 1_000, completedAt: 3_000, deliveryMode: "mock" },
		);

		expect(record.deliveryMode).toBe("mock");
		expect(record.durationMs).toBe(2_000);
		expect(record.throughputPerSecond).toBe(2.5);
	});

	test("defaults alertId and experimentId to null when missing or non-string", () => {
		const record = buildPushDeliveryRecord(
			{ alertId: 123, experimentId: undefined },
			{ sent: 0, removed: 0, failed: 0 },
			0,
		);

		expect(record.alertId).toBeNull();
		expect(record.experimentId).toBeNull();
	});
});

describe("sendPushAlertToAll persists push:delivery", () => {
	const previousVapid = {
		subject: process.env.VAPID_SUBJECT,
		publicKey: process.env.VAPID_PUBLIC_KEY,
		privateKey: process.env.VAPID_PRIVATE_KEY,
	};

	beforeEach(() => {
		process.env.VAPID_SUBJECT = "mailto:test@example.com";
		process.env.VAPID_PUBLIC_KEY =
			"BJxc2Z1lZ9qXrnq1pQ4Yp3RfQ1H8m6Yy0gqUx9G3oVx2qkqFqQy5G3oVx2qkqFqQy5G3oVx2qkqFqQy5G3oVx2qko";
		process.env.VAPID_PRIVATE_KEY = "aUx9G3oVx2qkqFqQy5G3oVx2qkqFqQy5G3oVx2qkqFo";
	});

	afterEach(() => {
		process.env.VAPID_SUBJECT = previousVapid.subject;
		process.env.VAPID_PUBLIC_KEY = previousVapid.publicKey;
		process.env.VAPID_PRIVATE_KEY = previousVapid.privateKey;
	});

	test("writes one aggregate entry with sent=0 when there are no subscriptions", async () => {
		initWebPush();
		const mock = createMockRedis();

		const alertJson = JSON.stringify({ alertId: "alert-xyz", experimentId: "EXP-7" });
		const result = await sendPushAlertToAll(alertJson, { redis: mock });

		expect(result).toEqual({ sent: 0, removed: 0, failed: 0 });

		const writes = mock.calls.xAdd.filter((call) => call.stream === PUSH_DELIVERY_STREAM);
		expect(writes).toHaveLength(1);

		const [entry] = parseStreamJson(
			(mock.state.streams.get(PUSH_DELIVERY_STREAM) ?? []).map((row) => ({
				id: row.id,
				fields: row.fields,
			})),
		);
		expect(entry?.parsedJson).toMatchObject({
			alertId: "alert-xyz",
			experimentId: "EXP-7",
			sent: 0,
			removed: 0,
			failed: 0,
			totalSubscriptions: 0,
		});
	});

	test("uses the mock sink and records success, expiry, failure, and timing", async () => {
		initWebPush({ mode: "mock", mockSinkUrl: "http://mock-sink/push", mockSinkToken: "secret" });
		const mock = createMockRedis();
		for (const endpoint of ["https://push.test/ok", "https://push.test/expired", "https://push.test/fail"]) {
			await mock.hSet("alerts:push:subscriptions", endpoint, JSON.stringify({
				endpoint,
				keys: { auth: "auth", p256dh: "p256dh" },
			}));
		}

		const requests: Array<{ authorization: string | null; body: unknown }> = [];
		const fetchFn = async (_input: string | URL | Request, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body)) as { endpoint: string };
			requests.push({
				authorization: new Headers(init?.headers).get("authorization"),
				body,
			});
			if (body.endpoint.endsWith("/expired")) return new Response(null, { status: 410 });
			if (body.endpoint.endsWith("/fail")) return new Response(null, { status: 500 });
			return new Response(null, { status: 201 });
		};
		const times = [1_000, 3_000];

		const result = await sendPushAlertToAll(
			JSON.stringify({ alertId: "alert-mock", experimentId: "EXP-MOCK" }),
			{
				redis: mock,
				fetchFn: fetchFn as typeof fetch,
				deliveryMode: "mock",
				mockSinkUrl: "http://mock-sink/push",
				mockSinkToken: "secret",
				now: () => times.shift() ?? 3_000,
			},
		);

		expect(result).toEqual({ sent: 1, removed: 1, failed: 1 });
		expect(requests).toHaveLength(3);
		expect(requests.every((request) => request.authorization === "Bearer secret")).toBe(true);
		expect(mock.calls.hDel).toContainEqual({
			key: "alerts:push:subscriptions",
			field: "https://push.test/expired",
		});

		const [entry] = parseStreamJson(
			(mock.state.streams.get(PUSH_DELIVERY_STREAM) ?? []).map((row) => ({
				id: row.id,
				fields: row.fields,
			})),
		);
		expect(entry?.parsedJson).toMatchObject({
			alertId: "alert-mock",
			experimentId: "EXP-MOCK",
			deliveryMode: "mock",
			startedAt: 1_000,
			completedAt: 3_000,
			durationMs: 2_000,
			throughputPerSecond: 1.5,
			sent: 1,
			removed: 1,
			failed: 1,
			totalSubscriptions: 3,
		});
	});
});
