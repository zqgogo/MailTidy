/**
 * Tool 执行边界：把 plan 落地到具体 tool call，并把 observation merge 回 state（Phase 1 占位）。
 */

export interface ToolObservation {
  toolName: string;
  ok: boolean;
  summary: string;
  payload?: Record<string, unknown>;
}
