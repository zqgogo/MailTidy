import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { continueRecoveredTask } from "../src/agent/recoveryContinue.js";
import { CheckpointStore, emptyBudget } from "../src/agent/recovery.js";
import { JsonTaskStore } from "../src/data/tasks.js";
import { MockEmailConnector } from "../src/integrations/email/mock.js";
import { HeuristicLLMClient } from "../src/integrations/llm/heuristic.js";
import { createMailTidyTools } from "../src/tools/registry.js";

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mailtidy-recovery-continue-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("continueRecoveredTask", () => {
  it("continues an interrupted task from checkpoint and marks it completed", async () => {
    const faux = registerFauxProvider();
    faux.setResponses([fauxAssistantMessage("Recovered task completed.")]);

    try {
      await withTempDir(async (dir) => {
        const tasks = new JsonTaskStore(path.join(dir, "tasks"));
        const checkpoints = new CheckpointStore(path.join(dir, "checkpoints"));
        const task = await tasks.create({ sop: "inbox_cleanup", invocation: {}, initialPhase: "pi_agent" });
        await tasks.markInterrupted(task, "sigint");
        const checkpoint = {
          taskId: task.taskId,
          messages: [{ role: "user" as const, content: "continue", timestamp: Date.now() }],
          turn: 1,
          budget: emptyBudget(),
          persistedAt: new Date().toISOString(),
        };
        await checkpoints.persist(checkpoint);

        const result = await continueRecoveredTask(
          {
            tasks,
            checkpoints,
            tools: createMailTidyTools({
              connector: new MockEmailConnector(),
              llm: new HeuristicLLMClient(),
            }),
            model: faux.getModel(),
          },
          task,
          checkpoint,
        );

        expect(result.exit.reason).toBe("completed");
        expect(result.finalText).toBe("Recovered task completed.");

        const savedTask = await tasks.load(task.taskId);
        expect(savedTask?.status).toBe("completed");

        const savedCheckpoint = await checkpoints.load(task.taskId);
        expect(savedCheckpoint?.messages).toEqual(result.messages);
        expect(savedCheckpoint?.workingContextDigest).toBe("pi agent run completed");
      });
    } finally {
      faux.unregister();
    }
  });
});
