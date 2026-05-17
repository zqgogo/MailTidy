/**
 * Planning 边界：把 LLM 的 tool-use 输出转成下一步动作（Phase 1 占位）。
 */

export interface PlannedStep {
  kind: "tool_call" | "finish";
  toolName?: string;
  arguments?: Record<string, unknown>;
}
