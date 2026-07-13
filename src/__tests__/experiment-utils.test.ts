import { describe, expect, test } from "bun:test";
import { normalizeExperimentId } from "../lib/experiment-utils";

describe("normalizeExperimentId", () => {
  test.each([
    ["=PILOT-NET0-WA-001\n", "PILOT-NET0-WA-001"],
    ["EXP-001", "EXP-001"],
    ["", null],
    [null, null],
    [undefined, null],
    [123, null],
    [false, null],
    ["bad id!", null],
  ])("normalizes %p", (input, expected) => {
    expect(normalizeExperimentId(input)).toBe(expected)
  })
})
