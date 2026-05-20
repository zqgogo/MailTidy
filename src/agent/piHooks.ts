import type {
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
  ShouldStopAfterTurnContext,
} from "@earendil-works/pi-agent-core";
import type { TaskRecord } from "../data/tasks.js";
import type { JsonTaskStore } from "../data/tasks.js";
import type { AnyToolDefinition } from "../tools/base.js";
import type { BudgetSnapshot, CheckpointStore } from "./recovery.js";

export interface MailTidyAgentHookDeps {
  task: TaskRecord;
  tasks: JsonTaskStore;
  checkpoints: CheckpointStore;
  budget: BudgetSnapshot;
  tools: AnyToolDefinition[];
  maxSteps?: number;
  allowHighRiskTools?: boolean;
}

export interface MailTidyAgentHooks {
  beforeToolCall(context: BeforeToolCallContext, signal?: AbortSignal): Promise<BeforeToolCallResult | undefined>;
  afterToolCall(context: AfterToolCallContext, signal?: AbortSignal): Promise<AfterToolCallResult | undefined>;
  shouldStopAfterTurn(context: ShouldStopAfterTurnContext): Promise<boolean>;
}

export function createMailTidyAgentHooks(deps: MailTidyAgentHookDeps): MailTidyAgentHooks {
  const toolByName = new Map(deps.tools.map((tool) => [tool.name, tool]));

  return {
    async beforeToolCall(context, signal) {
      if (signal?.aborted) return { block: true, reason: "Task was aborted before tool execution." };
      const tool = toolByName.get(context.toolCall.name);
      if (!tool) return { block: true, reason: `Unknown tool: ${context.toolCall.name}` };
      if (tool.risk === "high" && !deps.allowHighRiskTools) {
        return {
          block: true,
          reason: `High-risk tool "${tool.name}" requires explicit confirmation.`,
        };
      }
      return undefined;
    },

    async afterToolCall(context, signal) {
      deps.budget.steps += 1;
      deps.budget.toolCalls += 1;
      if (context.isError) deps.budget.toolFailures += 1;

      deps.task.progress.phase = `tool:${context.toolCall.name}`;
      deps.task.progress.completed = deps.budget.toolCalls;
      await deps.checkpoints.persist({
        taskId: deps.task.taskId,
        messages: context.context.messages,
        turn: deps.budget.steps,
        budget: deps.budget,
        workingContextDigest: summarizeToolObservation(context.toolCall.name, context.isError),
        persistedAt: new Date().toISOString(),
      });
      await deps.tasks.update(deps.task);

      if (signal?.aborted) return { isError: true };
      return undefined;
    },

    async shouldStopAfterTurn(context) {
      deps.budget.steps += 1;
      await deps.checkpoints.persist({
        taskId: deps.task.taskId,
        messages: context.context.messages,
        turn: deps.budget.steps,
        budget: deps.budget,
        workingContextDigest: `Turn completed with ${context.toolResults.length} tool result(s).`,
        persistedAt: new Date().toISOString(),
      });
      await deps.tasks.update(deps.task);
      return deps.budget.steps >= (deps.maxSteps ?? 12);
    },
  };
}

function summarizeToolObservation(toolName: string, isError: boolean): string {
  return isError ? `Tool ${toolName} failed.` : `Tool ${toolName} completed.`;
}
