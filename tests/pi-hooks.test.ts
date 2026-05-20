import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AfterToolCallContext, BeforeToolCallContext, ShouldStopAfterTurnContext } from "@earendil-works/pi-agent-core";
import { createMailTidyAgentHooks } from "../src/agent/piHooks.js";
import { CheckpointStore, emptyBudget } from "../src/agent/recovery.js";
import { JsonTaskStore } from "../src/data/tasks.js";
import { MockEmailConnector } from "../src/integrations/email/mock.js";
import { HeuristicLLMClient } from "../src/integrations/llm/heuristic.js";
import { createMailTidyTools } from "../src/tools/registry.js";

async function withRuntime<T>(run: (runtime: Awaited<ReturnType<typeof runtime>>) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mailtidy-hooks-"));
  try {
    return await run(await runtime(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function runtime(dir: string) {
  const tasks = new JsonTaskStore(path.join(dir, "tasks"));
  const checkpoints = new CheckpointStore(path.join(dir, "checkpoints"));
  const task = await tasks.create({ sop: "inbox_cleanup", invocation: {}, initialPhase: "agent" });
  const tools = createMailTidyTools({
    connector: new MockEmailConnector(),
    llm: new HeuristicLLMClient(),
  });
  return { tasks, checkpoints, task, tools };
}

describe("MailTidy pi agent hooks", () => {
  it("blocks high-risk tools unless explicitly allowed", async () => {
    await withRuntime(async ({ tasks, checkpoints, task, tools }) => {
      const hooks = createMailTidyAgentHooks({
        task,
        tasks,
        checkpoints,
        tools,
        budget: emptyBudget(),
      });

      const decision = await hooks.beforeToolCall({
        toolCall: { type: "toolCall", id: "call-1", name: "apply_email_action", arguments: {} },
      } as BeforeToolCallContext);

      expect(decision).toMatchObject({ block: true });
      expect(decision?.reason).toContain("requires explicit confirmation");
    });
  });

  it("persists task progress and checkpoints after tool calls and turns", async () => {
    await withRuntime(async ({ tasks, checkpoints, task, tools }) => {
      const budget = emptyBudget();
      const hooks = createMailTidyAgentHooks({
        task,
        tasks,
        checkpoints,
        tools,
        budget,
        maxSteps: 2,
        allowHighRiskTools: true,
      });

      await hooks.afterToolCall({
        toolCall: { type: "toolCall", id: "call-1", name: "fetch_recent_email", arguments: {} },
        isError: false,
        context: { systemPrompt: "", messages: [], tools: [] },
      } as AfterToolCallContext);
      const shouldStop = await hooks.shouldStopAfterTurn({
        context: { systemPrompt: "", messages: [], tools: [] },
        toolResults: [],
      } as unknown as ShouldStopAfterTurnContext);

      expect(shouldStop).toBe(true);
      expect(budget.steps).toBe(2);
      expect(budget.toolCalls).toBe(1);

      const savedTask = await tasks.load(task.taskId);
      expect(savedTask?.progress.phase).toBe("tool:fetch_recent_email");

      const checkpoint = await checkpoints.load(task.taskId);
      expect(checkpoint?.turn).toBe(2);
      expect(checkpoint?.workingContextDigest).toContain("Turn completed");
    });
  });
});
