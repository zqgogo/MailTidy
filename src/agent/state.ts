/**
 * Agent 主循环里流转的可写状态（Phase 1 占位）。
 *
 * 与 pi 的关系：pi 的 `AgentState` 持有 `messages` 和 `tools`；这里的 AgentState
 * 是 pi state 之上的"任务态"封装，多记一份预算 / 阶段 / 工作上下文摘要，
 * 方便 checkpoint 写盘与恢复时重建。
 *
 * Phase 1 主循环落地后再填充字段；当前先暴露最小类型，让 recovery / exits
 * 等模块可以编译通过。
 */

import type { BudgetSnapshot } from "./recovery.js";

export interface AgentState {
  taskId: string;
  /** 当前 SOP 阶段，与 TaskRecord.progress.phase 同步。 */
  phase: string;
  budget: BudgetSnapshot;
  /** pi AgentMessage[] 的同义占位；Phase 1 替换为真正类型。 */
  messages: unknown[];
}

export type BudgetState = BudgetSnapshot;
