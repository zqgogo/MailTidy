import { describe, expect, it } from "vitest";
import { ActionType, type EmailMessage, type PlannedAction } from "../src/data/models.js";
import { emptyMemory } from "../src/data/memory.js";
import { MockEmailConnector } from "../src/integrations/email/mock.js";
import { HeuristicLLMClient } from "../src/integrations/llm/heuristic.js";
import { createMailTidyTools } from "../src/tools/registry.js";

describe("MailTidy tool registry", () => {
  it("registers the minimum tool set (no memory / prompter)", async () => {
    const connector = new MockEmailConnector();
    const tools = createMailTidyTools({
      connector,
      llm: new HeuristicLLMClient(),
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "fetch_recent_email",
      "search_email",
      "classify_email",
      "match_rules",
      "read_trace_slice",
      "read_report_summary",
      "read_original_record",
      "apply_email_action",
      "web_search",
      "verify_domain",
    ]);

    const fetchRecent = tools.find((tool) => tool.name === "fetch_recent_email");
    const messages = await fetchRecent?.invoke({ hours: 24, limit: 5, unreadOnly: true });
    expect(Array.isArray(messages)).toBe(true);
    expect((messages as unknown[]).length).toBeGreaterThan(0);

    const classify = tools.find((tool) => tool.name === "classify_email");
    const judgment = await classify?.invoke({ message: (messages as EmailMessage[])[0] });
    expect((judgment as { category: string }).category).toBeTruthy();
  });

  it("supports dry-run and confirmed mailbox writes through apply_email_action", async () => {
    const connector = new MockEmailConnector();
    const tools = createMailTidyTools({
      connector,
      llm: new HeuristicLLMClient(),
    });
    const apply = tools.find((tool) => tool.name === "apply_email_action");
    expect(apply?.risk).toBe("high");

    const action: PlannedAction = {
      action: ActionType.LABEL,
      emailIds: ["m1"],
      label: "Newsletters",
      reason: "test",
      requiresConfirmation: false,
    };

    const dryRun = await apply?.invoke({ action, dryRun: true });
    expect((dryRun as { notes: string[] }).notes[0]).toContain("dry-run");
    expect(connector.operations).toEqual([]);

    const result = await apply?.invoke({ action });
    expect((result as { labeled: number }).labeled).toBe(1);
    expect(connector.operations).toContain("label:Newsletters:m1");
  });

  it("can include ask_user when a prompter is provided", async () => {
    const tools = createMailTidyTools({
      connector: new MockEmailConnector(),
      llm: new HeuristicLLMClient(),
      prompter: {
        async ask() {
          return "yes";
        },
        async close() {},
      },
    });
    const askUser = tools.find((tool) => tool.name === "ask_user");
    expect(askUser?.risk).toBe("medium");
    await expect(askUser?.invoke({ question: "Archive?" })).resolves.toEqual({ answer: "yes" });
  });

  it("registers memory tools when memory is provided and reads/writes preferences", async () => {
    const memory = emptyMemory();
    const tools = createMailTidyTools({
      connector: new MockEmailConnector(),
      llm: new HeuristicLLMClient(),
      memory,
    });

    const recall = tools.find((tool) => tool.name === "recall_memory");
    const write = tools.find((tool) => tool.name === "write_memory");
    expect(recall?.risk).toBe("low");
    expect(write?.risk).toBe("high");

    // 默认偏好
    const initial = await recall?.invoke({ kind: "sender", sender: "ceo@example.com" });
    expect((initial as { importanceDelta: number }).importanceDelta).toBe(0);

    // 写一条新偏好，再读回来
    await write?.invoke({
      kind: "sender",
      key: "ceo@example.com",
      value: { importanceDelta: 2, preferredAction: "star" },
      learnedFrom: "user_confirmation_2026-05-20",
    });
    const updated = await recall?.invoke({ kind: "sender", sender: "ceo@example.com" });
    expect((updated as { importanceDelta: number }).importanceDelta).toBe(2);
    expect((updated as { preferredAction: string }).preferredAction).toBe("star");
  });

  it("returns Phase-3 stubs for rules / research / history without crashing", async () => {
    const tools = createMailTidyTools({
      connector: new MockEmailConnector(),
      llm: new HeuristicLLMClient(),
    });

    const matchRules = tools.find((tool) => tool.name === "match_rules");
    const ruleResult = (await matchRules?.invoke({
      message: { id: "m1", sender: "a@b", subject: "x", snippet: "y", date: new Date().toISOString() },
    })) as { matched: unknown[]; note?: string };
    expect(ruleResult.matched).toEqual([]);
    expect(ruleResult.note).toContain("not yet implemented");

    const webSearch = tools.find((tool) => tool.name === "web_search");
    expect(webSearch?.risk).toBe("high");
    expect(webSearch?.rateLimit?.perTask).toBe(3);
    const searchResult = (await webSearch?.invoke({ query: "FTX background" })) as {
      results: unknown[];
      note?: string;
    };
    expect(searchResult.results).toEqual([]);
    expect(searchResult.note).toContain("Phase 3");

    const readReport = tools.find((tool) => tool.name === "read_report_summary");
    const reportResult = (await readReport?.invoke({ taskId: "nonexistent-task" })) as {
      content: string | null;
      note?: string;
    };
    expect(reportResult.content).toBeNull();
    expect(reportResult.note).toContain("not found");
  });
});
