import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { registerFauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { createMailTidyPiAgent, mailTidySystemPrompt } from "../src/agent/piAgent.js";
import { CheckpointStore, emptyBudget } from "../src/agent/recovery.js";
import { JsonTaskStore } from "../src/data/tasks.js";
import { MockEmailConnector } from "../src/integrations/email/mock.js";
import { HeuristicLLMClient } from "../src/integrations/llm/heuristic.js";
import { createMailTidyTools } from "../src/tools/registry.js";

async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mailtidy-pi-agent-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("createMailTidyPiAgent", () => {
  it("assembles pi Agent state from MailTidy tools and checkpoint messages", async () => {
    const faux = registerFauxProvider();
    try {
      await withTempDir(async (dir) => {
        const tasks = new JsonTaskStore(path.join(dir, "tasks"));
        const checkpoints = new CheckpointStore(path.join(dir, "checkpoints"));
        const task = await tasks.create({ sop: "inbox_cleanup", invocation: {} });
        const tools = createMailTidyTools({
          connector: new MockEmailConnector(),
          llm: new HeuristicLLMClient(),
        });
        const checkpointMessages = [
          { role: "user" as const, content: "continue cleanup", timestamp: Date.now() },
        ];

        const agent = createMailTidyPiAgent({
          model: faux.getModel(),
          task,
          tasks,
          checkpoints,
          budget: emptyBudget(),
          tools,
          checkpointMessages,
        });

        expect(agent.state.systemPrompt).toBe(mailTidySystemPrompt());
        expect(agent.state.tools.map((tool) => tool.name)).toContain("fetch_recent_email");
        expect(agent.state.messages).toEqual(checkpointMessages);
      });
    } finally {
      faux.unregister();
    }
  });
});
