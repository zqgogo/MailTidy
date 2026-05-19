import { describe, expect, it } from "vitest";
import { ActionType, type EmailMessage, type PlannedAction } from "../src/data/models.js";
import { MockEmailConnector } from "../src/integrations/email/mock.js";
import { HeuristicLLMClient } from "../src/integrations/llm/heuristic.js";
import { createMailTidyTools } from "../src/tools/registry.js";

describe("MailTidy tool registry", () => {
  it("registers runnable email, classification, and action tools", async () => {
    const connector = new MockEmailConnector();
    const tools = createMailTidyTools({
      connector,
      llm: new HeuristicLLMClient(),
    });

    expect(tools.map((tool) => tool.name)).toEqual([
      "fetch_recent_email",
      "search_email",
      "classify_email",
      "apply_email_action",
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
});
