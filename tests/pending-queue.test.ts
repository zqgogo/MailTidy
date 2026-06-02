import { describe, expect, it } from "vitest";
import { createPendingQueue } from "../src/data/pending-queue.js";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";

describe("PendingQueue", () => {
  it("adds a pending task", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const queue = createPendingQueue(testDir);

    const taskId = await queue.add({
      type: "email_action",
      payload: { emailId: "test-1", action: "archive" },
      maxRetries: 3,
      delayMs: 0,
    });

    expect(taskId).toMatch(/^task_\d+_[a-z0-9]+$/);
  });

  it("gets pending tasks", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const queue = createPendingQueue(testDir);

    await queue.add({
      type: "email_action",
      payload: { emailId: "test-1", action: "archive" },
      maxRetries: 3,
      delayMs: 0,
    });

    const pending = await queue.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("pending");
  });

  it("gets task by id", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const queue = createPendingQueue(testDir);

    const taskId = await queue.add({
      type: "email_action",
      payload: { emailId: "test-1", action: "archive" },
      maxRetries: 3,
      delayMs: 0,
    });

    const task = await queue.getById(taskId);
    expect(task).not.toBeNull();
    expect(task?.id).toBe(taskId);
  });

  it("marks task as running", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const queue = createPendingQueue(testDir);

    const taskId = await queue.add({
      type: "email_action",
      payload: { emailId: "test-1", action: "archive" },
      maxRetries: 3,
      delayMs: 0,
    });

    const result = await queue.markRunning(taskId);
    expect(result).toBe(true);

    const task = await queue.getById(taskId);
    expect(task?.status).toBe("running");
    expect(task?.startedAt).toBeDefined();
  });

  it("marks task as completed", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const queue = createPendingQueue(testDir);

    const taskId = await queue.add({
      type: "email_action",
      payload: { emailId: "test-1", action: "archive" },
      maxRetries: 3,
      delayMs: 0,
    });

    const result = await queue.markCompleted(taskId);
    expect(result).toBe(true);

    const task = await queue.getById(taskId);
    expect(task?.status).toBe("completed");
    expect(task?.completedAt).toBeDefined();
  });

  it("marks task as failed with error message", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const queue = createPendingQueue(testDir);

    const taskId = await queue.add({
      type: "email_action",
      payload: { emailId: "test-1", action: "archive" },
      maxRetries: 3,
      delayMs: 0,
    });

    const result = await queue.markFailed(taskId, "Connection error");
    expect(result).toBe(true);

    const task = await queue.getById(taskId);
    expect(task?.status).toBe("failed");
    expect(task?.errorMessage).toBe("Connection error");
    expect(task?.retryCount).toBe(1);
  });

  it("retries failed task with exponential backoff", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const queue = createPendingQueue(testDir);

    const taskId = await queue.add({
      type: "email_action",
      payload: { emailId: "test-1", action: "archive" },
      maxRetries: 3,
      delayMs: 1000,
    });

    await queue.markFailed(taskId, "Error");
    const retryResult = await queue.retryTask(taskId);
    expect(retryResult).toBe(true);

    const task = await queue.getById(taskId);
    expect(task?.status).toBe("pending");
    expect(task?.delayMs).toBe(2000);
  });

  it("prevents retry beyond max retries", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const queue = createPendingQueue(testDir);

    const taskId = await queue.add({
      type: "email_action",
      payload: { emailId: "test-1", action: "archive" },
      maxRetries: 2,
      delayMs: 1000,
    });

    await queue.markFailed(taskId, "Error");
    const retryResult = await queue.retryTask(taskId);
    expect(retryResult).toBe(true);

    await queue.markFailed(taskId, "Error again");
    const retryResult2 = await queue.retryTask(taskId);
    expect(retryResult2).toBe(true);

    await queue.markFailed(taskId, "Third error");
    const retryResult3 = await queue.retryTask(taskId);
    expect(retryResult3).toBe(false);
  });

  it("deletes task", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const queue = createPendingQueue(testDir);

    const taskId = await queue.add({
      type: "email_action",
      payload: { emailId: "test-1", action: "archive" },
      maxRetries: 3,
      delayMs: 0,
    });

    const result = await queue.delete(taskId);
    expect(result).toBe(true);

    const task = await queue.getById(taskId);
    expect(task).toBeNull();
  });

  it("cleanup removes old completed tasks", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const queue = createPendingQueue(testDir);
    const fs = await import("node:fs/promises");

    await fs.mkdir(testDir, { recursive: true });

    const oldTask = {
      id: "task_old",
      type: "email_action" as const,
      payload: { emailId: "old" },
      status: "completed" as const,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      completedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      retryCount: 0,
      maxRetries: 3,
      delayMs: 0,
    };

    await fs.writeFile(path.join(testDir, "pending-queue.jsonl"), JSON.stringify(oldTask) + "\n");

    const removedCount = await queue.cleanup();
    expect(removedCount).toBe(1);

    const tasks = await queue.getAll();
    expect(tasks).toHaveLength(0);
  });

  it("returns empty array when file does not exist", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const queue = createPendingQueue(testDir);

    expect(await queue.getAll()).toEqual([]);
    expect(await queue.getPending()).toEqual([]);
    expect(await queue.getById("test")).toBeNull();
  });

  it("supports delayed execution", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const queue = createPendingQueue(testDir);

    const futureTime = new Date(Date.now() + 10000).toISOString();

    await queue.add({
      type: "email_action",
      payload: { emailId: "test-1", action: "archive" },
      maxRetries: 3,
      delayMs: 10000,
      scheduledAt: futureTime,
    });

    const pending = await queue.getPending();
    expect(pending).toHaveLength(0);
  });
});