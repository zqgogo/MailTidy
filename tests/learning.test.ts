import { describe, expect, it } from "vitest";
import {
  createLearningEngine,
  createLearningSignal,
  type LearningSignal,
} from "../src/data/learning.js";
import { emptyMemory } from "../src/data/memory.js";
import { Category } from "../src/data/models.js";

describe("LearningEngine", () => {
  it("processes user confirmation signals", () => {
    const engine = createLearningEngine();
    const memory = emptyMemory();
    const signal: LearningSignal = {
      type: "user_confirmation",
      emailId: "m1",
      sender: "newsletter@example.com",
      originalCategory: Category.NEWSLETTER,
      suggestedAction: "archive",
      timestamp: new Date().toISOString(),
    };

    const updates = engine.processSignal(signal, memory);

    expect(updates.length).toBe(1);
    expect(updates[0].kind).toBe("sender");
    expect(updates[0].key).toBe("newsletter@example.com");
    expect(updates[0].confidence).toBe(0.8);
    expect(updates[0].learnedFrom).toContain("user_confirmation");
  });

  it("processes user rejection signals", () => {
    const engine = createLearningEngine();
    const memory = emptyMemory();
    const signal: LearningSignal = {
      type: "user_rejection",
      emailId: "m1",
      sender: "boss@company.com",
      originalCategory: Category.IMPORTANT,
      suggestedAction: "archive",
      timestamp: new Date().toISOString(),
    };

    const updates = engine.processSignal(signal, memory);

    expect(updates.length).toBe(1);
    expect(updates[0].kind).toBe("sender");
    expect((updates[0].value as { preferredAction: string }).preferredAction).toBe("ask");
    expect(updates[0].confidence).toBe(0.7);
  });

  it("processes user correction signals", () => {
    const engine = createLearningEngine();
    const memory = emptyMemory();
    const signal: LearningSignal = {
      type: "user_correction",
      emailId: "m1",
      sender: "billing@service.com",
      originalCategory: Category.PROMOTION,
      suggestedAction: "archive",
      correctedCategory: Category.TRANSACTIONAL,
      timestamp: new Date().toISOString(),
    };

    const updates = engine.processSignal(signal, memory);

    expect(updates.length).toBe(1);
    expect(updates[0].kind).toBe("sender");
    expect((updates[0].value as { category: string }).category).toBe(Category.TRANSACTIONAL);
    expect(updates[0].confidence).toBe(0.9);
  });

  it("rejects dangerous updates", () => {
    const engine = createLearningEngine();
    const memory = emptyMemory();
    const signal: LearningSignal = {
      type: "user_confirmation",
      emailId: "m1",
      sender: "test@example.com",
      originalCategory: Category.SPAM,
      suggestedAction: "delete all permanently",
      timestamp: new Date().toISOString(),
    };

    const updates = engine.processSignal(signal, memory);

    expect(updates.length).toBe(0);
  });

  it("applies updates to memory", () => {
    const engine = createLearningEngine();
    const memory = emptyMemory();
    const signal: LearningSignal = {
      type: "user_confirmation",
      emailId: "m1",
      sender: "newsletter@example.com",
      originalCategory: Category.NEWSLETTER,
      suggestedAction: "archive",
      timestamp: new Date().toISOString(),
    };

    const updates = engine.processSignal(signal, memory);
    expect(updates.length).toBe(1);

    const applied = engine.applyUpdate(updates[0], memory);
    expect(applied).toBe(true);

    const pref = memory.senderPreferences["newsletter@example.com"];
    expect(pref).toBeDefined();
    expect(pref.preferredAction).toBe("archive");
    expect(pref.category).toBe(Category.NEWSLETTER);
  });

  it("proposes preferences from confirmation patterns", () => {
    const engine = createLearningEngine({ autoConfirmThreshold: 3 });
    const memory = emptyMemory();
    const logs: LearningSignal[] = [
      { type: "user_confirmation", emailId: "m1", sender: "news@a.com", originalCategory: Category.NEWSLETTER, suggestedAction: "archive", timestamp: new Date().toISOString() },
      { type: "user_confirmation", emailId: "m2", sender: "news@a.com", originalCategory: Category.NEWSLETTER, suggestedAction: "archive", timestamp: new Date().toISOString() },
      { type: "user_confirmation", emailId: "m3", sender: "news@a.com", originalCategory: Category.NEWSLETTER, suggestedAction: "archive", timestamp: new Date().toISOString() },
    ];

    const proposals = engine.proposePreferencesFromLogs(logs, memory, 7);

    expect(proposals.length).toBe(1);
    expect(proposals[0].key).toBe("news@a.com");
    expect((proposals[0].value as { preferredAction: string }).preferredAction).toBe("archive");
    expect(proposals[0].confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("processes multiple signals in batch", () => {
    const engine = createLearningEngine();
    const memory = emptyMemory();
    const signals: LearningSignal[] = [
      { type: "user_confirmation", emailId: "m1", sender: "a@b.com", originalCategory: Category.NEWSLETTER, suggestedAction: "archive", timestamp: new Date().toISOString() },
      { type: "user_rejection", emailId: "m2", sender: "c@d.com", originalCategory: Category.IMPORTANT, suggestedAction: "archive", timestamp: new Date().toISOString() },
    ];

    const result = engine.processSignals(signals, memory);

    expect(result.updates.length).toBe(2);
    expect(result.notes.length).toBe(2);
    expect(result.rejectedSignals.length).toBe(0);
  });

  it("respects max impact per signal limit", () => {
    const engine = createLearningEngine({ maxImpactPerSignal: 2 });
    const memory = emptyMemory();
    
    memory.senderPreferences["test@example.com"] = {
      category: Category.NEWSLETTER,
      preferredAction: "archive",
      importanceDelta: 2,
      ignoredCount: 0,
    };

    const signal: LearningSignal = {
      type: "user_confirmation",
      emailId: "m1",
      sender: "test@example.com",
      originalCategory: Category.NEWSLETTER,
      suggestedAction: "archive",
      timestamp: new Date().toISOString(),
    };

    const updates = engine.processSignal(signal, memory);
    
    expect(updates.length).toBe(1);
    expect((updates[0].value as { importanceDelta: number }).importanceDelta).toBe(2);
  });

  it("filters low confidence updates", () => {
    const engine = createLearningEngine({ minConfidenceToLearn: 0.8 });
    const memory = emptyMemory();
    const signal: LearningSignal = {
      type: "action_executed",
      emailId: "m1",
      sender: "test@example.com",
      originalCategory: Category.NOTIFICATION,
      suggestedAction: "markRead",
      timestamp: new Date().toISOString(),
    };

    const updates = engine.processSignal(signal, memory);

    expect(updates.length).toBe(0);
  });
});

describe("createLearningSignal", () => {
  it("creates signal from message and judgment", () => {
    const message = {
      id: "m1",
      sender: "test@example.com",
      subject: "Test",
      snippet: "Test snippet",
      date: new Date().toISOString(),
      unread: true,
    };
    const judgment = {
      emailId: "m1",
      category: Category.NEWSLETTER,
      confidence: 0.9,
      urgency: 1,
      reason: "test",
      actionSuggestion: "archive",
    };

    const signal = createLearningSignal("user_confirmation", message, judgment);

    expect(signal.type).toBe("user_confirmation");
    expect(signal.emailId).toBe("m1");
    expect(signal.sender).toBe("test@example.com");
    expect(signal.originalCategory).toBe(Category.NEWSLETTER);
    expect(signal.suggestedAction).toBe("archive");
    expect(signal.timestamp).toBeDefined();
  });
});