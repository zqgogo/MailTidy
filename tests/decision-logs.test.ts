import { describe, expect, it, afterAll } from "vitest";
import { createDecisionLogStore, type DecisionLogEntry } from "../src/data/decision-logs.js";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";

describe("DecisionLogStore", () => {
  const baseTestDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);

  function testDir(): string {
    return path.join(baseTestDir, `test-${randomUUID()}`);
  }

  it("appends a decision log entry", async () => {
    const store = createDecisionLogStore(testDir());
    const logId = await store.append({
      taskId: "task-1",
      type: "user_confirmation",
      emailId: "m1",
      sender: "test@example.com",
      originalCategory: "newsletter",
      suggestedAction: "archive",
      timestamp: new Date().toISOString(),
    });

    expect(logId).toMatch(/^log_\d+_[a-z0-9]+$/);
  });

  it("queries logs by task ID", async () => {
    const store = createDecisionLogStore(testDir());
    await store.append({
      taskId: "task-1",
      type: "user_confirmation",
      emailId: "m1",
      sender: "a@b.com",
      originalCategory: "newsletter",
      suggestedAction: "archive",
      timestamp: new Date().toISOString(),
    });
    await store.append({
      taskId: "task-2",
      type: "user_rejection",
      emailId: "m2",
      sender: "c@d.com",
      originalCategory: "important",
      suggestedAction: "archive",
      timestamp: new Date().toISOString(),
    });

    const logs = await store.query({ taskId: "task-1" });
    expect(logs.length).toBe(1);
    expect(logs[0].taskId).toBe("task-1");
    expect(logs[0].type).toBe("user_confirmation");
  });

  it("queries logs by sender", async () => {
    const store = createDecisionLogStore(testDir());
    await store.append({
      taskId: "task-1",
      type: "user_confirmation",
      emailId: "m1",
      sender: "NEWSLETTER@EXAMPLE.COM",
      originalCategory: "newsletter",
      suggestedAction: "archive",
      timestamp: new Date().toISOString(),
    });
    await store.append({
      taskId: "task-2",
      type: "user_confirmation",
      emailId: "m2",
      sender: "other@example.com",
      originalCategory: "newsletter",
      suggestedAction: "archive",
      timestamp: new Date().toISOString(),
    });

    const logs = await store.query({ sender: "newsletter@example.com" });
    expect(logs.length).toBe(1);
    expect(logs[0].sender).toBe("NEWSLETTER@EXAMPLE.COM");
  });

  it("queries logs by signal type", async () => {
    const store = createDecisionLogStore(testDir());
    await store.append({
      taskId: "task-1",
      type: "user_confirmation",
      emailId: "m1",
      sender: "a@b.com",
      originalCategory: "newsletter",
      suggestedAction: "archive",
      timestamp: new Date().toISOString(),
    });
    await store.append({
      taskId: "task-1",
      type: "user_rejection",
      emailId: "m2",
      sender: "c@d.com",
      originalCategory: "important",
      suggestedAction: "archive",
      timestamp: new Date().toISOString(),
    });

    const logs = await store.query({ signalType: "user_confirmation" });
    expect(logs.length).toBe(1);
    expect(logs[0].type).toBe("user_confirmation");
  });

  it("queries logs by date range", async () => {
    const store = createDecisionLogStore(testDir());
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    await store.append({
      taskId: "task-1",
      type: "user_confirmation",
      emailId: "m1",
      sender: "a@b.com",
      originalCategory: "newsletter",
      suggestedAction: "archive",
      timestamp: yesterday.toISOString(),
    });
    await store.append({
      taskId: "task-2",
      type: "user_confirmation",
      emailId: "m2",
      sender: "c@d.com",
      originalCategory: "newsletter",
      suggestedAction: "archive",
      timestamp: now.toISOString(),
    });

    const logs = await store.query({ since: new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString() });
    expect(logs.length).toBe(1);
    expect(logs[0].taskId).toBe("task-2");
  });

  it("limits query results", async () => {
    const store = createDecisionLogStore(testDir());
    for (let i = 0; i < 5; i++) {
      await store.append({
        taskId: `task-${i}`,
        type: "user_confirmation",
        emailId: `m${i}`,
        sender: `a${i}@b.com`,
        originalCategory: "newsletter",
        suggestedAction: "archive",
        timestamp: new Date().toISOString(),
      });
    }

    const logs = await store.query({ limit: 3 });
    expect(logs.length).toBe(3);
  });

  it("gets recent logs with getRecentLogs", async () => {
    const store = createDecisionLogStore(testDir());
    const now = new Date();
    const threeDaysAgo = new Date(now);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const tenDaysAgo = new Date(now);
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    await store.append({
      taskId: "task-old",
      type: "user_confirmation",
      emailId: "m1",
      sender: "a@b.com",
      originalCategory: "newsletter",
      suggestedAction: "archive",
      timestamp: tenDaysAgo.toISOString(),
    });
    await store.append({
      taskId: "task-recent",
      type: "user_confirmation",
      emailId: "m2",
      sender: "c@d.com",
      originalCategory: "newsletter",
      suggestedAction: "archive",
      timestamp: threeDaysAgo.toISOString(),
    });

    const logs = await store.getRecentLogs(7);
    expect(logs.length).toBe(1);
    expect(logs[0].taskId).toBe("task-recent");
  });

  it("returns empty array when file does not exist", async () => {
    const store = createDecisionLogStore(path.join(tmpdir(), `nonexistent-${randomUUID()}`));
    const logs = await store.query();
    expect(logs).toEqual([]);
  });

  it("clears all logs", async () => {
    const store = createDecisionLogStore(testDir());
    await store.append({
      taskId: "task-1",
      type: "user_confirmation",
      emailId: "m1",
      sender: "a@b.com",
      originalCategory: "newsletter",
      suggestedAction: "archive",
      timestamp: new Date().toISOString(),
    });

    await store.clear();
    const logs = await store.query();
    expect(logs).toEqual([]);
  });

  it("sorts logs by timestamp descending", async () => {
    const store = createDecisionLogStore(testDir());
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    await store.append({
      taskId: "task-1",
      type: "user_confirmation",
      emailId: "m1",
      sender: "a@b.com",
      originalCategory: "newsletter",
      suggestedAction: "archive",
      timestamp: twoHoursAgo.toISOString(),
    });
    await store.append({
      taskId: "task-2",
      type: "user_confirmation",
      emailId: "m2",
      sender: "c@d.com",
      originalCategory: "newsletter",
      suggestedAction: "archive",
      timestamp: oneHourAgo.toISOString(),
    });
    await store.append({
      taskId: "task-3",
      type: "user_confirmation",
      emailId: "m3",
      sender: "e@f.com",
      originalCategory: "newsletter",
      suggestedAction: "archive",
      timestamp: now.toISOString(),
    });

    const logs = await store.query();
    expect(logs[0].taskId).toBe("task-3");
    expect(logs[1].taskId).toBe("task-2");
    expect(logs[2].taskId).toBe("task-1");
  });

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });
});