import { describe, expect, test } from "bun:test";

const workflow = await Bun.file("WAHA - Chatting Template.json").json() as {
  nodes: Array<{ name: string; parameters?: Record<string, any>; onError?: string }>
  connections: Record<string, { main: Array<Array<{ node: string }>> }>
}

function node(name: string) {
  const found = workflow.nodes.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`missing workflow node: ${name}`)
  return found
}

describe("WAHA workflow experiment correlation", () => {
  test.each([
    "Submit shore-location report",
    "Submit location-completed report",
  ])("uses a well-formed experiment parameter in %s", (name) => {
    const parameters = node(name).parameters?.bodyParameters?.parameters as Array<{ name: string; value: string }>
    const experiment = parameters.find((parameter) => parameter.name === "_experimentId")
    expect(experiment).toBeDefined()
    expect(experiment?.value.startsWith("={{")).toBe(true)
    expect(experiment?.value.startsWith("=={{")).toBe(false)
    expect(experiment?.value.endsWith("\n")).toBe(false)
  })

  test.each([
    "Send shore alert broadcast",
    "Send location alert broadcast",
  ])("conditionally emits the outbound experiment tag in %s", (name) => {
    const text = node(name).parameters?.text as string
    expect(text).toContain("alertEvent.experimentId ? '[' +")
    expect(text).toContain("+ '] ' : ''")
    expect(text).not.toContain("[{{")
    expect(text).not.toContain("[null]")
    expect(text).not.toContain("[undefined]")
  })

  test("forwards the original WAHA event to backend evidence logging", () => {
    const forward = node("Forward WAHA evidence")
    expect(forward.parameters?.method).toBe("POST")
    expect(forward.parameters?.url).toBe("https://api.samudraapp.com/api/waha/webhook")
    expect(forward.onError).toBe("continueRegularOutput")

    const body = forward.parameters?.bodyParameters?.parameters as Array<{ name: string; value: string }>
    expect(body).toContainEqual({ name: "event", value: "={{ $json.event }}" })
    expect(body).toContainEqual({ name: "payload", value: "={{ $json.payload }}" })

    const triggerTargets = workflow.connections["WAHA Trigger"]?.main.flat().map(({ node }) => node)
    expect(triggerTargets).toContain("Switch")
    expect(triggerTargets).toContain("Forward WAHA evidence")
  })
})
