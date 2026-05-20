import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { TaskRecord } from "../data/tasks.js";
import type { JsonTaskStore } from "../data/tasks.js";
import type { AnyToolDefinition } from "../tools/base.js";
import { toPiAgentTools } from "../tools/pi.js";
import type { BudgetSnapshot, CheckpointStore } from "./recovery.js";
import { createMailTidyAgentHooks } from "./piHooks.js";

export interface CreateMailTidyPiAgentOptions {
  model: Model<any>;
  task: TaskRecord;
  tasks: JsonTaskStore;
  checkpoints: CheckpointStore;
  budget: BudgetSnapshot;
  tools: AnyToolDefinition[];
  checkpointMessages?: AgentMessage[];
  maxSteps?: number;
  allowHighRiskTools?: boolean;
}

export function createMailTidyPiAgent(options: CreateMailTidyPiAgentOptions): Agent {
  const hooks = createMailTidyAgentHooks({
    task: options.task,
    tasks: options.tasks,
    checkpoints: options.checkpoints,
    budget: options.budget,
    tools: options.tools,
    maxSteps: options.maxSteps,
    allowHighRiskTools: options.allowHighRiskTools,
  });

  return new Agent({
    initialState: {
      systemPrompt: mailTidySystemPrompt(),
      model: options.model,
      tools: toPiAgentTools(options.tools),
      messages: options.checkpointMessages ?? [],
      thinkingLevel: "off",
    },
    beforeToolCall: hooks.beforeToolCall,
    afterToolCall: hooks.afterToolCall,
    prepareNextTurn: async (signal) => {
      if (signal?.aborted) return undefined;
      return undefined;
    },
    toolExecution: "parallel",
  });
}

export function mailTidySystemPrompt(): string {
  return [
    "You are MailTidy, an email agent.",
    "Work in small reason-act-observe steps.",
    "Prefer low-risk read tools before mailbox writes.",
    "Use evidence from tool results; do not claim actions succeeded unless a tool result says so.",
    "Ask for confirmation before destructive, irreversible, or high-risk actions.",
    "Stop when the task is complete or when uncertainty requires the user.",
  ].join("\n");
}
