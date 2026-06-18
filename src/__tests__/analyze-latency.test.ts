import { describe, expect, test } from "bun:test";

import { partitionLatencies } from "../../scripts/stage6/analyze";

describe("partitionLatencies", () => {
	test("excludes negative values and counts clock-skew anomalies", () => {
		expect(partitionLatencies([10, -5, 20])).toEqual({
			valid: [10, 20],
			negativeLatencyCount: 1,
		});
	});
});
