import { describe, expect, it } from "vitest";
import { LearningEngine, createLearningEngine } from "../src/data/learning.js";
import { emptyMemory } from "../src/data/memory.js";

describe("Learning Safety Boundaries", () => {
  it("limits impact per signal to maxImpactPerSignal", () => {
    const engine = createLearningEngine({ maxImpactPerSignal: 2 });
    const memory = emptyMemory();

    const signal = {
      type: "user_confirmation" as const,
      emailId: "test-1",
      sender: "test@example.com",
      originalCategory: "promotion",
      suggestedAction: "archive",
      timestamp: new Date().toISOString(),
    };

    const updates1 = engine.processSignal(signal, memory);
    updates1.forEach((u) => engine.applyUpdate(u, memory));
    let pref = memory.senderPreferences["test@example.com"];
    expect(pref?.importanceDelta).toBe(1);

    const updates2 = engine.processSignal(signal, memory);
    updates2.forEach((u) => engine.applyUpdate(u, memory));
    pref = memory.senderPreferences["test@example.com"];
    expect(pref?.importanceDelta).toBe(2);

    const updates3 = engine.processSignal(signal, memory);
    updates3.forEach((u) => engine.applyUpdate(u, memory));
    pref = memory.senderPreferences["test@example.com"];
    expect(pref?.importanceDelta).toBe(2);
  });

  it("blocks dangerous keywords from auto-applying", () => {
    const engine = createLearningEngine();
    const memory = emptyMemory();

    const signal = {
      type: "user_confirmation" as const,
      emailId: "test-1",
      sender: "test@example.com",
      originalCategory: "spam",
      suggestedAction: "delete permanently",
      timestamp: new Date().toISOString(),
    };

    const updates = engine.processSignal(signal, memory);

    expect(updates.length).toBe(0);
    expect(memory.senderPreferences["test@example.com"]).toBeUndefined();
  });

  it("requires confirmation for dangerous actions", () => {
    const engine = createLearningEngine();
    const memory = emptyMemory();

    const signal = {
      type: "user_confirmation" as const,
      emailId: "test-1",
      sender: "test@example.com",
      originalCategory: "spam",
      suggestedAction: "delete",
      timestamp: new Date().toISOString(),
    };

    const updates = engine.processSignal(signal, memory);

    expect(updates.length).toBe(0);
  });

  it("filters low confidence updates", () => {
    const engine = createLearningEngine({ minConfidenceToLearn: 0.8 });
    const memory = emptyMemory();

    const signal = {
      type: "action_executed" as const,
      emailId: "test-1",
      sender: "test@example.com",
      originalCategory: "primary",
      suggestedAction: "archive",
      timestamp: new Date().toISOString(),
    };

    const updates = engine.processSignal(signal, memory);

    expect(updates.length).toBe(0);
  });

  it("applies update only when force is true for confirmation-required updates", () => {
    const engine = createLearningEngine();
    const memory = emptyMemory();

    const update = {
      kind: "sender" as const,
      key: "test@example.com",
      value: { preferredAction: "archive", importanceDelta: 1, ignoredCount: 0 },
      confidence: 0.9,
      learnedFrom: "test",
      learnedAt: new Date().toISOString(),
      reason: "test reason",
      requiresConfirmation: true,
    };

    const result1 = engine.applyUpdate(update, memory);
    expect(result1).toBe(false);

    const result2 = engine.applyUpdate(update, memory, true);
    expect(result2).toBe(true);
    expect(memory.senderPreferences["test@example.com"]).toBeDefined();
  });

  it("detects dangerous keywords in update reason", () => {
    const engine = createLearningEngine();

    const update = {
      kind: "sender" as const,
      key: "test@example.com",
      value: { preferredAction: "delete", importanceDelta: 1, ignoredCount: 0 },
      confidence: 0.9,
      learnedFrom: "test",
      learnedAt: new Date().toISOString(),
      reason: "auto-delete all emails",
    };

    const isDangerous = engine.requiresUserConfirmation({ ...update, isDangerous: true });
    expect(isDangerous).toBe(true);
  });

  it("tracks update requiresConfirmation flag", () => {
    const engine = createLearningEngine();

    const updateWithConfirmation = {
      kind: "sender" as const,
      key: "test@example.com",
      value: { preferredAction: "archive", importanceDelta: 1, ignoredCount: 0 },
      confidence: 0.9,
      learnedFrom: "test",
      learnedAt: new Date().toISOString(),
      reason: "test",
      requiresConfirmation: true,
    };

    const result = engine.requiresUserConfirmation(updateWithConfirmation);
    expect(result).toBe(true);
  });

  it("clamps negative impact as well", () => {
    const engine = createLearningEngine({ maxImpactPerSignal: 1 });
    const memory = emptyMemory();

    memory.senderPreferences["test@example.com"] = {
      preferredAction: "archive",
      importanceDelta: 5,
      ignoredCount: 0,
    };

    const signal = {
      type: "user_rejection" as const,
      emailId: "test-1",
      sender: "test@example.com",
      originalCategory: "promotion",
      suggestedAction: "archive",
      timestamp: new Date().toISOString(),
    };

    const updates = engine.processSignal(signal, memory);
    updates.forEach((u) => engine.applyUpdate(u, memory));
    const pref = memory.senderPreferences["test@example.com"];
    expect(pref?.importanceDelta).toBe(-1);
  });
});