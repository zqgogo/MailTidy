/**
 * 中断恢复层：CheckpointStore + 启动时恢复扫描。
 *
 * pi 没有自带 checkpoint。本模块基于 pi 的两个原语自己搭一层：
 *   1. `agent.state.messages` 是可序列化的消息历史 → 可写盘可重建
 *   2. `agentLoopContinue(context, config)` 接受重建好的 context 续跑
 *
 * 工作机制：
 *   - 启动时 `scanInterrupted()` 把所有未收尾任务列出来
 *   - 交互式让用户选 [r]/[c]/[s]/[d]（重跑 / 续跑 / 跳过 / 删除）
 *   - 选 [c] → `loadCheckpoint(taskId)` 取回 messages + invocation，
 *     交给主循环 (Phase 1 落地) 用 `agentLoopContinue` 续跑
 *   - 主循环跑起来后，`persistCheckpoint()` 应在以下时机被调用：
 *       a. `afterToolCall` 钩子（每个工具调用结束）
 *       b. `shouldStopAfterTurn` 钩子（每个 turn 边界）
 *       c. SIGINT handler（abort 之前）
 *
 * 文件结构：每条任务一个 checkpoint 文件，路径 `.mailtidy/checkpoints/<taskId>.json`。
 * 与任务记录分离：taskRecord 是"任务身份和进度"，checkpoint 是"LLM 对话状态"。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { TaskRecord } from "../data/tasks.js";

/**
 * Checkpoint 内容：pi `AgentState.messages` 的快照 + 必要的重建元数据。
 *
 * `messages` 类型用 `unknown[]` 避免在 pi 升级时被 ABI 卡住；
 * 实际类型在 Phase 1 接入 pi 后会用 pi 的 `AgentMessage[]` 收紧。
 */
export interface AgentCheckpoint {
  taskId: string;
  /** pi AgentState.messages 序列化结果，原样返还给 agentLoopContinue。 */
  messages: unknown[];
  /** 当前 turn 序号，主循环计步退出条件用。 */
  turn: number;
  /** 已累计的 token / 调用次数 / 工具失败次数，BudgetState 写盘形式。 */
  budget: BudgetSnapshot;
  /** Working context 摘要（压缩后的长上下文，避免 checkpoint 文件膨胀）。 */
  workingContextDigest?: string;
  /** 写盘时间，给恢复时的"上次心跳"显示用。 */
  persistedAt: string;
}

export interface BudgetSnapshot {
  totalTokens: number;
  toolCalls: number;
  toolFailures: number;
  steps: number;
}

export function emptyBudget(): BudgetSnapshot {
  return { totalTokens: 0, toolCalls: 0, toolFailures: 0, steps: 0 };
}

/**
 * 恢复操作的 4 种选择，对应交互式提问 [r]/[c]/[s]/[d]。
 */
export type RecoveryChoice = "rerun" | "continue" | "skip" | "drop";

export interface RecoveryCandidate {
  task: TaskRecord;
  checkpoint: AgentCheckpoint | null;
}

export class CheckpointStore {
  constructor(private readonly dir: string) {}

  /**
   * 写盘。pi `afterToolCall` / `shouldStopAfterTurn` / SIGINT handler 都应调它。
   * 写是同步的（await）以确保 kill -9 之后下次启动一定能看到最新进度。
   */
  async persist(checkpoint: AgentCheckpoint): Promise<void> {
    await this.ensureDir();
    checkpoint.persistedAt = new Date().toISOString();
    await fs.writeFile(
      this.pathFor(checkpoint.taskId),
      JSON.stringify(checkpoint, null, 2),
      "utf-8",
    );
  }

  async load(taskId: string): Promise<AgentCheckpoint | null> {
    try {
      const raw = await fs.readFile(this.pathFor(taskId), "utf-8");
      return JSON.parse(raw) as AgentCheckpoint;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async purge(taskId: string): Promise<void> {
    await fs.unlink(this.pathFor(taskId)).catch(() => undefined);
  }

  private pathFor(taskId: string): string {
    return path.join(this.dir, `${taskId}.json`);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }
}

/**
 * 解释用户在交互式恢复提示中输入的字母，返回标准化选择。
 * 接受大小写不敏感，空输入或不识别的回退到 "skip"（保守默认）。
 */
export function parseRecoveryChoice(input: string): RecoveryChoice {
  const normalized = input.trim().toLowerCase();
  if (normalized === "r" || normalized === "rerun") return "rerun";
  if (normalized === "c" || normalized === "continue") return "continue";
  if (normalized === "d" || normalized === "drop" || normalized === "delete") return "drop";
  return "skip";
}

/**
 * 把人话提示文本格式化好。CLI 在 startup 时打印。
 */
export function formatRecoveryPrompt(candidate: RecoveryCandidate): string {
  const { task, checkpoint } = candidate;
  const lastSeen = checkpoint?.persistedAt ?? task.updatedAt;
  const turnInfo = checkpoint ? `turn=${checkpoint.turn}` : "no checkpoint";
  return [
    `Unfinished task ${task.taskId.slice(0, 8)} (${task.sop})`,
    `  status=${task.status}  phase=${task.progress.phase}  ${turnInfo}`,
    `  last seen at ${lastSeen}`,
    `  [r] rerun from scratch   [c] continue from checkpoint   [s] skip   [d] drop record`,
  ].join("\n");
}
