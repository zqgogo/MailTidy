import {
  completeSimple,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type Provider,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { Category, type EmailJudgment, type EmailMessage, type StyleProfile, type Suggestion } from "../../data/models.js";
import type { LLMClient, ModelProfile } from "../../llm/client.js";

export type PiComplete = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => Promise<AssistantMessage>;

export interface PiLLMClientOptions {
  model: Model<Api>;
  provider: Provider;
  apiKey?: string;
  temperature?: number;
  maxTokens?: number;
  complete?: PiComplete;
}

export class PiLLMClient implements LLMClient {
  readonly profile: ModelProfile;
  private readonly complete: PiComplete;

  constructor(private readonly options: PiLLMClientOptions) {
    this.complete = options.complete ?? completeSimple;
    this.profile = {
      name: options.model.id,
      provider: options.provider,
      contextWindow: options.model.contextWindow,
      supportsTools: true,
    };
  }

  async classifyEmail(message: EmailMessage, customDimensions: string[] = []): Promise<EmailJudgment> {
    const text = await this.completeText([
      "Classify this email for MailTidy.",
      "Return only compact JSON with keys: category, confidence, urgency, reason, actionSuggestion, suggestion, requiresConfirmation, customDimensions.",
      "suggestion must have exactly these keys: summary, recommendedAction, rationale, riskLevel, confidence, needsUserConfirmation.",
      `Allowed categories: ${Object.values(Category).join(", ")}.`,
      customDimensions.length > 0 ? `Custom dimensions to fill: ${customDimensions.join(", ")}.` : "",
      "",
      emailBlock(message),
    ].join("\n"));
    const raw = parseJsonObject(text);
    const category = typeof raw.category === "string" && isCategory(raw.category)
      ? raw.category
      : Category.NOTIFICATION;
    return {
      emailId: message.id,
      category,
      confidence: numberInRange(raw.confidence, 0, 1, 0.5),
      urgency: numberInRange(raw.urgency, 1, 5, 2),
      reason: stringValue(raw.reason, "Model did not provide a reason."),
      actionSuggestion: stringValue(raw.actionSuggestion, "review"),
      suggestion: suggestionValue(raw.suggestion, {
        summary: stringValue(raw.actionSuggestion, "Review this email."),
        recommendedAction: stringValue(raw.actionSuggestion, "review"),
        rationale: stringValue(raw.reason, "Model did not provide a rationale."),
        riskLevel: "unknown",
        confidence: numberInRange(raw.confidence, 0, 1, 0.5),
        needsUserConfirmation: Boolean(raw.requiresConfirmation),
      }),
      requiresConfirmation: Boolean(raw.requiresConfirmation),
      customDimensions: objectValue(raw.customDimensions),
    };
  }

  async draftReply(message: EmailMessage, style: StyleProfile): Promise<string> {
    return this.completeText([
      "Draft a concise email reply for the user.",
      "Use only known facts. Use [需要你补充] placeholders for missing commitments, dates, numbers, approvals, or sensitive details.",
      "Never claim the user has approved, paid, signed, sent, or committed unless the email text proves it.",
      "",
      `Style: tone=${style.tone}; language=${style.language}; opening=${style.openingPatterns.join(" / ")}; closing=${style.closingPatterns.join(" / ")}; brevity=${style.brevity}; signature=${style.signature || "(none)"}.`,
      "",
      emailBlock(message),
    ].join("\n"));
  }

  async summarizeNewsletters(messages: EmailMessage[]): Promise<string> {
    if (messages.length === 0) return "- No newsletters found.";
    return this.completeText([
      "Summarize these newsletters as short Markdown bullets for a busy inbox owner.",
      "Prefer concrete topics over generic wording.",
      "",
      messages.map(emailBlock).join("\n\n---\n\n"),
    ].join("\n"));
  }

  private async completeText(prompt: string): Promise<string> {
    const message = await this.complete(
      this.options.model,
      { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
      {
        apiKey: this.options.apiKey,
        temperature: this.options.temperature ?? 0.2,
        maxTokens: this.options.maxTokens ?? 900,
      },
    );
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (!text) throw new Error(`${this.options.provider} ${this.options.model.id} returned no text.`);
    return text;
  }
}

function emailBlock(message: EmailMessage): string {
  return [
    `Email ID: ${message.id}`,
    `From: ${message.sender}`,
    `Subject: ${message.subject}`,
    `Date: ${message.date}`,
    `Snippet: ${message.snippet}`,
    message.body ? `Body: ${message.body}` : "",
  ].filter(Boolean).join("\n");
}

function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  const parsed = JSON.parse(candidate) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model response was not a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function isCategory(value: string): value is Category {
  return (Object.values(Category) as string[]).includes(value);
}

function numberInRange(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function suggestionValue(value: unknown, fallback: Suggestion): Suggestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const raw = value as Record<string, unknown>;
  return {
    summary: stringValue(raw.summary, fallback.summary),
    recommendedAction: stringValue(raw.recommendedAction, fallback.recommendedAction),
    rationale: stringValue(raw.rationale, fallback.rationale),
    riskLevel: riskLevelValue(raw.riskLevel, fallback.riskLevel),
    confidence: numberInRange(raw.confidence, 0, 1, fallback.confidence),
    needsUserConfirmation: typeof raw.needsUserConfirmation === "boolean"
      ? raw.needsUserConfirmation
      : fallback.needsUserConfirmation,
  };
}

function riskLevelValue(value: unknown, fallback: Suggestion["riskLevel"]): Suggestion["riskLevel"] {
  if (value === "low" || value === "medium" || value === "high" || value === "unknown") return value;
  return fallback;
}
