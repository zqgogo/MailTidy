import { describe, expect, it } from "vitest";
import { createRuleStore, createRuleEngine, RuleEngine } from "../src/rules/rules.js";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";

const createTestMessage = (overrides: Partial<{
  sender: string;
  subject: string;
  body: string;
  hasAttachment: boolean;
  unread: boolean;
  labels: string[];
  snippet: string;
}> = {}) => ({
  id: "test-1",
  sender: overrides.sender ?? "test@example.com",
  subject: overrides.subject ?? "Test Subject",
  body: overrides.body ?? "Test body content",
  date: new Date().toISOString(),
  hasAttachment: overrides.hasAttachment ?? false,
  unread: overrides.unread ?? false,
  labels: overrides.labels ?? [],
  snippet: overrides.snippet ?? "Test snippet",
});

describe("RuleEngine", () => {
  it("matches sender_contains condition", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRuleStore(testDir);
    const engine = createRuleEngine(store);

    await store.add({
      name: "Test Rule",
      conditions: [{ type: "sender_contains", value: "spam" }],
      actions: [{ type: "archive", priority: 1 }],
      priority: 10,
      enabled: true,
    });

    const message = createTestMessage({ sender: "spam@evil.com" });
    const results = await engine.match(message);

    expect(results).toHaveLength(1);
    expect(results[0].rule.name).toBe("Test Rule");
  });

  it("matches subject_contains condition", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRuleStore(testDir);
    const engine = createRuleEngine(store);

    await store.add({
      name: "Promotion Filter",
      conditions: [{ type: "subject_contains", value: "promotion" }],
      actions: [{ type: "archive", priority: 1 }],
      priority: 10,
      enabled: true,
    });

    const message1 = createTestMessage({ subject: "Big promotion sale!" });
    const message2 = createTestMessage({ subject: "Regular email" });

    expect((await engine.match(message1)).length).toBe(1);
    expect((await engine.match(message2)).length).toBe(0);
  });

  it("matches multiple conditions with AND logic", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRuleStore(testDir);
    const engine = createRuleEngine(store);

    await store.add({
      name: "Multi-condition Rule",
      conditions: [
        { type: "sender_contains", value: "newsletter" },
        { type: "has_attachment", value: "true" },
      ],
      actions: [{ type: "archive", priority: 1 }],
      priority: 10,
      enabled: true,
    });

    const message1 = createTestMessage({
      sender: "newsletter@company.com",
      hasAttachment: true,
    });
    const message2 = createTestMessage({ sender: "newsletter@company.com" });

    expect((await engine.match(message1)).length).toBe(1);
    expect((await engine.match(message2)).length).toBe(0);
  });

  it("supports negate condition", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRuleStore(testDir);
    const engine = createRuleEngine(store);

    await store.add({
      name: "Not from work",
      conditions: [{ type: "sender_contains", value: "@work.com", negate: true }],
      actions: [{ type: "archive", priority: 1 }],
      priority: 10,
      enabled: true,
    });

    const message1 = createTestMessage({ sender: "personal@home.com" });
    const message2 = createTestMessage({ sender: "john@work.com" });

    expect((await engine.match(message1)).length).toBe(1);
    expect((await engine.match(message2)).length).toBe(0);
  });

  it("resolves conflicts by priority", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRuleStore(testDir);
    const engine = createRuleEngine(store);

    await store.add({
      name: "Low Priority Rule",
      conditions: [{ type: "sender_contains", value: "test" }],
      actions: [{ type: "archive", priority: 1 }],
      priority: 5,
      enabled: true,
    });

    await store.add({
      name: "High Priority Rule",
      conditions: [{ type: "sender_contains", value: "test" }],
      actions: [{ type: "delete", priority: 1 }],
      priority: 20,
      enabled: true,
    });

    const message = createTestMessage({ sender: "test@example.com" });
    const results = await engine.match(message);
    const conflict = await engine.resolveConflicts(results);

    expect(results).toHaveLength(2);
    expect(conflict.winningRule.name).toBe("High Priority Rule");
    expect(conflict.discardedRules).toHaveLength(1);
  });

  it("matches regex patterns", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRuleStore(testDir);
    const engine = createRuleEngine(store);

    await store.add({
      name: "Regex Rule",
      conditions: [{ type: "sender_matches", value: "^no-reply@.*\\.com$" }],
      actions: [{ type: "archive", priority: 1 }],
      priority: 10,
      enabled: true,
    });

    const message1 = createTestMessage({ sender: "no-reply@company.com" });
    const message2 = createTestMessage({ sender: "support@company.com" });

    expect((await engine.match(message1)).length).toBe(1);
    expect((await engine.match(message2)).length).toBe(0);
  });

  it("matches link domain", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRuleStore(testDir);
    const engine = createRuleEngine(store);

    await store.add({
      name: "Suspicious Snippet Rule",
      conditions: [{ type: "snippet_contains", value: "suspicious" }],
      actions: [{ type: "ask_user", priority: 1 }],
      priority: 10,
      enabled: true,
    });

    const message1 = createTestMessage({ snippet: "This link looks suspicious" });
    const message2 = createTestMessage({ snippet: "This is a normal message" });

    expect((await engine.match(message1)).length).toBe(1);
    expect((await engine.match(message2)).length).toBe(0);
  });

  it("returns confidence based on matched conditions", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRuleStore(testDir);
    const engine = createRuleEngine(store);

    await store.add({
      name: "Confidence Test",
      conditions: [
        { type: "sender_contains", value: "test" },
        { type: "subject_contains", value: "important" },
        { type: "has_attachment", value: "true" },
      ],
      actions: [{ type: "star", priority: 1 }],
      priority: 10,
      enabled: true,
    });

    const message = createTestMessage({
      sender: "test@example.com",
      subject: "Important email",
      hasAttachment: true,
    });

    const results = await engine.match(message);

    expect(results).toHaveLength(1);
    expect(results[0].confidence).toBe(1);
  });

  it("handles disabled rules", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRuleStore(testDir);
    const engine = createRuleEngine(store);

    await store.add({
      name: "Disabled Rule",
      conditions: [{ type: "sender_contains", value: "test" }],
      actions: [{ type: "archive", priority: 1 }],
      priority: 10,
      enabled: false,
    });

    const message = createTestMessage({ sender: "test@example.com" });
    const results = await engine.match(message);

    expect(results).toHaveLength(0);
  });

  it("supports case-insensitive matching", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRuleStore(testDir);
    const engine = createRuleEngine(store);

    await store.add({
      name: "Case Insensitive",
      conditions: [{ type: "sender_contains", value: "TEST", caseSensitive: false }],
      actions: [{ type: "archive", priority: 1 }],
      priority: 10,
      enabled: true,
    });

    const message = createTestMessage({ sender: "Test@Example.com" });
    const results = await engine.match(message);

    expect(results).toHaveLength(1);
  });
});

describe("RuleStore", () => {
  it("adds and retrieves rules", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRuleStore(testDir);

    const ruleId = await store.add({
      name: "Test Rule",
      conditions: [{ type: "sender_contains", value: "test" }],
      actions: [{ type: "archive", priority: 1 }],
      priority: 10,
      enabled: true,
    });

    const rule = await store.getById(ruleId);
    expect(rule).not.toBeNull();
    expect(rule?.name).toBe("Test Rule");
  });

  it("updates rules", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRuleStore(testDir);

    const ruleId = await store.add({
      name: "Original",
      conditions: [{ type: "sender_contains", value: "test" }],
      actions: [{ type: "archive", priority: 1 }],
      priority: 10,
      enabled: true,
    });

    const result = await store.update(ruleId, { name: "Updated", enabled: false });
    expect(result).toBe(true);

    const rule = await store.getById(ruleId);
    expect(rule?.name).toBe("Updated");
    expect(rule?.enabled).toBe(false);
  });

  it("deletes rules", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRuleStore(testDir);

    const ruleId = await store.add({
      name: "To Delete",
      conditions: [{ type: "sender_contains", value: "test" }],
      actions: [{ type: "archive", priority: 1 }],
      priority: 10,
      enabled: true,
    });

    const result = await store.delete(ruleId);
    expect(result).toBe(true);

    const rule = await store.getById(ruleId);
    expect(rule).toBeNull();
  });

  it("gets enabled rules", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRuleStore(testDir);

    await store.add({
      name: "Enabled",
      conditions: [{ type: "sender_contains", value: "test" }],
      actions: [{ type: "archive", priority: 1 }],
      priority: 10,
      enabled: true,
    });

    await store.add({
      name: "Disabled",
      conditions: [{ type: "sender_contains", value: "test" }],
      actions: [{ type: "archive", priority: 1 }],
      priority: 10,
      enabled: false,
    });

    const enabled = await store.getEnabledRules();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].name).toBe("Enabled");
  });

  it("returns empty array when file does not exist", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRuleStore(testDir);

    expect(await store.getAll()).toEqual([]);
    expect(await store.getEnabledRules()).toEqual([]);
    expect(await store.getById("test")).toBeNull();
  });
});