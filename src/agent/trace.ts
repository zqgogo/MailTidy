/**
 * Trace 事件流：把 pi 的事件（turn_start / tool_execution_start / ...）
 * 转成 MailTidy 友好的可回放结构（Phase 1 占位）。
 *
 * §2.5 "展示思考"开关 (--show-thinking) 会消费这里的事件输出。
 */

export type TraceEventKind =
  | "turn_start"
  | "turn_end"
  | "tool_call"
  | "tool_result"
  | "deep_think_triggered"
  | "checkpoint_written"
  | "exit";

export interface TraceEvent {
  kind: TraceEventKind;
  at: string;
  taskId: string;
  payload?: Record<string, unknown>;
}
