import { describe, expect, it } from "vitest";
import { createLearningProposer } from "../src/data/learning-proposer.js";
import { createDecisionLogStore } from "../src/data/decision-logs.js";
import { emptyMemory } from "../src/data/memory.js";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";

describe("LearningProposer", () => {
  it("proposes nothing when no logs exist", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const proposer = createLearningProposer(decisionLogs);
    const memory = emptyMemory();

    const result = await proposer.propose(memory);

    expect(result.proposals.length).toBe(0);
    expect(result.notes).toContain("No recent decision logs found");
  });

  it("proposes auto-confirm action when sender meets threshold", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const proposer = createLearningProposer(decisionLogs, { autoConfirmThreshold: 3 });
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

    const result = await proposer.propose(memory);

    expect(result.proposals.length).toBe(1);
    expect(result.proposals[0].sender).toBe("newsletter@example.com");
    expect(result.proposals[0].suggestedAction).toBe("archive");
    expect(result.proposals[0].type).toBe("auto_confirm");
    expect(result.proposals[0].confirmCount).toBe(3);
    expect(result.proposals[0].confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("does not propose when below threshold", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const proposer = createLearningProposer(decisionLogs, { autoConfirmThreshold: 3 });
    const memory = emptyMemory();

    for (let i = 0; i < 2; i++) {
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

    const result = await proposer.propose(memory);

    expect(result.proposals.length).toBe(0);
  });

  it("filters by confidence threshold", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const proposer = createLearningProposer(decisionLogs, {
      autoConfirmThreshold: 3,
      minConfidence: 0.9,
    });
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

    const result = await proposer.propose(memory);

    expect(result.proposals.length).toBe(1);
    expect(result.proposals[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("limits number of proposals", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const proposer = createLearningProposer(decisionLogs, {
      autoConfirmThreshold: 2,
      maxProposals: 2,
    });
    const memory = emptyMemory();

    for (let i = 0; i < 2; i++) {
      await decisionLogs.append({
        taskId: `task-${i}`,
        type: "action_executed",
        emailId: `m${i}`,
        sender: "a@example.com",
        originalCategory: "newsletter",
        suggestedAction: "archive",
        timestamp: new Date().toISOString(),
      });
    }
    for (let i = 0; i < 2; i++) {
      await decisionLogs.append({
        taskId: `task-${i}`,
        type: "action_executed",
        emailId: `m${i}`,
        sender: "b@example.com",
        originalCategory: "newsletter",
        suggestedAction: "archive",
        timestamp: new Date().toISOString(),
      });
    }
    for (let i = 0; i < 2; i++) {
      await decisionLogs.append({
        taskId: `task-${i}`,
        type: "action_executed",
        emailId: `m${i}`,
        sender: "c@example.com",
        originalCategory: "newsletter",
        suggestedAction: "archive",
        timestamp: new Date().toISOString(),
      });
    }

    const result = await proposer.propose(memory);

    expect(result.proposals.length).toBe(2);
  });

  it("returns opening prompt", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const proposer = createLearningProposer(decisionLogs, { autoConfirmThreshold: 3 });
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

    const prompt = await proposer.getOpeningPrompt(memory);

    expect(prompt).toContain("根据你的近期操作模式");
    expect(prompt).toContain("newsletter@example.com");
    expect(prompt).toContain("自动archive");
    expect(prompt).toContain("已确认 3 次");
    expect(prompt).toContain("是否接受以上建议？");
  });

  it("returns empty prompt when no proposals", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const proposer = createLearningProposer(decisionLogs);
    const memory = emptyMemory();

    const prompt = await proposer.getOpeningPrompt(memory);

    expect(prompt).toBe("");
  });

  it("checks if there is enough data", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const proposer = createLearningProposer(decisionLogs, { autoConfirmThreshold: 3 });

    expect(await proposer.hasEnoughData()).toBe(false);

    for (let i = 0; i < 3; i++) {
      await decisionLogs.append({
        taskId: `task-${i}`,
        type: "action_executed",
        emailId: `m${i}`,
        sender: "test@example.com",
        originalCategory: "newsletter",
        suggestedAction: "archive",
        timestamp: new Date().toISOString(),
      });
    }

    expect(await proposer.hasEnoughData()).toBe(true);
  });

  it("applies proposals to memory", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const proposer = createLearningProposer(decisionLogs, { autoConfirmThreshold: 3 });
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

    const result = await proposer.propose(memory);
    const appliedCount = await proposer.applyProposals(result.proposals, memory);

    expect(appliedCount).toBe(1);
    const pref = memory.senderPreferences["newsletter@example.com"];
    expect(pref).toBeDefined();
    expect(pref.preferredAction).toBe("archive");
  });

  it("does not propose when preference already exists", async () => {
    const testDir = path.join(tmpdir(), `mailtidy-test-${randomUUID()}`);
    const decisionLogs = createDecisionLogStore(testDir);
    const proposer = createLearningProposer(decisionLogs, { autoConfirmThreshold: 3 });
    const memory = emptyMemory();

    memory.senderPreferences["newsletter@example.com"] = {
      category: "newsletter",
      preferredAction: "archive",
      importanceDelta: 1,
      ignoredCount: 0,
    };

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

    const result = await proposer.propose(memory);

    expect(result.proposals.length).toBe(0);
  });
});