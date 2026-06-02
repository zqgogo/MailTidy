import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  emptyMemory,
  rememberSender,
  forgetSender,
  rollbackToHistoryEntry,
  getRecentHistory,
  getHistoryBySender,
} from "../src/data/memory.js";

describe("Memory Rollback", () => {
  it("tracks preference history when creating a new preference", () => {
    const memory = emptyMemory();

    rememberSender(memory, "test@example.com", {
      importanceDelta: 1,
      preferredAction: "archive",
      ignoredCount: 0,
      learnedFrom: "user_feedback",
      learnedAt: new Date().toISOString(),
    }, "initial setup");

    expect(memory.preferenceHistory).toHaveLength(1);
    expect(memory.preferenceHistory[0].actionType).toBe("create");
    expect(memory.preferenceHistory[0].sender).toBe("test@example.com");
    expect(memory.preferenceHistory[0].reason).toBe("initial setup");
  });

  it("tracks preference history when updating a preference", () => {
    const memory = emptyMemory();

    rememberSender(memory, "test@example.com", {
      importanceDelta: 1,
      preferredAction: "archive",
      ignoredCount: 0,
    });

    rememberSender(memory, "test@example.com", {
      importanceDelta: 2,
      preferredAction: "delete",
      ignoredCount: 0,
    }, "updated action");

    expect(memory.preferenceHistory).toHaveLength(2);
    expect(memory.preferenceHistory[0].actionType).toBe("update");
    expect(memory.preferenceHistory[0].previousPreference?.preferredAction).toBe("archive");
    expect(memory.preferenceHistory[0].newPreference.preferredAction).toBe("delete");
  });

  it("tracks preference history when deleting a preference", () => {
    const memory = emptyMemory();

    rememberSender(memory, "test@example.com", {
      importanceDelta: 1,
      preferredAction: "archive",
      ignoredCount: 0,
    });

    forgetSender(memory, "test@example.com", "user requested deletion");

    expect(memory.preferenceHistory).toHaveLength(2);
    expect(memory.preferenceHistory[0].actionType).toBe("delete");
    expect(memory.senderPreferences["test@example.com"]).toBeUndefined();
  });

  it("rolls back a create action", () => {
    const memory = emptyMemory();

    rememberSender(memory, "test@example.com", {
      importanceDelta: 1,
      preferredAction: "archive",
      ignoredCount: 0,
    });

    const historyId = memory.preferenceHistory[0].id;

    expect(memory.senderPreferences["test@example.com"]).toBeDefined();

    const result = rollbackToHistoryEntry(memory, historyId);

    expect(result.success).toBe(true);
    expect(result.message.includes("回滚") && result.message.includes("创建")).toBe(true);
    expect(memory.senderPreferences["test@example.com"]).toBeUndefined();
  });

  it("rolls back an update action", () => {
    const memory = emptyMemory();

    rememberSender(memory, "test@example.com", {
      importanceDelta: 1,
      preferredAction: "archive",
      ignoredCount: 0,
    });

    rememberSender(memory, "test@example.com", {
      importanceDelta: 2,
      preferredAction: "delete",
      ignoredCount: 0,
    });

    const updateId = memory.preferenceHistory[0].id;

    expect(memory.senderPreferences["test@example.com"].preferredAction).toBe("delete");

    const result = rollbackToHistoryEntry(memory, updateId);

    expect(result.success).toBe(true);
    expect(result.message.includes("回滚") && result.message.includes("更新")).toBe(true);
    expect(memory.senderPreferences["test@example.com"].preferredAction).toBe("archive");
  });

  it("rolls back a delete action", () => {
    const memory = emptyMemory();

    rememberSender(memory, "test@example.com", {
      importanceDelta: 1,
      preferredAction: "archive",
      ignoredCount: 0,
    });

    forgetSender(memory, "test@example.com");

    const deleteId = memory.preferenceHistory[0].id;

    expect(memory.senderPreferences["test@example.com"]).toBeUndefined();

    const result = rollbackToHistoryEntry(memory, deleteId);

    expect(result.success).toBe(true);
    expect(result.message).toContain("撤销删除");
    expect(memory.senderPreferences["test@example.com"]).toBeDefined();
    expect(memory.senderPreferences["test@example.com"].preferredAction).toBe("archive");
  });

  it("returns error for invalid history id", () => {
    const memory = emptyMemory();

    const result = rollbackToHistoryEntry(memory, "invalid-id");

    expect(result.success).toBe(false);
    expect(result.message).toContain("找不到历史记录 ID");
  });

  it("gets recent history with limit", () => {
    const memory = emptyMemory();

    for (let i = 0; i < 25; i++) {
      rememberSender(memory, `test${i}@example.com`, {
        importanceDelta: i,
        preferredAction: "archive",
        ignoredCount: 0,
      });
    }

    const recent = getRecentHistory(memory, 10);

    expect(recent).toHaveLength(10);
    expect(recent[0].sender).toBe("test24@example.com");
    expect(recent[9].sender).toBe("test15@example.com");
  });

  it("gets history by sender", () => {
    const memory = emptyMemory();

    rememberSender(memory, "a@example.com", {
      importanceDelta: 1,
      preferredAction: "archive",
      ignoredCount: 0,
    });
    rememberSender(memory, "b@example.com", {
      importanceDelta: 2,
      preferredAction: "delete",
      ignoredCount: 0,
    });
    rememberSender(memory, "a@example.com", {
      importanceDelta: 3,
      preferredAction: "read",
      ignoredCount: 0,
    });

    const history = getHistoryBySender(memory, "a@example.com");

    expect(history).toHaveLength(2);
    expect(history[0].newPreference.preferredAction).toBe("read");
    expect(history[1].newPreference.preferredAction).toBe("archive");
  });

  it("caps history at 1000 entries", () => {
    const memory = emptyMemory();

    for (let i = 0; i < 1050; i++) {
      rememberSender(memory, `test${i}@example.com`, {
        importanceDelta: i,
        preferredAction: "archive",
        ignoredCount: 0,
      });
    }

    expect(memory.preferenceHistory).toHaveLength(1000);
  });

  it("supports case-insensitive sender matching", () => {
    const memory = emptyMemory();

    rememberSender(memory, "TEST@EXAMPLE.COM", {
      importanceDelta: 1,
      preferredAction: "archive",
      ignoredCount: 0,
    });

    const history = getHistoryBySender(memory, "test@example.com");

    expect(history).toHaveLength(1);
    expect(history[0].sender).toBe("test@example.com");
  });
});