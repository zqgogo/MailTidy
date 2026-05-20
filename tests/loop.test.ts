import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { CheckpointStore } from "../src/agent/recovery.js";
import { runAgentLoop } from "../src/agent/loop.js";
import { JsonTaskStore } from "../src/data/tasks.js";
import { MockEmailConnector } from "../src/integrations/email/mock.js";
import { HeuristicLLMClient } from "../src/integrations/llm/heuristic.js";
import { LLMRouter } from "../src/llm/router.js";

async function withTempState<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mailtidy-loop-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function deps(dir: string) {
  return {
    connector: new MockEmailConnector(),
    router: new LLMRouter({ heuristic: new HeuristicLLMClient() }),
    tasks: new JsonTaskStore(path.join(dir, "tasks")),
    checkpoints: new CheckpointStore(path.join(dir, "checkpoints")),
  };
}

describe("runAgentLoop", () => {
  it("runs the minimal cleanup loop with task and checkpoint persistence", async () => {
    await withTempState(async (dir) => {
      const runtime = deps(dir);
      const result = await runAgentLoop(runtime, {
        limit: 5,
        autoConfirm: true,
        dryRun: true,
      });

      expect(result.exit.reason).toBe("completed");
      expect(result.plan.judgments.length).toBeGreaterThan(0);
      expect(result.report).toContain("# MailTidy Cleanup Report");

      const task = await runtime.tasks.load(result.taskId);
      expect(task?.status).toBe("completed");
      expect(task?.progress.phase).toBe("report");

      const checkpoint = await runtime.checkpoints.load(result.taskId);
      expect(checkpoint?.turn).toBeGreaterThan(0);
      expect(checkpoint?.workingContextDigest).toContain("Report generated");
    });
  });

  it("marks the task interrupted when step budget is exhausted", async () => {
    await withTempState(async (dir) => {
      const runtime = deps(dir);
      const result = await runAgentLoop(runtime, { maxSteps: 1 });

      expect(result.exit.reason).toBe("max_steps_exceeded");
      expect(result.exit.recoverable).toBe(true);

      const task = await runtime.tasks.load(result.taskId);
      expect(task?.status).toBe("interrupted");
      expect(task?.exitReason).toBe("max_steps_exceeded");
    });
  });
});
