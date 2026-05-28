import { describe, expect, it } from "vitest";
import { planNextStep } from "../src/agent/planner.js";
import {
  createTraceEvent,
  parseTraceJsonLines,
  traceEventToJsonLine,
  traceSliceAroundStep,
} from "../src/agent/trace.js";

describe("trace utilities", () => {
  it("serializes, parses, and slices trace events by step id", () => {
    const events = [
      createTraceEvent("task-1", "turn_start", { at: "2026-05-28T00:00:00.000Z", stepId: "s1" }),
      createTraceEvent("task-1", "tool_call", { at: "2026-05-28T00:00:01.000Z", stepId: "s2" }),
      createTraceEvent("task-1", "tool_result", { at: "2026-05-28T00:00:02.000Z", stepId: "s3" }),
    ];

    const parsed = parseTraceJsonLines(events.map(traceEventToJsonLine).join("\n"));
    expect(parsed).toEqual(events);
    expect(traceSliceAroundStep(parsed, "s2", 1).map((event) => event.stepId)).toEqual(["s1", "s2", "s3"]);
    expect(traceSliceAroundStep(parsed, "missing")).toEqual([]);
  });
});

describe("planner boundary", () => {
  it("converts the first tool call into a planned step", () => {
    expect(planNextStep({ toolCalls: [{ name: "fetch_recent_email", arguments: { limit: 5 } }] })).toEqual({
      kind: "tool_call",
      toolName: "fetch_recent_email",
      arguments: { limit: 5 },
    });
  });

  it("finishes when there is no tool call", () => {
    expect(planNextStep({ text: "Done.", stopReason: "stop" })).toEqual({ kind: "finish" });
  });

  it("fails loudly for malformed tool-use output", () => {
    expect(() => planNextStep({ stopReason: "toolUse" })).toThrow("did not provide a tool call");
  });
});
