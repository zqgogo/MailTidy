/**
 * 本地开发 / 单测用的假邮箱实现。
 *
 * - 内置一组覆盖常见分类的样例邮件（重要 / newsletter / 促销 / 通知 / 账单）。
 * - 写动作不真的修改邮件，只把操作字符串追加到 `operations` 里，让单测可以
 *   断言"是否调用过 archive:m3"。
 */

import type { EmailConnector, FetchRecentOptions } from "./base.js";
import type { EmailMessage } from "../../data/models.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

export class MockEmailConnector implements EmailConnector {
  readonly operations: string[] = [];
  readonly messages: EmailMessage[] = [
    {
      id: "m1",
      sender: "ceo@example.com",
      subject: "Need your approval today",
      snippet: "Please approve the Q2 budget by 5pm.",
      date: isoAgo(1 * HOUR_MS),
      unread: true,
    },
    {
      id: "m2",
      sender: "news@productweekly.com",
      subject: "Product Weekly #182",
      snippet: "AI tools, SaaS metrics, and three long reads.",
      date: isoAgo(2 * HOUR_MS),
      unread: true,
    },
    {
      id: "m3",
      sender: "deals@shop.example",
      subject: "70% off today only",
      snippet: "Flash sale ends tonight.",
      date: isoAgo(3 * HOUR_MS),
      unread: true,
    },
    {
      id: "m4",
      sender: "github@github.com",
      subject: "[MailTidy] CI failed",
      snippet: "Build failed on main branch.",
      date: isoAgo(4 * HOUR_MS),
      unread: true,
    },
    {
      id: "m5",
      sender: "billing@notion.so",
      subject: "Your Notion receipt",
      snippet: "Payment receipt: you were charged $10.00 for your monthly plan.",
      date: isoAgo(10 * DAY_MS),
      unread: true,
      body: "Your plan: Plus. Amount: $10.00 monthly.",
    },
    {
      id: "m6",
      sender: "billing@netflix.com",
      subject: "Your Netflix payment",
      snippet: "Payment receipt: your card was charged $15.99.",
      date: isoAgo(20 * DAY_MS),
      unread: true,
      body: "Your plan: Premium. Amount: $15.99 monthly.",
    },
  ];

  async fetchRecent(options: FetchRecentOptions = {}): Promise<EmailMessage[]> {
    const { hours = 24, limit = 200, unreadOnly = true } = options;
    const cutoff = Date.now() - hours * HOUR_MS;
    let items = this.messages.filter((m) => new Date(m.date).getTime() >= cutoff);
    if (unreadOnly) items = items.filter((m) => m.unread);
    return items.slice(0, limit);
  }

  async search(query: string, months: number = 6): Promise<EmailMessage[]> {
    // 去掉外层引号，让 `"payment receipt"` 这样的查询能正确匹配。
    const phrase = query.trim().replace(/^"|"$/g, "").toLowerCase();
    const cutoff = Date.now() - months * 30 * DAY_MS;
    return this.messages.filter((m) => {
      const haystack = `${m.sender} ${m.subject} ${m.snippet} ${m.body ?? ""}`.toLowerCase();
      return new Date(m.date).getTime() >= cutoff && haystack.includes(phrase);
    });
  }

  async readById(emailId: string): Promise<EmailMessage | null> {
    return this.messages.find((message) => message.id === emailId) ?? null;
  }

  async archive(emailIds: string[]): Promise<void> {
    this.operations.push(`archive:${emailIds.join(",")}`);
  }
  async label(emailIds: string[], label: string): Promise<void> {
    this.operations.push(`label:${label}:${emailIds.join(",")}`);
  }
  async star(emailIds: string[]): Promise<void> {
    this.operations.push(`star:${emailIds.join(",")}`);
  }
  async markRead(emailIds: string[]): Promise<void> {
    this.operations.push(`mark_read:${emailIds.join(",")}`);
  }
  async saveDraft(emailId: string, body: string): Promise<void> {
    // 截断到 24 字符，避免单测断言时受 LLM 输出长短影响
    this.operations.push(`draft:${emailId}:${body.slice(0, 24)}`);
  }
}
