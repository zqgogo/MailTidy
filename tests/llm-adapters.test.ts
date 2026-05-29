import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { Category, defaultStyleProfile, type EmailMessage } from "../src/data/models.js";
import { AnthropicLLMClient } from "../src/integrations/llm/anthropic.js";
import { FallbackLLMClient } from "../src/integrations/llm/fallback.js";
import { HeuristicLLMClient } from "../src/integrations/llm/heuristic.js";
import { OpenAILLMClient } from "../src/integrations/llm/openai.js";
import type { PiComplete } from "../src/integrations/llm/piClient.js";

const message: EmailMessage = {
  id: "m1",
  sender: "boss@example.com",
  subject: "Approval needed",
  snippet: "Please approve the budget today.",
  date: "2026-05-21T09:00:00Z",
  body: "Can you approve the Q2 budget by 5pm?",
};

describe("pi-backed LLM adapters", () => {
  it("classifies email using OpenAI through the pi-ai model abstraction", async () => {
    const complete: PiComplete = async (_model, context) => {
      expect(context.messages[0]?.role).toBe("user");
      return assistant(JSON.stringify({
        category: Category.ACTIONABLE,
        confidence: 0.91,
        urgency: 5,
        reason: "Asks for approval by a deadline.",
        actionSuggestion: "reply",
        suggestion: {
          summary: "Reply today.",
          recommendedAction: "draft_reply",
          rationale: "The sender asks for approval by 5pm.",
          riskLevel: "medium",
          confidence: 0.9,
          needsUserConfirmation: true,
        },
        customDimensions: { project: "budget" },
      }));
    };
    const client = new OpenAILLMClient({ complete });

    const judgment = await client.classifyEmail(message, ["project"]);

    expect(client.profile.provider).toBe("openai");
    expect(judgment.emailId).toBe("m1");
    expect(judgment.category).toBe(Category.ACTIONABLE);
    expect(judgment.customDimensions?.project).toBe("budget");
    expect(judgment.suggestion).toMatchObject({
      summary: "Reply today.",
      recommendedAction: "draft_reply",
      riskLevel: "medium",
      needsUserConfirmation: true,
    });
  });

  it("drafts replies using Anthropic through the same narrow LLMClient interface", async () => {
    const complete: PiComplete = async () => assistant("Hi,\n\nI can review this today. [需要你补充]\n\nBest,");
    const client = new AnthropicLLMClient({ complete });

    const draft = await client.draftReply(message, defaultStyleProfile());

    expect(client.profile.provider).toBe("anthropic");
    expect(draft).toContain("[需要你补充]");
  });

  it("falls back to heuristic when a provider call fails", async () => {
    const primary = new OpenAILLMClient({
      complete: async () => {
        throw new Error("network unavailable");
      },
    });
    const events: string[] = [];
    const client = new FallbackLLMClient({
      primary,
      fallback: new HeuristicLLMClient(),
      onFallback: ({ method }) => events.push(method),
    });

    const judgment = await client.classifyEmail(message);

    expect(events).toEqual(["classifyEmail"]);
    expect(judgment.emailId).toBe(message.id);
    expect(judgment.category).toBe(Category.ACTIONABLE);
  });
});

function assistant(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openai",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}
