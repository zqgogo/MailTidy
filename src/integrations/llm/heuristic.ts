/**
 * 本地启发式 LLM 兜底实现。
 *
 * 故意做得"够用就行"：关键词命中给确定性的判断，让单测可重复。
 * 生产环境应替换为真正的 LLMClient，但保留这个类——断网 / 没 API key /
 * CI 都能让 demo 跑起来，也是 §2.1.4 兜底策略里的"最低可用线"。
 */

import type { LLMClient, ModelProfile } from "../../llm/client.js";
import { Category, type EmailJudgment, type EmailMessage, type StyleProfile } from "../../data/models.js";

export class HeuristicLLMClient implements LLMClient {
  readonly profile: ModelProfile = {
    name: "heuristic",
    provider: "local",
    supportsTools: false,
    supportsLocal: true,
  };

  async classifyEmail(
    message: EmailMessage,
    customDimensions: string[] = [],
  ): Promise<EmailJudgment> {
    const text = `${message.sender} ${message.subject} ${message.snippet}`.toLowerCase();

    // 兜底：未命中关键词时按"通知"处理，置信度故意压低，
    // 让 policy 层不会因此触发归档 / 标已读。
    let category: Category = Category.NOTIFICATION;
    let confidence = 0.72;
    let urgency = 2;
    let reason = "Looks like a general notification.";

    if (this.hits(text, ["off", "sale", "deal", "promo", "discount"])) {
      category = Category.PROMOTION;
      confidence = 0.91;
      urgency = 1;
      reason = "The email is promotional.";
    } else if (this.hits(text, ["receipt", "charged", "invoice", "payment", "order"])) {
      category = Category.TRANSACTIONAL;
      confidence = 0.88;
      urgency = 2;
      reason = "The email contains billing or transaction language.";
    } else if (this.hits(text, ["weekly", "newsletter", "digest"])) {
      category = Category.NEWSLETTER;
      confidence = 0.89;
      urgency = 1;
      reason = "The email appears to be subscribed content.";
    } else if (this.hits(text, ["approve", "reply", "urgent", "today", "action required"])) {
      category = Category.ACTIONABLE;
      confidence = 0.9;
      urgency = 4;
      reason = "The email asks for a concrete action.";
    } else if (this.hits(text, ["ci failed", "security", "failed", "alert"])) {
      category = Category.IMPORTANT;
      confidence = 0.86;
      urgency = 4;
      reason = "The notification may affect work or security.";
    }

    return {
      emailId: message.id,
      category,
      confidence,
      urgency,
      reason,
      actionSuggestion: category,
      customDimensions: this.customDimensions(message, category, customDimensions),
    };
  }

  async draftReply(message: EmailMessage, style: StyleProfile): Promise<string> {
    const opener = style.openingPatterns[0] ?? "Hi";
    const closer = style.closingPatterns[0] ?? "Best";
    const signature = style.signature ? `\n${style.signature}` : "";
    return [
      `${opener},`,
      "",
      `Thanks for the note about "${message.subject}". I can help with this, but I need to confirm `,
      `[需要你补充] before giving a final answer.`,
      "",
      `${closer},${signature}`,
    ].join("\n");
  }

  async summarizeNewsletters(messages: EmailMessage[]): Promise<string> {
    if (messages.length === 0) return "No newsletters found.";
    return messages.map((m) => `- ${m.subject}: ${m.snippet}`).join("\n");
  }

  private hits(text: string, needles: string[]): boolean {
    return needles.some((needle) => text.includes(needle));
  }

  private customDimensions(
    message: EmailMessage,
    category: Category,
    dimensions: string[],
  ): Record<string, unknown> {
    const text = `${message.subject} ${message.snippet}`.toLowerCase();
    const out: Record<string, unknown> = {};
    for (const dimension of dimensions) {
      const key = dimension.trim().toLowerCase().replace(/\s+/g, "_");
      if (key === "needs_reply" || key === "reply_required") {
        out[key] = category === Category.ACTIONABLE || /\breply\b/.test(text);
      } else if (key === "billing" || key === "cost") {
        out[key] = category === Category.TRANSACTIONAL || text.includes("$");
      } else if (key === "project") {
        out[key] = text.includes("mailtidy") ? "MailTidy" : "unknown";
      } else {
        out[key] = "unknown";
      }
    }
    return out;
  }
}
