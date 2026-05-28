/**
 * Deep think / 主动调查触发。
 *
 * §2.2.2 触发条件命中时，先产出结构化调查建议；后续 pi 主循环会把这些建议
 * 注入 system prompt 或直接转成下一步 tool-use。
 */

import type { EmailJudgment, EmailMessage, InvestigationSuggestion } from "../data/models.js";
import type { AgentMemory } from "../data/memory.js";

export interface DeepThinkResult {
  triggered: boolean;
  reason?: string;
  suggestedTool?: string;
  suggestedArgs?: Record<string, unknown>;
}

export interface OriginalRecordCheck {
  emailId: string;
  domain?: string;
  riskNote?: string;
}

export interface InvestigationTriggerOptions {
  lowConfidenceThreshold?: number;
  maxSuggestions?: number;
}

export function suggestInvestigations(
  messages: EmailMessage[],
  judgments: EmailJudgment[],
  memory?: AgentMemory,
  options: InvestigationTriggerOptions = {},
): InvestigationSuggestion[] {
  const threshold = options.lowConfidenceThreshold ?? 0.7;
  const maxSuggestions = options.maxSuggestions ?? 3;
  const byId = new Map(messages.map((message) => [message.id, message]));
  const suggestions: InvestigationSuggestion[] = [];

  for (const judgment of judgments) {
    const message = byId.get(judgment.emailId);
    if (!message) continue;

    if (judgment.confidence < threshold) {
      suggestions.push({
        id: `investigate:${message.id}:low_confidence`,
        emailId: message.id,
        trigger: "low_confidence",
        reason: `Classification confidence ${judgment.confidence.toFixed(2)} is below ${threshold.toFixed(2)}.`,
        suggestedTool: "read_original_record",
        suggestedArgs: { kind: "email", id: message.id, maxChars: 6000 },
        priority: "medium",
      });
    }

    const suspiciousDomain = suspiciousLinkDomain(message);
    if (suspiciousDomain) {
      suggestions.push({
        id: `investigate:${message.id}:suspicious_link`,
        emailId: message.id,
        trigger: "suspicious_link",
        reason: `Message contains a URL whose domain (${suspiciousDomain}) should be verified before acting.`,
        suggestedTool: "verify_domain",
        suggestedArgs: { domain: suspiciousDomain },
        priority: "high",
      });
    }

    const preference = memory?.senderPreferences[message.sender];
    if (preference?.category && preference.category !== judgment.category) {
      suggestions.push({
        id: `investigate:${message.id}:preference_conflict`,
        emailId: message.id,
        trigger: "preference_conflict",
        reason: `Current classification (${judgment.category}) conflicts with stored sender preference (${preference.category}).`,
        suggestedTool: "recall_memory",
        suggestedArgs: { kind: "sender", sender: message.sender },
        priority: "medium",
      });
    }
  }

  return suggestions
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority))
    .slice(0, maxSuggestions);
}

export function formatInvestigationSuggestionsForPrompt(suggestions: InvestigationSuggestion[] = []): string {
  if (suggestions.length === 0) return "";
  return [
    "Active investigation suggestions:",
    ...suggestions.map((suggestion) =>
      `- ${suggestion.priority} ${suggestion.trigger} for ${suggestion.emailId}: ${suggestion.reason} Use ${suggestion.suggestedTool} with ${JSON.stringify(suggestion.suggestedArgs)}.`,
    ),
  ].join("\n");
}

function suspiciousLinkDomain(message: EmailMessage): string | null {
  const text = `${message.subject} ${message.snippet} ${message.body ?? ""}`;
  const urls = text.match(/https?:\/\/[^\s)]+/gi) ?? [];
  for (const rawUrl of urls) {
    const domain = parseDomain(rawUrl);
    if (!domain) continue;
    const senderDomain = message.sender.split("@")[1]?.toLowerCase();
    if (!senderDomain || domain !== senderDomain) return domain;
  }
  return null;
}

function parseDomain(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function priorityRank(priority: InvestigationSuggestion["priority"]): number {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}
