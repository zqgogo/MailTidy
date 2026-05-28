import {
  runAgentLoop as runPiCoreAgentLoop,
  runAgentLoopContinue as runPiCoreAgentLoopContinue,
  type AgentEvent,
  type AgentMessage,
} from "@earendil-works/pi-agent-core";
import type { Message, Model } from "@earendil-works/pi-ai";
import type { TaskRecord } from "../data/tasks.js";
import type { JsonTaskStore } from "../data/tasks.js";
import type { ReportStore } from "../data/reports.js";
import type { AnyToolDefinition } from "../tools/base.js";
import { toPiAgentTools } from "../tools/pi.js";
import { emptyBudget, type AgentCheckpoint, type BudgetSnapshot, type CheckpointStore } from "./recovery.js";
import { exitFailed, exitInterrupted, exitOk, type ExitDecision } from "./exits.js";
import { createMailTidyAgentHooks } from "./piHooks.js";
import { mailTidySystemPrompt } from "./piAgent.js";
import { createTraceEvent, type TraceStore } from "./trace.js";

export interface PiRunnerDeps {
  tasks: JsonTaskStore;
  checkpoints: CheckpointStore;
  tools: AnyToolDefinition[];
  model: Model<any>;
  reports?: ReportStore;
  traces?: TraceStore;
}

export interface RunPiAgentOptions {
  task?: TaskRecord;
  checkpoint?: AgentCheckpoint | null;
  prompt?: string;
  invocation?: Record<string, unknown>;
  maxSteps?: number;
  allowHighRiskTools?: boolean;
}

export interface PiAgentRunResult {
  taskId: string;
  exit: ExitDecision;
  messages: AgentMessage[];
  finalText: string;
}

export async function runMailTidyPiAgent(
  deps: PiRunnerDeps,
  options: RunPiAgentOptions = {},
): Promise<PiAgentRunResult> {
  const task = options.task ?? await deps.tasks.create({
    sop: "inbox_cleanup",
    invocation: options.invocation ?? {},
    initialPhase: "pi_agent",
  });
  const budget = options.checkpoint?.budget ?? emptyBudget();
  const hooks = createMailTidyAgentHooks({
    task,
    tasks: deps.tasks,
    checkpoints: deps.checkpoints,
    budget,
    tools: deps.tools,
    maxSteps: options.maxSteps,
    allowHighRiskTools: options.allowHighRiskTools,
  });

  const context = {
    systemPrompt: mailTidySystemPrompt(),
    messages: (options.checkpoint?.messages ?? []) as AgentMessage[],
    tools: toPiAgentTools(deps.tools),
  };
  const config = {
    model: deps.model,
    convertToLlm: (messages: AgentMessage[]) => messages.filter(isLlmMessage),
    beforeToolCall: hooks.beforeToolCall,
    afterToolCall: hooks.afterToolCall,
    shouldStopAfterTurn: hooks.shouldStopAfterTurn,
    toolExecution: "parallel" as const,
  };

  const events: AgentEvent[] = [];
  try {
    const messages = options.checkpoint
      ? await runPiCoreAgentLoopContinue(context, config, (event) => {
          events.push(event);
        })
      : await runPiCoreAgentLoop(
          [userMessage(options.prompt ?? "Run the MailTidy inbox cleanup workflow.")],
          context,
          config,
          (event) => {
            events.push(event);
          },
        );
    await deps.checkpoints.persist({
      taskId: task.taskId,
      messages,
      turn: budget.steps,
      budget: budgetSnapshot(budget),
      workingContextDigest: "pi agent run completed",
      persistedAt: new Date().toISOString(),
    });
    await persistPiEvents(deps.traces, task.taskId, events);
    const finalText = finalAssistantText(messages);
    await deps.reports?.write(task.taskId, finalText || "pi agent run completed");
    await deps.tasks.markCompleted(task);
    return { taskId: task.taskId, exit: exitOk("pi agent run completed"), messages, finalText };
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const exit = message.includes("max steps")
      ? exitInterrupted("max_steps_exceeded", message)
      : exitFailed("uncaught_error", message);
    if (exit.recoverable) {
      await deps.tasks.markInterrupted(task, exit.reason);
    } else {
      await deps.tasks.markFailed(task, exit.reason, exit.message);
    }
    await persistPiEvents(deps.traces, task.taskId, events);
    await deps.reports?.write(task.taskId, ["# MailTidy Partial Report", "", message].join("\n"), { partial: true });
    return { taskId: task.taskId, exit, messages: context.messages, finalText: "" };
  }
}

function userMessage(content: string): AgentMessage {
  return { role: "user", content, timestamp: Date.now() };
}

function isLlmMessage(message: AgentMessage): message is Message {
  return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}

function finalAssistantText(messages: AgentMessage[]): string {
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  if (!assistant || assistant.role !== "assistant") return "";
  return assistant.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function budgetSnapshot(budget: BudgetSnapshot): BudgetSnapshot {
  return { ...budget };
}

async function persistPiEvents(traces: TraceStore | undefined, taskId: string, events: AgentEvent[]): Promise<void> {
  if (!traces) return;
  for (const [index, event] of events.entries()) {
    await traces.append(createTraceEvent(taskId, event.type as any, {
      stepId: `pi-${index + 1}`,
      payload: event as unknown as Record<string, unknown>,
    }));
  }
}
