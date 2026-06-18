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
		expect(typeof record.timestamp).toBe("number");
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
});
