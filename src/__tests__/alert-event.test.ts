import { describe, expect, test } from "bun:test";

import { buildAlertEvent } from "../routes/report";

const mlPayload = {
	lik_codes: ["wn-1", "wn-2"],
	beach_location: "pantai_lampuuk",
	is_active_warning: false,
	active_warning: [],
};

const mlResult = {
	active_warning: ["wn-1"],
	sign_description: "High wind signs",
	community_characteristics: "Actionable",
	action_recommendation: "Stay ashore",
};

function build(overrides: { experimentId?: unknown } = {}) {
	return buildAlertEvent({
		alertId: "alert-1",
		reportId: "report-1",
		serverTimestamp: 1739270400123,
		clientReportId: "11111111-1111-4111-8111-111111111111",
		createdAtClient: 1739270400000,
		reporterUserId: "user-1",
		reporterEmail: "nelayan@example.com",
		mlPayload: { ...mlPayload },
		mlResult,
		isMultisign: true,
		isActionable: true,
		shouldDistribute: true,
		experimentId: overrides.experimentId,
	});
}

describe("buildAlertEvent", () => {
	test("carries a string experimentId from report input", () => {
		const alertEvent = build({ experimentId: "EXP-001" });

		expect(alertEvent.experimentId).toBe("EXP-001");
		expect(JSON.parse(JSON.stringify(alertEvent)).experimentId).toBe("EXP-001");
	});

	test("sets experimentId to null when omitted", () => {
		const alertEvent = build();

		expect(alertEvent.experimentId).toBeNull();
	});

	test("sets experimentId to null when input is not a string", () => {
		const alertEvent = build({ experimentId: 123 });

		expect(alertEvent.experimentId).toBeNull();
	});
});
