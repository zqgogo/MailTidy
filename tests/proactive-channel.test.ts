import { describe, expect, it } from "vitest";
import { createProactiveChannel } from "../src/data/proactive-channel.js";
import { createDecisionLogStore } from "../src/data/decision-logs.js";
import { emptyMemory } from "../src/data/memory.js";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";

describe("ProactiveChannel", () => {
  it("returns no notifications when no data", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const channel = createProactiveChannel(decisionLogs);
    const memory = emptyMemory();

    const result = await channel.scanAndNotify(memory);

    expect(result.notifications.length).toBe(0);
    expect(result.filteredCount).toBe(0);
  });

  it("generates learning proposal notifications", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const channel = createProactiveChannel(decisionLogs);
    const memory = emptyMemory();

    for (let i = 0; i < 3; i++) {
      await decisionLogs.append({
        taskId: `task-${i}`,
        type: "action_executed",
        emailId: `m${i}`,
        sender: "newsletter@example.com",
        originalCategory: "newsletter",
        suggestedAction: "archive",
        timestamp: new Date().toISOString(),
      });
    }

    const result = await channel.scanAndNotify(memory);

    expect(result.notifications.length).toBeGreaterThan(0);
    const learningNotification = result.notifications.find(
      (n) => n.type === "learning_proposal",
    );
    expect(learningNotification).toBeDefined();
    expect(learningNotification?.sender).toBe("newsletter@example.com");
    expect(learningNotification?.suggestedAction).toBe("archive");
  });

  it("detects suspicious senders", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const channel = createProactiveChannel(decisionLogs);
    const memory = emptyMemory();

    await decisionLogs.append({
      taskId: "task-1",
      type: "action_executed",
      emailId: "m1",
      sender: "noreply-secure-login@fake-site.test",
      originalCategory: "spam",
      suggestedAction: "delete",
      timestamp: new Date().toISOString(),
    });

    const result = await channel.scanAndNotify(memory);

    expect(result.notifications.length).toBeGreaterThan(0);
    const securityWarning = result.notifications.find(
      (n) => n.type === "security_warning",
    );
    expect(securityWarning).toBeDefined();
    expect(securityWarning?.severity).toBe("high");
    expect(securityWarning?.importance).toBe(100);
  });

  it("generates automation suggestions", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const channel = createProactiveChannel(decisionLogs);
    const memory = emptyMemory();

    for (let i = 0; i < 3; i++) {
      await decisionLogs.append({
        taskId: `task-${i}`,
        type: "action_executed",
        emailId: `m${i}`,
        sender: "promotions@store.com",
        originalCategory: "promotion",
        suggestedAction: "archive",
        timestamp: new Date().toISOString(),
      });
    }

    const result = await channel.scanAndNotify(memory);

    expect(result.notifications.length).toBeGreaterThan(0);
    const automationSuggestion = result.notifications.find(
      (n) => n.type === "automation_suggestion",
    );
    expect(automationSuggestion).toBeDefined();
    expect(automationSuggestion?.sender).toBe("promotions@store.com");
    expect(automationSuggestion?.suggestedAction).toBe("archive");
  });

  it("limits notifications to max", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const channel = createProactiveChannel(decisionLogs, { maxNotifications: 2 });
    const memory = emptyMemory();

    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        await decisionLogs.append({
          taskId: `task-${j}-${i}`,
          type: "action_executed",
          emailId: `m${j}-${i}`,
          sender: `sender${j}@example.com`,
          originalCategory: "newsletter",
          suggestedAction: "archive",
          timestamp: new Date().toISOString(),
        });
      }
    }

    const result = await channel.scanAndNotify(memory);

    expect(result.notifications.length).toBe(2);
    expect(result.filteredCount).toBeGreaterThanOrEqual(1);
  });

  it("quiet mode only shows security warnings", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const channel = createProactiveChannel(decisionLogs, { quietMode: true });
    const memory = emptyMemory();

    for (let i = 0; i < 3; i++) {
      await decisionLogs.append({
        taskId: `task-${i}`,
        type: "action_executed",
        emailId: `m${i}`,
        sender: "newsletter@example.com",
        originalCategory: "newsletter",
        suggestedAction: "archive",
        timestamp: new Date().toISOString(),
      });
    }

    const result = await channel.scanAndNotify(memory);

    expect(result.notifications.length).toBe(0);
  });

  it("quiet mode shows security warnings", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const channel = createProactiveChannel(decisionLogs, { quietMode: true });
    const memory = emptyMemory();

    await decisionLogs.append({
      taskId: "task-1",
      type: "action_executed",
      emailId: "m1",
      sender: "noreply-secure-login@fake-site.test",
      originalCategory: "spam",
      suggestedAction: "delete",
      timestamp: new Date().toISOString(),
    });

    const result = await channel.scanAndNotify(memory);

    expect(result.notifications.length).toBe(1);
    expect(result.notifications[0].type).toBe("security_warning");
  });

  it("sorts by importance", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const channel = createProactiveChannel(decisionLogs, { maxNotifications: 3 });
    const memory = emptyMemory();

    await decisionLogs.append({
      taskId: "task-1",
      type: "action_executed",
      emailId: "m1",
      sender: "noreply-secure@fake.test",
      originalCategory: "spam",
      suggestedAction: "delete",
      timestamp: new Date().toISOString(),
    });

    for (let i = 0; i < 3; i++) {
      await decisionLogs.append({
        taskId: `task-${i}`,
        type: "action_executed",
        emailId: `m${i}`,
        sender: "newsletter@example.com",
        originalCategory: "newsletter",
        suggestedAction: "archive",
        timestamp: new Date().toISOString(),
      });
    }

    const result = await channel.scanAndNotify(memory);

    expect(result.notifications.length).toBeGreaterThanOrEqual(2);
    expect(result.notifications[0].type).toBe("security_warning");
  });

  it("returns notification summary", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const channel = createProactiveChannel(decisionLogs);
    const memory = emptyMemory();

    for (let i = 0; i < 3; i++) {
      await decisionLogs.append({
        taskId: `task-${i}`,
        type: "action_executed",
        emailId: `m${i}`,
        sender: "newsletter@example.com",
        originalCategory: "newsletter",
        suggestedAction: "archive",
        timestamp: new Date().toISOString(),
      });
    }

    const summary = await channel.getNotificationSummary(memory);

    expect(summary).toContain("💡");
    expect(summary).toContain("newsletter@example.com");
    expect(summary).toContain("自动archive");
  });

  it("returns empty summary when no notifications", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const channel = createProactiveChannel(decisionLogs);
    const memory = emptyMemory();

    const summary = await channel.getNotificationSummary(memory);

    expect(summary).toBe("");
  });
});