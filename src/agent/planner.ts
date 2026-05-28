/**
 * Planning 边界：把 LLM 的 tool-use 输出转成下一步动作。
 */

export interface PlannedStep {
  kind: "tool_call" | "finish";
  toolName?: string;
  arguments?: Record<string, unknown>;
}

export interface ToolUseLike {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface AssistantOutputLike {
  toolCalls?: ToolUseLike[];
  text?: string;
  stopReason?: string;
}

export function planNextStep(output: AssistantOutputLike): PlannedStep {
  const firstTool = output.toolCalls?.[0];
  if (firstTool) {
    return {
      kind: "tool_call",
      toolName: firstTool.name,
      arguments: firstTool.arguments ?? {},
    };
  }

  if (output.stopReason === "toolUse") {
    throw new Error("LLM requested tool use but did not provide a tool call");
  }

  return { kind: "finish" };
}
