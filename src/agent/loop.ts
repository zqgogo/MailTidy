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
import type { Model } from "@earendil-works/pi-ai";
import type { JsonTaskStore } from "../data/tasks.js";
import type { LLMRouter } from "../llm/router.js";
import type { EmailConnector } from "../integrations/email/base.js";
import { emptyMemory, type AgentMemory } from "../data/memory.js";
import {
  ActionType,
  type AgentPlan,
  Category,
  defaultStyleProfile,
  type EmailJudgment,
  type EmailMessage,
  type ExecutionResult,
  emptyExecutionResult,
} from "../data/models.js";
import {
  cleanupReport,
  dailyBrief,
  type SubscriptionRow,
  subscriptionsCsv,
  subscriptionsMarkdown,
} from "../data/reports.js";
import { createMailTidyTools } from "../tools/registry.js";
import { DecisionPolicy } from "./policies.js";
import { exitFailed, exitInterrupted, exitOk, type ExitDecision } from "./exits.js";
import { runMailTidyPiAgent } from "./piRunner.js";

export interface AgentLoopDeps {
  router: LLMRouter;
  connector: EmailConnector;
  tasks: JsonTaskStore;
  checkpoints: CheckpointStore;
  memory?: AgentMemory;
  policy?: DecisionPolicy;
  piModel?: Model<any>;
}

export interface RunAgentLoopOptions {
  sop?: "inbox_cleanup" | "daily_brief" | "subscription_scan" | "draft_replies";
  engine?: "deterministic" | "pi";
  hours?: number;
  limit?: number;
  customDimensions?: string[];
  autoConfirm?: boolean;
  dryRun?: boolean;
  maxSteps?: number;
  automationMode?: "conservative" | "balanced" | "aggressive";
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
  if (options.engine === "pi") {
    return runPiBackedAgentLoop(deps, options);
  }

  const sop = options.sop ?? "inbox_cleanup";
  const invocation = { sop, ...options };
  const record = await deps.tasks.create({
    sop,
    invocation,
    initialPhase: "start",
  });
  const budget = emptyBudget();
  const policy = deps.policy ?? new DecisionPolicy({ automationMode: options.automationMode });
  const memory = deps.memory ?? emptyMemory();
  const tools = createMailTidyTools({
    connector: deps.connector,
    llm: deps.router.clientFor("classification"),
    memory,
  });
  const fetchRecent = requireTool(tools, "fetch_recent_email");
  const classifyEmail = requireTool(tools, "classify_email");
  const applyEmailAction = requireTool(tools, "apply_email_action");
  const searchEmail = requireTool(tools, "search_email");

  let messages: EmailMessage[] = [];
  let judgments: EmailJudgment[] = [];
  let plan: AgentPlan = { intent: sop, judgments: [], actions: [], humanPrompts: [] };
  let execution = emptyExecutionResult();
  let report = "";

  try {
    if (sop === "subscription_scan") {
      const scanned = await runSubscriptionScan({
        deps,
        record,
        budget,
        searchEmail,
        memory,
      });
      await deps.tasks.markCompleted(record);
      return { taskId: record.taskId, exit: exitOk(), plan, execution, report: scanned.report };
    }

    assertStepBudget(budget.steps, options.maxSteps);
    record.progress.phase = "fetch";
    await deps.tasks.update(record);
    messages = (await fetchRecent.invoke({
      hours: options.hours ?? (sop === "daily_brief" ? 14 : 24),
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
    plan = policy.buildPlan(sop, judgments, memory);
    budget.steps += 1;
    await checkpoint(deps, record.taskId, budget, `Planned ${plan.actions.length} action group(s).`);
    await deps.tasks.update(record);

    if (sop === "daily_brief") {
      record.progress.phase = "report";
      report = dailyBrief(plan, messages);
      await checkpoint(deps, record.taskId, budget, "Daily brief generated.");
      await deps.tasks.markCompleted(record);
      return { taskId: record.taskId, exit: exitOk(), plan, execution, report };
    }

    if (sop === "draft_replies") {
      record.progress.phase = "execute";
      execution = await runDraftReplies({
        deps,
        record,
        budget,
        messages,
        plan,
        applyEmailAction,
        dryRun: options.dryRun,
        autoConfirm: options.autoConfirm,
      });
      report = draftRepliesReport(execution, record.progress.partialArtifacts?.draftPreviews);
      await checkpoint(deps, record.taskId, budget, "Draft replies generated.");
      await deps.tasks.markCompleted(record);
      return { taskId: record.taskId, exit: exitOk(), plan, execution, report };
    }

    record.progress.phase = "execute";
    execution = emptyExecutionResult();
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

async function runPiBackedAgentLoop(
  deps: AgentLoopDeps,
  options: RunAgentLoopOptions,
): Promise<AgentLoopResult> {
  if (!deps.piModel) {
    throw new Error('runAgentLoop({ engine: "pi" }) requires AgentLoopDeps.piModel.');
  }
  const tools = createMailTidyTools({
    connector: deps.connector,
    llm: deps.router.clientFor("classification"),
    memory: deps.memory ?? emptyMemory(),
  });
  const result = await runMailTidyPiAgent(
    {
      tasks: deps.tasks,
      checkpoints: deps.checkpoints,
      tools,
      model: deps.piModel,
    },
    {
      invocation: { sop: options.sop ?? "inbox_cleanup", ...options },
      maxSteps: options.maxSteps,
      allowHighRiskTools: options.autoConfirm,
    },
  );
  return {
    taskId: result.taskId,
    exit: result.exit,
    plan: { intent: options.sop ?? "inbox_cleanup", judgments: [], actions: [], humanPrompts: [] },
    execution: emptyExecutionResult(),
    report: result.finalText,
  };
}

async function runDraftReplies(args: {
  deps: AgentLoopDeps;
  record: Awaited<ReturnType<JsonTaskStore["create"]>>;
  budget: ReturnType<typeof emptyBudget>;
  messages: EmailMessage[];
  plan: AgentPlan;
  applyEmailAction: ReturnType<typeof requireTool>;
  dryRun?: boolean;
  autoConfirm?: boolean;
}): Promise<ExecutionResult> {
  const actionable = args.messages.filter((message) =>
    args.plan.judgments.some(
      (judgment) => judgment.emailId === message.id && judgment.category === Category.ACTIONABLE,
    ),
  );
  const execution = emptyExecutionResult(actionable.length);
  const previews: Array<{ emailId: string; subject: string; draftBody: string }> = [];
  args.record.progress.total = actionable.length;
  for (const message of actionable) {
    const draftBody = await args.deps.router.clientFor("draft").draftReply(
      message,
      args.deps.memory?.styleProfile ?? defaultStyleProfile(),
    );
    previews.push({ emailId: message.id, subject: message.subject, draftBody });
    if (!args.autoConfirm) {
      execution.skippedConfirmation += 1;
      execution.notes.push(`preview only: draft for ${message.id} requires confirmation`);
      args.budget.steps += 1;
      args.record.progress.completed = previews.length;
      args.record.progress.partialArtifacts = { draftPreviews: previews };
      await checkpoint(args.deps, args.record.taskId, args.budget, `Prepared ${previews.length}/${actionable.length} draft preview(s).`);
      await args.deps.tasks.update(args.record);
      continue;
    }
    const result = (await args.applyEmailAction.invoke({
      action: {
        action: ActionType.DRAFT_REPLY,
        emailIds: [message.id],
        draftBody,
        reason: "actionable email selected by draft_replies SOP",
      },
      dryRun: args.dryRun ?? false,
    })) as ExecutionResult;
    mergeExecution(execution, result);
    args.budget.steps += 1;
    args.budget.toolCalls += 1;
    args.record.progress.completed = execution.draftsCreated;
    args.record.progress.partialArtifacts = { draftPreviews: previews };
    args.record.progress.completedActionIds.push(`draft_reply:${message.id}`);
    await checkpoint(args.deps, args.record.taskId, args.budget, `Drafted ${execution.draftsCreated}/${actionable.length} reply/replies.`);
    await args.deps.tasks.update(args.record);
  }
  return execution;
}

function draftRepliesReport(
  execution: ExecutionResult,
  rawPreviews: unknown,
): string {
  const previews = Array.isArray(rawPreviews)
    ? rawPreviews as Array<{ emailId?: string; subject?: string; draftBody?: string }>
    : [];
  const lines = [
    "# Draft Replies Plan",
    "",
    `- Draft previews: ${previews.length}`,
    `- Drafts saved: ${execution.draftsCreated}`,
    `- Waiting for confirmation: ${execution.skippedConfirmation}`,
  ];
  if (previews.length > 0) {
    lines.push("", "## Proposed Drafts");
    for (const preview of previews) {
      lines.push(
        "",
        `### ${preview.subject ?? preview.emailId ?? "Draft"}`,
        "",
        preview.draftBody ?? "",
      );
    }
  }
  if (execution.skippedConfirmation > 0) {
    lines.push("", "Run again with `--auto-confirm` to save these drafts.");
  }
  return lines.join("\n");
}

function cleanupPlanReport(
  plan: AgentPlan,
  messages: EmailMessage[],
  execution: ExecutionResult,
): string {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const lines = [
    "# MailTidy Cleanup Plan",
    "",
    `- Emails reviewed: ${messages.length}`,
    `- Proposed action groups: ${plan.actions.length}`,
    `- Mailbox writes executed: ${execution.archived + execution.labeled + execution.starred + execution.markedRead}`,
    `- Waiting for confirmation: ${execution.skippedConfirmation}`,
  ];
  if (plan.actions.length > 0) {
    lines.push("", "## Proposed Actions");
    for (const action of plan.actions) {
      lines.push("", `### ${action.action}${action.label ? `: ${action.label}` : ""}`);
      for (const emailId of action.emailIds) {
        const message = byId.get(emailId);
        lines.push(`- ${message ? `${message.sender}: ${message.subject}` : emailId}`);
      }
    }
  }
  if (plan.humanPrompts.length > 0) {
    lines.push("", "## Needs Explicit Confirmation", ...plan.humanPrompts.map((prompt) => `- ${prompt}`));
  }
  lines.push("", "Run again with `--auto-confirm` to execute these cleanup actions.");
  return lines.join("\n");
}

async function runSubscriptionScan(args: {
  deps: AgentLoopDeps;
  record: Awaited<ReturnType<JsonTaskStore["create"]>>;
  budget: ReturnType<typeof emptyBudget>;
  searchEmail: ReturnType<typeof requireTool>;
  memory: AgentMemory;
}): Promise<{ rows: SubscriptionRow[]; report: string }> {
  const queries = [
    '"subscription confirmation"',
    '"payment receipt"',
    '"renewal notice"',
    '"monthly charge"',
    '"your plan"',
    '"billing statement"',
  ];
  const seen = new Map<string, SubscriptionRow>();
  args.record.progress.phase = "search";
  args.record.progress.total = queries.length;
  await args.deps.tasks.update(args.record);
  for (const query of queries) {
    const messages = (await args.searchEmail.invoke({ query, months: 6 })) as EmailMessage[];
    for (const message of messages) {
      const row = extractSubscription(message);
      const key = row.serviceName.toLowerCase();
      const current = seen.get(key);
      if (!current || row.lastChargeDate > current.lastChargeDate) seen.set(key, row);
    }
    args.budget.steps += 1;
    args.budget.toolCalls += 1;
    args.record.progress.completed += 1;
    await checkpoint(args.deps, args.record.taskId, args.budget, `Searched subscription query ${args.record.progress.completed}/${queries.length}.`);
    await args.deps.tasks.update(args.record);
  }
  const rows = [...seen.values()].sort((a, b) => a.serviceName.localeCompare(b.serviceName));
  args.memory.subscriptionHistory.push({
    scannedAt: new Date().toISOString(),
    items: rows as unknown as Record<string, unknown>[],
  });
  const report = `${subscriptionsMarkdown(rows)}\n\nCSV\n\n${subscriptionsCsv(rows)}`;
  await checkpoint(args.deps, args.record.taskId, args.budget, "Subscription scan generated.");
  return { rows, report };
}

function requireTool(tools: ReturnType<typeof createMailTidyTools>, name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Required tool "${name}" is not registered.`);
  return tool;
}

function extractSubscription(message: EmailMessage): SubscriptionRow {
  const text = `${message.subject} ${message.snippet} ${message.body ?? ""}`;
  const amountMatch = text.match(/\$([0-9]+(?:\.[0-9]{2})?)/);
  const amount = amountMatch?.[1] ? parseFloat(amountMatch[1]) : 0;
  const domain = message.sender.split("@")[1] ?? "";
  const service = (domain.split(".")[0] ?? "Unknown").replace(/^./, (c) => c.toUpperCase());
  const planMatch = text.match(/Premium|Plus|Pro|Basic|Team|Enterprise/i);
  return {
    serviceName: service,
    monthlyAmount: amount,
    currency: "USD",
    billingCycle: "monthly",
    lastChargeDate: message.date.slice(0, 10),
    planName: planMatch ? planMatch[0].replace(/^./, (c) => c.toUpperCase()) : "Unknown",
    category: subscriptionCategory(service),
  };
}

function subscriptionCategory(service: string): string {
  const s = service.toLowerCase();
  if (["netflix", "spotify", "hulu"].includes(s)) return "entertainment";
  if (["notion", "github", "slack"].includes(s)) return "productivity";
  return "other";
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
  await maybePauseAfterCheckpoint();
}

async function maybePauseAfterCheckpoint(): Promise<void> {
  const ms = Number.parseInt(process.env.MAILTIDY_TEST_PAUSE_AFTER_CHECKPOINT_MS ?? "", 10);
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
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
