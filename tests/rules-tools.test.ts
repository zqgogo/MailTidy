import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createRulesTools, type MatchRulesResult } from "../src/tools/rules.js";
import { createRuleStore } from "../src/rules/rules.js";

describe("RulesTools", () => {
  let tools: ReturnType<typeof createRulesTools>;
  let testDir: string;

  beforeEach(() => {
    testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    tools = createRulesTools(testDir);
  });

  it("match_rules returns no matches when no rules exist", async () => {
    const matchTool = tools.find((t) => t.name === "match_rules");
    expect(matchTool).toBeDefined();

    const result = await matchTool!.invoke({
      message: {
        id: "test-1",
        sender: "test@example.com",
        subject: "Test Subject",
        body: "Test body",
        date: new Date().toISOString(),
        snippet: "Test snippet",
      },
    }) as MatchRulesResult;

    expect(result.matched).toHaveLength(0);
    expect(result.note).toBe("No rules matched this message.");
  });

  it("match_rules returns matched rules", async () => {
    const store = createRuleStore(testDir);
    await store.add({
      name: "Archive Newsletter Rule",
      conditions: [{ type: "sender_contains", value: "newsletter" }],
      actions: [{ type: "archive", priority: 1 }],
      priority: 10,
      enabled: true,
    });

    tools = createRulesTools(testDir);
    const matchTool = tools.find((t) => t.name === "match_rules");
    expect(matchTool).toBeDefined();

    const result = await matchTool!.invoke({
      message: {
        id: "test-1",
        sender: "newsletter@company.com",
        subject: "Weekly Update",
        body: "Newsletter content",
        date: new Date().toISOString(),
        snippet: "Weekly Update newsletter",
      },
    }) as MatchRulesResult;

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].ruleName).toBe("Archive Newsletter Rule");
    expect(result.matched[0].action.kind).toBe("archive");
    expect(result.matched[0].priority).toBe(10);
  });

  it("match_rules handles multiple matching rules with conflict resolution", async () => {
    const store = createRuleStore(testDir);
    await store.add({
      name: "Low Priority Rule",
      conditions: [{ type: "sender_contains", value: "test" }],
      actions: [{ type: "label", priority: 1, params: { label: "Test" } }],
      priority: 5,
      enabled: true,
    });

    await store.add({
      name: "High Priority Rule",
      conditions: [{ type: "sender_contains", value: "test" }],
      actions: [{ type: "archive", priority: 1 }],
      priority: 10,
      enabled: true,
    });

    tools = createRulesTools(testDir);
    const matchTool = tools.find((t) => t.name === "match_rules");

    const result = await matchTool!.invoke({
      message: {
        id: "test-1",
        sender: "test@company.com",
        subject: "Test Subject",
        body: "Test body",
        date: new Date().toISOString(),
        snippet: "Test snippet",
      },
    }) as MatchRulesResult;

    expect(result.matched).toHaveLength(2);
    expect(result.conflictsResolved).toBeDefined();
    expect(result.conflictsResolved?.winningRule).toBe("High Priority Rule");
    expect(result.conflictsResolved?.discardedRules).toContain("Low Priority Rule");
  });

  it("match_rules returns correct confidence", async () => {
    const store = createRuleStore(testDir);
    await store.add({
      name: "Two Condition Rule",
      conditions: [
        { type: "sender_contains", value: "test" },
        { type: "subject_contains", value: "important" },
      ],
      actions: [{ type: "star", priority: 1 }],
      priority: 10,
      enabled: true,
    });

    tools = createRulesTools(testDir);
    const matchTool = tools.find((t) => t.name === "match_rules");

    const message1 = {
      id: "test-1",
      sender: "test@company.com",
      subject: "Important Update",
      body: "Body",
      date: new Date().toISOString(),
      snippet: "Important Update",
    };

    const result = await matchTool!.invoke({ message: message1 }) as MatchRulesResult;
    expect(result.matched[0].confidence).toBe(1);
  });

  it("match_rules tool has correct schema", () => {
    const matchTool = tools.find((t) => t.name === "match_rules");
    expect(matchTool).toBeDefined();
    expect(matchTool!.schema).toBeDefined();
    const schema = matchTool!.schema as { properties?: Record<string, unknown> };
    expect(schema.properties?.message).toBeDefined();
  });

  it("match_rules tool has low risk", () => {
    const matchTool = tools.find((t) => t.name === "match_rules");
    expect(matchTool!.risk).toBe("low");
  });

  it("match_rules handles disabled rules", async () => {
    const store = createRuleStore(testDir);
    await store.add({
      name: "Disabled Rule",
      conditions: [{ type: "sender_contains", value: "never-match" }],
      actions: [{ type: "archive", priority: 1 }],
      priority: 10,
      enabled: false,
    });

    tools = createRulesTools(testDir);
    const matchTool = tools.find((t) => t.name === "match_rules");

    const result = await matchTool!.invoke({
      message: {
        id: "test-1",
        sender: "never-match@test.com",
        subject: "Test",
        body: "Body",
        date: new Date().toISOString(),
        snippet: "Test snippet",
      },
    }) as MatchRulesResult;

    expect(result.matched).toHaveLength(0);
  });
});