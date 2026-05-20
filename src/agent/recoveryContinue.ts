import type { Model } from "@earendil-works/pi-ai";
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
  return runMailTidyPiAgent(
    {
      tasks: deps.tasks,
      checkpoints: deps.checkpoints,
      tools: deps.tools,
      model: deps.model,
    },
    {
      task,
      checkpoint,
      allowHighRiskTools: false,
    },
  );
}
