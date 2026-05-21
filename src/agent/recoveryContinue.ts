import type { Model } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { TaskRecord } from "../data/tasks.js";
import type { JsonTaskStore } from "../data/tasks.js";
import type { AnyToolDefinition } from "../tools/base.js";
import type { AgentCheckpoint, CheckpointStore } from "./recovery.js";
import { runMailTidyPiAgent, type PiAgentRunResult } from "./piRunner.js";

export interface ContinueRecoveredTaskDeps {
  tasks: JsonTaskStore;
  checkpoints: CheckpointStore;
  tools: AnyToolDefinition[];
  model: Model<any>;
}

export async function continueRecoveredTask(
  deps: ContinueRecoveredTaskDeps,
  task: TaskRecord,
  checkpoint: AgentCheckpoint,
): Promise<PiAgentRunResult> {
  const normalizedCheckpoint = checkpoint.messages.length > 0
    ? checkpoint
    : {
        ...checkpoint,
        messages: [recoveryUserMessage(task, checkpoint)],
      };
  return runMailTidyPiAgent(
    {
      tasks: deps.tasks,
      checkpoints: deps.checkpoints,
      tools: deps.tools,
      model: deps.model,
    },
    {
      task,
      checkpoint: normalizedCheckpoint,
      allowHighRiskTools: false,
    },
  );
}

function recoveryUserMessage(task: TaskRecord, checkpoint: AgentCheckpoint): AgentMessage {
  return {
    role: "user",
    content: `Continue MailTidy task ${task.taskId} from phase "${task.progress.phase}". Last checkpoint: ${checkpoint.workingContextDigest ?? "none"}.`,
    timestamp: Date.now(),
  };
}
