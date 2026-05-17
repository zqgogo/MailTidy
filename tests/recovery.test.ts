/**
 * 恢复层冒烟测试：
 *   - 任务创建 / 状态扭转 / 扫描未收尾 / 删除生命周期闭环
 *   - CheckpointStore 写盘 / 读取 / 删除
 *   - 输入解析的边界
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { JsonTaskStore } from "../src/data/tasks.js";
import {
  CheckpointStore,
  emptyBudget,
  parseRecoveryChoice,
} from "../src/agent/recovery.js";

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mailtidy-test-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("JsonTaskStore", () => {
  it("creates, updates, and lists interrupted tasks", async () => {
    const store = new JsonTaskStore(path.join(tmp, "tasks"));
    const record = await store.create({ sop: "inbox_cleanup", invocation: { demo: true } });
    expect(record.status).toBe("running");
    expect(record.taskId).toBeTruthy();

    await store.markInterrupted(record);
    const pending = await store.scanInterrupted();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.taskId).toBe(record.taskId);

    await store.markCompleted(pending[0]!, "completed");
    const after = await store.scanInterrupted();
    expect(after).toHaveLength(0);
  });

  it("returns empty list when directory is missing", async () => {
    const store = new JsonTaskStore(path.join(tmp, "never-created"));
    const pending = await store.scanInterrupted();
    expect(pending).toEqual([]);
  });
});

describe("CheckpointStore", () => {
  it("persists and reloads a checkpoint", async () => {
    const store = new CheckpointStore(path.join(tmp, "ckpt"));
    await store.persist({
      taskId: "abc",
      messages: [{ role: "user", content: "hi" }],
      turn: 3,
      budget: { ...emptyBudget(), steps: 3 },
      persistedAt: "ignored, overwritten",
    });
    const loaded = await store.load("abc");
    expect(loaded?.taskId).toBe("abc");
    expect(loaded?.turn).toBe(3);
    expect(loaded?.persistedAt).toMatch(/T/);
    await store.purge("abc");
    expect(await store.load("abc")).toBeNull();
  });
});

describe("parseRecoveryChoice", () => {
  it("maps letters and words to canonical actions", () => {
    expect(parseRecoveryChoice("r")).toBe("rerun");
    expect(parseRecoveryChoice("RERUN")).toBe("rerun");
    expect(parseRecoveryChoice(" c ")).toBe("continue");
    expect(parseRecoveryChoice("d")).toBe("drop");
    expect(parseRecoveryChoice("delete")).toBe("drop");
    expect(parseRecoveryChoice("")).toBe("skip");
    expect(parseRecoveryChoice("?")).toBe("skip");
  });
});
