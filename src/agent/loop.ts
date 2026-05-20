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

import { emptyBudget, type CheckpointStore } from "./recovery.js";
import type { JsonTaskStore } from "../data/tasks.js";
import type { LLMRouter } from "../llm/router.js";
import type { EmailConnector } from "../integrations/email/base.js";
import { emptyMemory, type AgentMemory } from "../data/memory.js";
import {
  type AgentPlan,
  type EmailJudgment,
  type EmailMessage,
  type ExecutionResult,
  emptyExecutionResult,
} from "../data/models.js";
import { cleanupReport } from "../data/reports.js";
import { createMailTidyTools } from "../tools/registry.js";
import { DecisionPolicy } from "./policies.js";
import { exitFailed, exitInterrupted, exitOk, type ExitDecision } from "./exits.js";

export interface AgentLoopDeps {
  router: LLMRouter;
  connector: EmailConnector;
  tasks: JsonTaskStore;
  checkpoints: CheckpointStore;
  memory?: AgentMemory;
  policy?: DecisionPolicy;
}

export interface RunAgentLoopOptions {
  sop?: "inbox_cleanup";
  hours?: number;
  limit?: number;
  customDimensions?: string[];
  autoConfirm?: boolean;
  dryRun?: boolean;
  maxSteps?: number;
}

export interface AgentLoopResult {
  taskId: string;
  exit: ExitDecision;
  plan: AgentPlan;
  execution: ExecutionResult;
  report: string;
}

/**
 * Phase 1.2 最小主循环。
 *
 * 这版先把 MailTidy 自己的硬约束落地：任务记录先写盘、所有动作走工具注册表、
 * 每个 observe 后 checkpoint、退出时写终态。完整 pi `Agent` tool-use 推理会在
 * 1.3/1.4 把这里的 deterministic planner 替换掉，但外部入口和恢复数据形状保持稳定。
 */
export async function runAgentLoop(
  deps: AgentLoopDeps,
  options: RunAgentLoopOptions = {},
): Promise<AgentLoopResult> {
  const invocation = { sop: "inbox_cleanup", ...options };
  const record = await deps.tasks.create({
    sop: "inbox_cleanup",
    invocation,
    initialPhase: "start",
  });
  const budget = emptyBudget();
  const policy = deps.policy ?? new DecisionPolicy();
  const memory = deps.memory ?? emptyMemory();
  const tools = createMailTidyTools({
    connector: deps.connector,
    llm: deps.router.clientFor("classification"),
    memory,
  });
  const fetchRecent = requireTool(tools, "fetch_recent_email");
  const classifyEmail = requireTool(tools, "classify_email");
  const applyEmailAction = requireTool(tools, "apply_email_action");

  let messages: EmailMessage[] = [];
  let judgments: EmailJudgment[] = [];
  let plan: AgentPlan = { intent: "inbox_cleanup", judgments: [], actions: [], humanPrompts: [] };
  let execution = emptyExecutionResult();
  let report = "";

  try {
    assertStepBudget(budget.steps, options.maxSteps);
    record.progress.phase = "fetch";
    await deps.tasks.update(record);
    messages = (await fetchRecent.invoke({
      hours: options.hours ?? 24,
      limit: options.limit ?? 200,
      unreadOnly: true,
    })) as EmailMessage[];
    budget.steps += 1;
    budget.toolCalls += 1;
    record.progress.completed = 0;
    record.progress.total = messages.length;
    await checkpoint(deps, record.taskId, budget, `Fetched ${messages.length} recent email(s).`);
    await deps.tasks.update(record);

    record.progress.phase = "classify";
    for (const message of messages) {
      assertStepBudget(budget.steps, options.maxSteps);
      const raw = (await classifyEmail.invoke({
        message,
        customDimensions: options.customDimensions ?? [],
      })) as EmailJudgment;
      judgments.push(policy.applyMemory(raw, message.sender, memory));
      budget.steps += 1;
      budget.toolCalls += 1;
      record.progress.completed = judgments.length;
      await checkpoint(
        deps,
        record.taskId,
        budget,
        `Classified ${judgments.length}/${messages.length} email(s).`,
      );
      await deps.tasks.update(record);
    }

    record.progress.phase = "plan";
    plan = policy.buildPlan("inbox_cleanup", judgments);
    budget.steps += 1;
    await checkpoint(deps, record.taskId, budget, `Planned ${plan.actions.length} action group(s).`);
    await deps.tasks.update(record);

    record.progress.phase = "execute";
    execution = emptyExecutionResult(plan.judgments.length);
    for (const action of plan.actions) {
      assertStepBudget(budget.steps, options.maxSteps);
      if (action.requiresConfirmation && !options.autoConfirm) {
        execution.skippedConfirmation += action.emailIds.length;
        execution.notes.push(`skipped ${action.action}: confirmation required`);
        continue;
      }
      const result = (await applyEmailAction.invoke({
        action,
        dryRun: options.dryRun ?? false,
      })) as ExecutionResult;
      mergeExecution(execution, result);
      budget.steps += 1;
      budget.toolCalls += 1;
      record.progress.completedActionIds.push(actionId(action));
      await checkpoint(deps, record.taskId, budget, `Executed ${record.progress.completedActionIds.length}/${plan.actions.length} action group(s).`);
      await deps.tasks.update(record);
    }

    record.progress.phase = "report";
    const newsletters = messages.filter((message) =>
      judgments.some((judgment) => judgment.emailId === message.id && judgment.category === "newsletter"),
    );
    const newsletterSummary = await deps.router.clientFor("summary").summarizeNewsletters(newsletters);
    report = cleanupReport(plan, execution, messages, newsletterSummary);
    await checkpoint(deps, record.taskId, budget, "Report generated.");
    await deps.tasks.markCompleted(record);
    return { taskId: record.taskId, exit: exitOk(), plan, execution, report };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const exit = message.includes("max steps")
      ? exitInterrupted("max_steps_exceeded", message)
      : exitFailed("uncaught_error", message);
    if (exit.recoverable) {
      await deps.tasks.markInterrupted(record, exit.reason);
    } else {
      await deps.tasks.markFailed(record, exit.reason, exit.message);
    }
    return { taskId: record.taskId, exit, plan, execution, report };
  }
}

function requireTool(tools: ReturnType<typeof createMailTidyTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Required tool "${name}" is not registered.`);
  return tool;
}

async function checkpoint(
  deps: Pick<AgentLoopDeps, "checkpoints">,
  taskId: string,
  budget: ReturnType<typeof emptyBudget>,
  digest: string,
): Promise<void> {
  await deps.checkpoints.persist({
    taskId,
    messages: [],
    turn: budget.steps,
    budget,
    workingContextDigest: digest,
    persistedAt: new Date().toISOString(),
  });
}

function assertStepBudget(steps: number, maxSteps = 250): void {
  if (steps >= maxSteps) throw new Error(`max steps exceeded (${steps}/${maxSteps})`);
}

function mergeExecution(target: ExecutionResult, source: ExecutionResult): void {
  target.processed += source.processed;
  target.archived += source.archived;
  target.labeled += source.labeled;
  target.starred += source.starred;
  target.markedRead += source.markedRead;
  target.draftsCreated += source.draftsCreated;
  target.skippedConfirmation += source.skippedConfirmation;
  target.notes.push(...source.notes);
}

function actionId(action: { action: string; label?: string; emailIds: string[] }): string {
  return `${action.action}:${action.label ?? ""}:${action.emailIds.join(",")}`;
}
