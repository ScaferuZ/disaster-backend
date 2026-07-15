import { describe, expect, mock, test } from "bun:test";

import { createMockRedis } from "./helpers/redis-mock";

const mockRedis = createMockRedis();

mock.module("../lib/redis", () => ({
	redis: mockRedis,
	sub: {},
	initRedis: async () => {},
}));

const { processReport } = await import("../lib/crowdsource");

const WINDOW_MS = 600_000;

describe("distinct active-warning report evidence", () => {
	test("counts five multi-code submissions as five distinct reports", async () => {
		const beach = "distinct-multi-code";
		const codes = ["wn-1", "wn-2", "wn-3", "wn-4"];
		let result;

		for (let submission = 0; submission < 5; submission += 1) {
			result = await processReport(beach, codes, WINDOW_MS, 5);
		}

		expect(result?.triggeredCodes).toEqual(codes);
		expect(result?.codeCounts).toEqual({ "wn-1": 5, "wn-2": 5, "wn-3": 5, "wn-4": 5 });
		expect(result?.reportCount).toBe(5);
	});

	test("uses the union when triggered code evidence only partially overlaps", async () => {
		const beach = "distinct-partial-overlap";
		for (let submission = 0; submission < 2; submission += 1) {
			await processReport(beach, ["wn-1"], WINDOW_MS, 5);
			await processReport(beach, ["wn-2"], WINDOW_MS, 5);
			await processReport(beach, ["wn-1", "wn-2"], WINDOW_MS, 5);
		}

		const result = await processReport(beach, ["wn-1", "wn-2"], WINDOW_MS, 5);

		expect(result.triggeredCodes).toEqual(["wn-1", "wn-2"]);
		expect(result.codeCounts).toEqual({ "wn-1": 5, "wn-2": 5 });
		expect(result.reportCount).toBe(7);
	});

	test("counts a repeated code only once per submission", async () => {
		const beach = "distinct-duplicate-code";
		const first = await processReport(beach, ["wn-6", "WN-6", "wn-6"], WINDOW_MS, 2);
		const second = await processReport(beach, ["wn-6", "wn-6"], WINDOW_MS, 2);

		expect(first.codeCounts).toEqual({ "wn-6": 1 });
		expect(first.triggeredCodes).toEqual([]);
		expect(second.codeCounts).toEqual({ "wn-6": 2 });
		expect(second.triggeredCodes).toEqual(["wn-6"]);
		expect(second.reportCount).toBe(2);
	});
});
