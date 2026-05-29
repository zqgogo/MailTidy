import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { CheckpointStore } from "../src/agent/recovery.js";
import { TraceStore } from "../src/agent/trace.js";
import { runAgentLoop } from "../src/agent/loop.js";
import { Category, type EmailJudgment, type EmailMessage } from "../src/data/models.js";
import { ReportStore } from "../src/data/reports.js";
import { JsonTaskStore } from "../src/data/tasks.js";
import { MockEmailConnector } from "../src/integrations/email/mock.js";
import { HeuristicLLMClient } from "../src/integrations/llm/heuristic.js";
import type { LLMClient, ModelProfile } from "../src/llm/client.js";
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
    reports: new ReportStore(path.join(dir, "reports")),
    traces: new TraceStore(path.join(dir, "traces")),
    stateDir: dir,
  };
}

describe("runAgentLoop", () => {
  it("automates low-risk cleanup actions and asks for higher-risk confirmation by default", async () => {
    await withTempState(async (dir) => {
      const runtime = deps(dir);
      const result = await runAgentLoop(runtime, { limit: 5 });

      expect(result.exit.reason).toBe("completed");
      expect(result.plan.judgments.length).toBeGreaterThan(0);
      expect(result.execution.labeled + result.execution.starred).toBeGreaterThan(0);
      expect(result.execution.archived).toBe(0);
      expect(result.execution.skippedConfirmation).toBeGreaterThan(0);
      expect(result.report).toContain("# MailTidy Cleanup Report");
      expect(result.report).toContain("Confirmation Needed");

      const task = await runtime.tasks.load(result.taskId);
      expect(task?.status).toBe("completed");
      expect(task?.progress.phase).toBe("report");
    });
  });

  it("can require confirmation for medium-risk actions in conservative mode", async () => {
    await withTempState(async (dir) => {
      const runtime = deps(dir);
      const result = await runAgentLoop(runtime, { limit: 5, automationMode: "conservative" });

      expect(result.exit.reason).toBe("completed");
      expect(result.execution.labeled + result.execution.starred).toBeGreaterThan(0);
      expect(result.execution.archived).toBe(0);
      expect(result.execution.skippedConfirmation).toBeGreaterThan(0);
    });
  });

  it("honors learned action preferences that require confirmation", async () => {
    await withTempState(async (dir) => {
      const runtime = {
        ...deps(dir),
        memory: {
          senderPreferences: {},
          actionPreferences: { "label:Newsletters": "confirm" },
          styleProfile: {
            tone: "semi-formal",
            language: "mixed",
            openingPatterns: ["Hi"],
            closingPatterns: ["Best"],
            signature: "",
            brevity: "concise",
          },
          subscriptionHistory: [],
        },
      };
      const result = await runAgentLoop(runtime, { limit: 5 });

      expect(result.exit.reason).toBe("completed");
      expect(result.execution.labeled).toBe(0);
      expect(result.execution.skippedConfirmation).toBeGreaterThanOrEqual(1);
      expect(result.plan.actions.some((action) => action.action === "label" && action.requiresConfirmation)).toBe(true);
    });
  });

  it("executes the cleanup loop after confirmation with task and checkpoint persistence", async () => {
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

      await expect(runtime.reports.read(result.taskId)).resolves.toContain("# MailTidy Cleanup Report");
      const trace = await runtime.traces.load(result.taskId);
      expect(trace.some((event) => event.kind === "checkpoint_written")).toBe(true);
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
      await expect(runtime.reports.read(result.taskId, { partial: true })).resolves.toContain("max steps exceeded");
    });
  });

  it("runs bounded investigation tools before reporting suggested investigations", async () => {
    await withTempState(async (dir) => {
      const runtime = deps(dir);
      runtime.connector.messages.unshift({
        id: "m-risk",
        sender: "security@example.com",
        subject: "Verify your account",
        snippet: "Use https://example-login-security.test/verify today.",
        date: new Date().toISOString(),
        unread: true,
      });

      const result = await runAgentLoop(
        { ...runtime, router: new LLMRouter({ heuristic: new LowConfidenceLLMClient() }) },
        { limit: 1 },
      );

      expect(result.plan.investigationSuggestions?.map((suggestion) => suggestion.trigger)).toEqual([
        "suspicious_link",
        "low_confidence",
      ]);
      expect(result.plan.investigationResults?.map((entry) => entry.toolName)).toEqual([
        "verify_domain",
        "read_original_record",
      ]);
      expect(result.report).toContain("## Suggested Investigations");
      expect(result.report).toContain("## Investigation Results");
      expect(result.report).toContain("verify_domain backend not yet implemented");
    });
  });

  it("runs daily brief through the loop entry-point", async () => {
    await withTempState(async (dir) => {
      const runtime = deps(dir);
      const result = await runAgentLoop(runtime, { sop: "daily_brief", limit: 5 });

      expect(result.exit.reason).toBe("completed");
      expect(result.report).toContain("# MailTidy Daily Brief");
      expect(result.report).toContain("risk=");
      expect(result.report).toContain("confidence=");

      const task = await runtime.tasks.load(result.taskId);
      expect(task?.sop).toBe("daily_brief");
      expect(task?.status).toBe("completed");
    });
  });

  it("runs subscription scan through the loop entry-point", async () => {
    await withTempState(async (dir) => {
      const runtime = deps(dir);
      const result = await runAgentLoop(runtime, { sop: "subscription_scan" });

      expect(result.exit.reason).toBe("completed");
      expect(result.report).toContain("# Subscription Scan");
      expect(result.report).toContain("CSV");

      const task = await runtime.tasks.load(result.taskId);
      expect(task?.sop).toBe("subscription_scan");
      expect(task?.status).toBe("completed");
    });
  });

  it("previews draft replies through the loop entry-point before confirmation", async () => {
    await withTempState(async (dir) => {
      const runtime = deps(dir);
      const result = await runAgentLoop(runtime, { sop: "draft_replies" });

      expect(result.exit.reason).toBe("completed");
      expect(result.execution.draftsCreated).toBe(0);
      expect(result.execution.skippedConfirmation).toBeGreaterThanOrEqual(1);
      expect(result.report).toContain("# Draft Replies Plan");
      expect(result.report).toContain("Run again with `--auto-confirm`");

      const task = await runtime.tasks.load(result.taskId);
      expect(task?.sop).toBe("draft_replies");
      expect(task?.status).toBe("completed");
    });
  });

  it("saves draft replies after explicit confirmation", async () => {
    await withTempState(async (dir) => {
      const runtime = deps(dir);
      const result = await runAgentLoop(runtime, { sop: "draft_replies", autoConfirm: true });

      expect(result.exit.reason).toBe("completed");
      expect(result.execution.draftsCreated).toBeGreaterThanOrEqual(1);
      expect(result.report).toContain("Drafts saved:");

      const task = await runtime.tasks.load(result.taskId);
      expect(task?.sop).toBe("draft_replies");
      expect(task?.status).toBe("completed");
    });
  });

  it("can route runAgentLoop through the pi engine", async () => {
    const faux = registerFauxProvider();
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("fetch_recent_email", { limit: 1, unreadOnly: true }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Pi engine cleanup finished."),
    ]);

    try {
      await withTempState(async (dir) => {
        const runtime = { ...deps(dir), piModel: faux.getModel() };
        const result = await runAgentLoop(runtime, { engine: "pi" });

        expect(result.exit.reason).toBe("completed");
        expect(result.report).toContain("Pi engine cleanup finished");

        const task = await runtime.tasks.load(result.taskId);
        expect(task?.status).toBe("completed");
      });
    } finally {
      faux.unregister();
    }
  });
});

class LowConfidenceLLMClient implements LLMClient {
  readonly profile: ModelProfile = {
    name: "low-confidence-test",
    provider: "test",
    supportsTools: false,
  };

  async classifyEmail(message: EmailMessage): Promise<EmailJudgment> {
    return {
      emailId: message.id,
      category: Category.NOTIFICATION,
      confidence: 0.62,
      urgency: 3,
      reason: "test low confidence",
      actionSuggestion: "review",
    };
  }

  async draftReply(): Promise<string> {
    return "test";
  }

  async summarizeNewsletters(): Promise<string> {
    return "test";
  }
}
