import { describe, expect, test } from "bun:test";
import { buildAlertEvent } from "../routes/report";

function eventWithExperimentId(experimentId: unknown) {
  return buildAlertEvent({
    alertId: "alert-1",
    reportId: "report-1",
    serverTimestamp: 1,
    clientReportId: undefined,
    createdAtClient: undefined,
    reporterUserId: null,
    reporterEmail: null,
    mlPayload: { lik_codes: ["wn-1"], beach_location: "pantai_lampuuk", is_active_warning: false, active_warning: [] },
    mlResult: { active_warning: [], sign_description: "rain", community_characteristics: "Actionable", action_recommendation: "return" },
    isMultisign: false,
    isActionable: true,
    shouldDistribute: true,
    experimentId,
  })
}

describe("buildAlertEvent experiment correlation", () => {
  test("preserves a normalized string experiment id in the response event", () => {
    expect(eventWithExperimentId("=PILOT-NET0-WA-001\n").experimentId).toBe("PILOT-NET0-WA-001")
  })

  test.each([[null], [undefined], [123], [false], [{}], [[]]])("preserves the existing null contract for non-string %p", (value) => {
    expect(eventWithExperimentId(value).experimentId).toBeNull()
  })
})
