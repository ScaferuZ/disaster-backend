import { describe, expect, test } from "bun:test";

import { createMockRedis, parseStreamJson } from "./helpers/redis-mock";

describe("bun test harness", () => {
	test("sanity check", () => {
		expect(1 + 1).toBe(2);
	});

	test("parseStreamJson parses XRANGE-like rows", () => {
		const rows = [
			["1-0", ["json", JSON.stringify({ hello: "world" }), "meta", "x"]],
			{ id: "2-0", fields: { json: JSON.stringify({ ok: true }) } },
		] as const;

		expect(parseStreamJson(rows)).toEqual([
			{
				id: "1-0",
				fields: { json: JSON.stringify({ hello: "world" }), meta: "x" },
				parsedJson: { hello: "world" },
			},
			{
				id: "2-0",
				fields: { json: JSON.stringify({ ok: true }) },
				parsedJson: { ok: true },
			},
		]);
	});

	test("createMockRedis records calls and stores values in memory", async () => {
		const redis = createMockRedis();

		expect(await redis.set("k", "v", { NX: true, EX: 10 })).toBe("OK");
		expect(await redis.get("k")).toBe("v");
		expect(await redis.set("k", "v2", { NX: true })).toBeNull();
		expect(await redis.del("k")).toBe(1);

		expect(await redis.hSet("hash", "field", "value")).toBe(1);
		expect(await redis.hVals("hash")).toEqual(["value"]);
		expect(await redis.hDel("hash", "field")).toBe(1);

		expect(await redis.zAdd("z", { score: 10, value: "a" })).toBe(1);
		expect(await redis.zCard("z")).toBe(1);
		expect(await redis.zRemRangeByScore("z", 0, 10)).toBe(1);

		expect(await redis.publish("alerts:high", "{\"ok\":true}" )).toBe(0);

		const streamId = await redis.xAdd("alerts:stream", "*", { json: "{\"a\":1}" });
		expect(redis.calls.xAdd).toEqual([
			{ stream: "alerts:stream", id: streamId, fields: { json: "{\"a\":1}" } },
		]);
	});
});
