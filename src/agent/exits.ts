/**
 * Agent 退出条件 / 退出原因 / 收尾约束。
 *
 * 对应设计文档 §2.1.6 退出条件：任何一次 Agent 执行都必须在以下条件之一
 * 被满足时进入"强制收尾"分支，永远不允许向用户抛出未处理异常。
 *
 * 与 pi 的关联：
 *   - 正常停在 turn 边界 → 在 `shouldStopAfterTurn` 中触发 `Completed` / `BudgetExceeded`
 *   - SIGINT / 用户主动停止 → 在 SIGINT handler 中触发 `Sigint` 并调 `agent.abort()`
 *   - LLM 失败兜底 → 在 LLM router catch 后触发 `LlmFallback`
 *   - 工具反复失败 → 在 executor 计数超限后触发 `ToolFailureBudget`
 *   - 死循环 / 步数超限 → loop 内部计步超阈值触发 `MaxStepsExceeded`
 */

export type ExitReason =
  | "completed"
  | "sigint"
  | "max_steps_exceeded"
  | "budget_exceeded"
  | "tool_failure_budget"
  | "llm_fallback"
  | "llm_unavailable"
  | "uncaught_error"
  | "user_cancelled";

export interface ExitDecision {
  reason: ExitReason;
  /** 给报告 / 任务记录用的人话描述。 */
  message: string;
  /** 是否还能恢复（true → 写 interrupted，下次启动可恢复；false → 写 completed 或 failed）。 */
  recoverable: boolean;
}

export function exitOk(message = "Task finished normally."): ExitDecision {
  return { reason: "completed", message, recoverable: false };
}

export function exitInterrupted(reason: ExitReason, message: string): ExitDecision {
  return { reason, message, recoverable: true };
}

export function exitFailed(reason: ExitReason, message: string): ExitDecision {
  return { reason, message, recoverable: false };
}
