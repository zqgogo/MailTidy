import { describe, expect, it } from "vitest";
import { ActionType, type PlannedAction } from "../src/data/models.js";
import { MockEmailConnector } from "../src/integrations/email/mock.js";
import { HeuristicLLMClient } from "../src/integrations/llm/heuristic.js";
import { createMailTidyTools } from "../src/tools/registry.js";
import { toPiAgentTool, toPiAgentTools } from "../src/tools/pi.js";

describe("pi tool adapter", () => {
  it("converts MailTidy tools into pi AgentTool shape", async () => {
    const connector = new MockEmailConnector();
    const tools = createMailTidyTools({
      connector,
      llm: new HeuristicLLMClient(),
    });

    const piTools = toPiAgentTools(tools);

    expect(piTools.map((tool) => tool.name)).toContain("fetch_recent_email");
    expect(piTools.find((tool) => tool.name === "apply_email_action")?.executionMode).toBe(
      "sequential",
    );

    const fetchRecent = piTools.find((tool) => tool.name === "fetch_recent_email");
    const result = await fetchRecent?.execute("call-1", { limit: 2, unreadOnly: true }, undefined);
    expect(result?.content[0]).toEqual({ type: "text", text: "Returned 2 item(s)." });
    expect(Array.isArray(result?.details)).toBe(true);
  });

  it("preserves structured tool results for mailbox actions", async () => {
    const connector = new MockEmailConnector();
    const apply = createMailTidyTools({
      connector,
      llm: new HeuristicLLMClient(),
    }).find((tool) => tool.name === "apply_email_action");
    expect(apply).toBeTruthy();

    const piTool = toPiAgentTool(apply!);
    const action: PlannedAction = {
      action: ActionType.LABEL,
      emailIds: ["m1"],
      label: "Newsletters",
    };
    const result = await piTool.execute("call-2", { action, dryRun: true }, undefined);

    expect(result.details).toMatchObject({ labeled: 0, processed: 1 });
    expect(result.content[0]?.type).toBe("text");
  });
});
