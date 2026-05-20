import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { runMailTidyPiAgent } from "../src/agent/piRunner.js";
import { CheckpointStore } from "../src/agent/recovery.js";
import { JsonTaskStore } from "../src/data/tasks.js";
import { MockEmailConnector } from "../src/integrations/email/mock.js";
import { HeuristicLLMClient } from "../src/integrations/llm/heuristic.js";
import { createMailTidyTools } from "../src/tools/registry.js";

async function withRuntime<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mailtidy-pi-runner-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("runMailTidyPiAgent", () => {
  it("runs pi agentLoop with MailTidy tools and persists completion", async () => {
    const faux = registerFauxProvider();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("fetch_recent_email", { limit: 2, unreadOnly: true }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Fetched the recent messages and completed the first pi pass."),
    ]);

    try {
      await withRuntime(async (dir) => {
        const tasks = new JsonTaskStore(path.join(dir, "tasks"));
        const checkpoints = new CheckpointStore(path.join(dir, "checkpoints"));
        const connector = new MockEmailConnector();
        const result = await runMailTidyPiAgent({
          tasks,
          checkpoints,
          model: faux.getModel(),
          tools: createMailTidyTools({
            connector,
            llm: new HeuristicLLMClient(),
          }),
        });

        expect(result.exit.reason).toBe("completed");
        expect(result.finalText).toContain("completed the first pi pass");

        const task = await tasks.load(result.taskId);
        expect(task?.status).toBe("completed");

        const checkpoint = await checkpoints.load(result.taskId);
        expect(checkpoint?.messages.length).toBeGreaterThan(0);
        expect(checkpoint?.budget.toolCalls).toBe(1);
      });
    } finally {
      faux.unregister();
    }
  });
});
