import { describe, expect, test } from "bun:test";

import { computeSyncSuccessRate } from "../../scripts/stage6/analyze";

describe("computeSyncSuccessRate", () => {
	test("counts real sync success statuses and FAILED_ML in denominator", () => {
		expect(
			computeSyncSuccessRate({
				TRIGGERED: 3,
				QUEUED: 1,
				FAILED_ML: 1,
			}),
		).toBe(0.8);
	});

	test("keeps legacy ACCEPTED as success", () => {
		expect(computeSyncSuccessRate({ ACCEPTED: 50 })).toBe(1);
	});

	test("returns null when there are no known statuses", () => {
		expect(computeSyncSuccessRate({})).toBeNull();
	});
});
