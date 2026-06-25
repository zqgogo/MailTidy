import { describe, expect, it } from "vitest";
import { suggestInvestigations } from "../src/agent/deepThink.js";
import { Category, type EmailJudgment, type EmailMessage } from "../src/data/models.js";
import { emptyMemory } from "../src/data/memory.js";

const message: EmailMessage = {
  id: "m-risk",
  sender: "security@example.com",
  subject: "Verify your account",
  snippet: "Please verify at https://example-login-security.test/verify",
  date: "2026-05-28T00:00:00.000Z",
};

const judgment: EmailJudgment = {
  emailId: message.id,
  category: Category.NOTIFICATION,
  confidence: 0.62,
  urgency: 3,
  reason: "Looks like an account notification.",
  actionSuggestion: "review",
};

describe("deep think investigation triggers", () => {
  it("suggests original-record lookup for low-confidence classifications", async () => {
    const suggestions = await suggestInvestigations([message], [judgment]);

    expect(suggestions).toContainEqual(expect.objectContaining({
      emailId: "m-risk",
      trigger: "low_confidence",
      suggestedTool: "read_original_record",
    }));
  });

  it("prioritizes domain verification for suspicious links", async () => {
    const suggestions = await suggestInvestigations([message], [judgment]);

    expect(suggestions[0]).toMatchObject({
      trigger: "suspicious_link",
      priority: "high",
      suggestedTool: "verify_domain",
      suggestedArgs: { domain: "example-login-security.test" },
    });
  });

  it("suggests memory recall when current judgment conflicts with sender preference", async () => {
    const memory = emptyMemory();
    memory.senderPreferences[message.sender] = {
      category: Category.IMPORTANT,
      importanceDelta: 1,
      ignoredCount: 0,
      learnedFrom: "test",
    };

    const suggestions = await suggestInvestigations([message], [judgment], memory);

    expect(suggestions).toContainEqual(expect.objectContaining({
      trigger: "preference_conflict",
      suggestedTool: "recall_memory",
      suggestedArgs: { kind: "sender", sender: "security@example.com" },
    }));
  });
});
