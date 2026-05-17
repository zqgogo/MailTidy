/**
 * Reason-Act-Observe 主循环入口（Phase 1 待落地）。
 *
 * 计划做法：包裹 pi 的 `Agent` + `agentLoop` / `agentLoopContinue`，
 * 在以下 pi 事件 / 钩子上挂 MailTidy 自己的关注点：
 *
 *   - beforeToolCall  →  DecisionPolicy 风险闸门 / ask_user 提示
 *   - afterToolCall   →  CheckpointStore.persist + TaskStore.update + 学习信号
 *   - shouldStopAfterTurn  →  ExitDecision 判断（预算 / 步数 / 完成）
 *   - SIGINT          →  agent.abort() + CheckpointStore.persist + TaskStore.markInterrupted
 *
 * Phase 1 把所有 SOP 改成调用本 loop 的入口函数（runCleanupLoop 等），
 * `agent/legacy.ts` 保留为对照实现，验收完成后删除。
 */

import type { CheckpointStore } from "./recovery.js";
import type { JsonTaskStore } from "../data/tasks.js";
import type { LLMRouter } from "../llm/router.js";
import type { EmailConnector } from "../integrations/email/base.js";

export interface AgentLoopDeps {
  router: LLMRouter;
  connector: EmailConnector;
  tasks: JsonTaskStore;
  checkpoints: CheckpointStore;
}

/** Phase 1 占位入口；尚未实现。 */
export async function runAgentLoop(_deps: AgentLoopDeps): Promise<never> {
  throw new Error(
    "agent/loop.ts is a Phase 1 placeholder. " +
      "Until the pi-agent-core wiring lands, SOPs run through agent/legacy.ts.",
  );
}
