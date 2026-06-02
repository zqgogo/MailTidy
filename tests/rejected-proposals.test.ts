import { describe, expect, it } from "vitest";
import { createRejectedProposalStore } from "../src/data/rejected-proposals.js";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";

describe("RejectedProposalStore", () => {
  it("adds a rejected proposal", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRejectedProposalStore(testDir);

    const id = await store.add({
      notificationId: "test-notification",
      sender: "test@example.com",
      suggestedAction: "archive",
      rejectedAt: new Date().toISOString(),
    });

    expect(id).toMatch(/^rejected_\d+_[a-z0-9]+$/);
  });

  it("checks if notification is rejected", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRejectedProposalStore(testDir);

    await store.add({
      notificationId: "test-notification",
      sender: "test@example.com",
      suggestedAction: "archive",
      rejectedAt: new Date().toISOString(),
    });

    expect(await store.isRejected("test-notification")).toBe(true);
    expect(await store.isRejected("other-notification")).toBe(false);
  });

  it("checks if sender is rejected", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRejectedProposalStore(testDir);

    await store.add({
      notificationId: "test-notification",
      sender: "TEST@EXAMPLE.COM",
      suggestedAction: "archive",
      rejectedAt: new Date().toISOString(),
    });

    expect(await store.isRejectedBySender("test@example.com")).toBe(true);
    expect(await store.isRejectedBySender("other@example.com")).toBe(false);
  });

  it("cleanup removes expired entries", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRejectedProposalStore(testDir);
    const fs = await import("node:fs/promises");

    await fs.mkdir(testDir, { recursive: true });

    const expiredEntry = {
      id: "rejected_expired",
      notificationId: "expired-notification",
      sender: "test@example.com",
      suggestedAction: "archive",
      rejectedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    };

    await fs.writeFile(path.join(testDir, "rejected-proposals.jsonl"), JSON.stringify(expiredEntry) + "\n");

    const removedCount = await store.cleanup();

    expect(removedCount).toBe(1);
    expect(await store.getAll()).toHaveLength(0);
  });

  it("cleanup keeps valid entries", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRejectedProposalStore(testDir);

    await store.add({
      notificationId: "valid-notification",
      sender: "test@example.com",
      suggestedAction: "archive",
      rejectedAt: new Date().toISOString(),
    });

    const removedCount = await store.cleanup();

    expect(removedCount).toBe(0);
    expect(await store.getAll()).toHaveLength(1);
  });

  it("returns empty array when file does not exist", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRejectedProposalStore(testDir);

    expect(await store.getAll()).toEqual([]);
    expect(await store.isRejected("test")).toBe(false);
    expect(await store.isRejectedBySender("test@example.com")).toBe(false);
    expect(await store.cleanup()).toBe(0);
  });

  it("clears all entries", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRejectedProposalStore(testDir);

    await store.add({
      notificationId: "test-notification",
      sender: "test@example.com",
      suggestedAction: "archive",
      rejectedAt: new Date().toISOString(),
    });

    await store.clear();

    expect(await store.getAll()).toEqual([]);
  });

  it("gets all entries", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const store = createRejectedProposalStore(testDir);

    await store.add({
      notificationId: "test-1",
      sender: "a@b.com",
      suggestedAction: "archive",
      rejectedAt: new Date().toISOString(),
    });
    await store.add({
      notificationId: "test-2",
      sender: "c@d.com",
      suggestedAction: "delete",
      rejectedAt: new Date().toISOString(),
    });

    const entries = await store.getAll();

    expect(entries.length).toBe(2);
    expect(entries[0].notificationId).toBe("test-1");
    expect(entries[1].notificationId).toBe("test-2");
  });
});