import { describe, expect, test } from "bun:test";

import { WA_SEND_STREAM, WAHA_BROADCAST_GROUPS } from "../config";
import { sendWAAlert } from "../lib/waha";
import { createMockRedis } from "./helpers/redis-mock";

function fakeFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): typeof fetch {
	return impl as unknown as typeof fetch;
}

describe("sendWAAlert logs to whatsapp:send", () => {
	test("SENT: writes one entry per chatId with status SENT, httpStatus, messageId", async () => {
		const mock = createMockRedis();
		const fetchFn = fakeFetch(async () =>
			new Response(JSON.stringify({ id: "wamid.X" }), {
				status: 201,
				headers: { "Content-Type": "application/json" },
			}),
		);

		await sendWAAlert("hello", "EXP-001", { redis: mock, fetchFn });

		const writes = mock.calls.xAdd.filter((c) => c.stream === WA_SEND_STREAM);
		expect(writes).toHaveLength(WAHA_BROADCAST_GROUPS.length);

		for (const w of writes) {
			expect(w.fields.status).toBe("SENT");
			expect(w.fields.httpStatus).toBe("201");
			expect(w.fields.messageId).toBe("wamid.X");
			expect(w.fields.experimentId).toBe("EXP-001");
			expect(w.fields.error).toBe("");
			expect(typeof w.fields.timestamp).toBe("string");
			expect(WAHA_BROADCAST_GROUPS).toContain(w.fields.chatId ?? "");
		}
	});

	test("FAILED (non-ok response): status FAILED with httpStatus and error", async () => {
		const mock = createMockRedis();
		const fetchFn = fakeFetch(async () =>
			new Response("upstream boom", { status: 500 }),
		);

		await sendWAAlert("hello", null, { redis: mock, fetchFn });

		const writes = mock.calls.xAdd.filter((c) => c.stream === WA_SEND_STREAM);
		expect(writes).toHaveLength(WAHA_BROADCAST_GROUPS.length);

		for (const w of writes) {
			expect(w.fields.status).toBe("FAILED");
			expect(w.fields.httpStatus).toBe("500");
			expect(w.fields.messageId).toBe("");
			expect(w.fields.error).toContain("upstream boom");
			expect(w.fields.experimentId).toBe("");
		}
	});

	test("FAILED (thrown error): status FAILED, httpStatus empty, error populated", async () => {
		const mock = createMockRedis();
		const fetchFn = fakeFetch(async () => {
			throw new Error("network down");
		});

		await sendWAAlert("hello", "EXP-9", { redis: mock, fetchFn });

		const writes = mock.calls.xAdd.filter((c) => c.stream === WA_SEND_STREAM);
		expect(writes).toHaveLength(WAHA_BROADCAST_GROUPS.length);

		for (const w of writes) {
			expect(w.fields.status).toBe("FAILED");
			expect(w.fields.httpStatus).toBe("");
			expect(w.fields.error).toContain("network down");
		}
	});

	test("logging failure never aborts the broadcast loop", async () => {
		const throwingRedis = {
			async xAdd() {
				throw new Error("redis down");
			},
		};
		const fetchFn = fakeFetch(async () =>
			new Response(JSON.stringify({ id: "wamid.Y" }), { status: 201 }),
		);

		await expect(
			sendWAAlert("hello", "EXP-2", { redis: throwingRedis, fetchFn }),
		).resolves.toBeUndefined();
	});
});
