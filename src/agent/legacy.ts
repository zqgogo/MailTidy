/**
 * 遗留的"流水线 SOP 编排"实现（Python 版 mailtidy/agent/legacy.py 的直译）。
 *
 * 这是迁移期的兼容层：让 demo 在 Phase 1 主循环（agent/loop.ts）落地之前
 * 还能跑。所有 SOP 都是简单的 fetch → classify → policy → execute → report
 * 流水线，没有 ReAct，没有主动调查，没有 checkpoint。
 *
 * Phase 1 完成后这个文件会被 `agent/loop.ts` 取代并删除。
 *
 * 四个 public 方法对应四条 SOP：
 *   - runCleanup       收件箱清理 + 报告
 *   - draftReplies     为 actionable 邮件批量草拟回复
 *   - dailyBriefing    早晨 2 分钟阅读的日报
 *   - scanSubscriptions 订阅费扫描 → Markdown + CSV
 */

import { ActionType, type AgentPlan, Category, type EmailMessage, type ExecutionResult, emptyExecutionResult } from "../data/models.js";
import { type AgentMemory, emptyMemory } from "../data/memory.js";
import {
  cleanupReport,
  dailyBrief,
  type SubscriptionRow,
  subscriptionsCsv,
  subscriptionsMarkdown,
} from "../data/reports.js";
import type { EmailConnector } from "../integrations/email/base.js";
import type { LLMClient } from "../llm/client.js";
import { DecisionPolicy } from "./policies.js";

export interface LegacyAgentOptions {
  connector: EmailConnector;
  llm: LLMClient;
  memory?: AgentMemory;
  policy?: DecisionPolicy;
}

export class LegacyMailTidyAgent {
  readonly memory: AgentMemory;
  private readonly connector: EmailConnector;
  private readonly llm: LLMClient;
  private readonly policy: DecisionPolicy;

  constructor(opts: LegacyAgentOptions) {
    this.connector = opts.connector;
    this.llm = opts.llm;
    this.memory = opts.memory ?? emptyMemory();
    this.policy = opts.policy ?? new DecisionPolicy();
  }

  async planCleanup(options: {
    hours?: number;
    limit?: number;
    customDimensions?: string[];
  } = {}): Promise<{ plan: AgentPlan; messages: EmailMessage[] }> {
    const messages = await this.connector.fetchRecent({
      hours: options.hours ?? 24,
      limit: options.limit ?? 200,
      unreadOnly: true,
    });
    const judgments = [];
    for (const message of messages) {
      const raw = await this.llm.classifyEmail(message, options.customDimensions);
      judgments.push(this.policy.applyMemory(raw, message.sender, this.memory));
    }
    return { plan: this.policy.buildPlan("inbox_cleanup", judgments), messages };
  }

  async executePlan(plan: AgentPlan, autoConfirm = false): Promise<ExecutionResult> {
    const result = emptyExecutionResult(plan.judgments.length);
    for (const action of plan.actions) {
      if (action.requiresConfirmation && !autoConfirm) {
        result.skippedConfirmation += action.emailIds.length;
        continue;
      }
      switch (action.action) {
        case ActionType.ARCHIVE:
          await this.connector.archive(action.emailIds);
          result.archived += action.emailIds.length;
          break;
        case ActionType.LABEL:
          if (action.label) {
            await this.connector.label(action.emailIds, action.label);
            result.labeled += action.emailIds.length;
          }
          break;
        case ActionType.STAR:
          await this.connector.star(action.emailIds);
          result.starred += action.emailIds.length;
          break;
        case ActionType.MARK_READ:
          await this.connector.markRead(action.emailIds);
          result.markedRead += action.emailIds.length;
          break;
        default:
          break;
      }
    }
    return result;
  }

  async runCleanup(options: {
    hours?: number;
    limit?: number;
    customDimensions?: string[];
    autoConfirm?: boolean;
  } = {}): Promise<string> {
    const { plan, messages } = await this.planCleanup(options);
    const result = await this.executePlan(plan, options.autoConfirm);
    const newsletters = messages.filter((m) => this.categoryFor(plan, m.id) === Category.NEWSLETTER);
    const summary = await this.llm.summarizeNewsletters(newsletters);
    return cleanupReport(plan, result, messages, summary);
  }

  async draftReplies(emailIds?: string[]): Promise<ExecutionResult> {
    const { plan, messages } = await this.planCleanup({ hours: 24, limit: 200 });
    const actionable = messages.filter(
      (m) =>
        this.categoryFor(plan, m.id) === Category.ACTIONABLE &&
        (emailIds === undefined || emailIds.includes(m.id)),
    );
    const result = emptyExecutionResult(actionable.length);
    for (const message of actionable) {
      const draft = await this.llm.draftReply(message, this.memory.styleProfile);
      await this.connector.saveDraft(message.id, draft);
      result.draftsCreated += 1;
    }
    return result;
  }

  async dailyBriefing(customDimensions?: string[]): Promise<string> {
    const opts: { hours: number; limit: number; customDimensions?: string[] } = {
      hours: 14,
      limit: 200,
    };
    if (customDimensions !== undefined) opts.customDimensions = customDimensions;
    const { plan, messages } = await this.planCleanup(opts);
    return dailyBrief(plan, messages);
  }

  async scanSubscriptions(): Promise<{ markdown: string; csv: string }> {
    const queries = [
      '"subscription confirmation"',
      '"payment receipt"',
      '"renewal notice"',
      '"monthly charge"',
      '"your plan"',
      '"billing statement"',
    ];
    const seen = new Map<string, SubscriptionRow>();
    for (const query of queries) {
      for (const message of await this.connector.search(query, 6)) {
        const row = this.extractSubscription(message);
        const key = row.serviceName.toLowerCase();
        const current = seen.get(key);
        if (!current || row.lastChargeDate > current.lastChargeDate) {
          seen.set(key, row);
        }
      }
    }
    const rows = [...seen.values()].sort((a, b) => a.serviceName.localeCompare(b.serviceName));
    this.memory.subscriptionHistory.push({
      scannedAt: new Date().toISOString(),
      items: rows as unknown as Record<string, unknown>[],
    });
    return { markdown: subscriptionsMarkdown(rows), csv: subscriptionsCsv(rows) };
  }

  private categoryFor(plan: AgentPlan, emailId: string): Category | undefined {
    return plan.judgments.find((j) => j.emailId === emailId)?.category;
  }

  private extractSubscription(message: EmailMessage): SubscriptionRow {
    const text = `${message.subject} ${message.snippet} ${message.body ?? ""}`;
    const amountMatch = text.match(/\$([0-9]+(?:\.[0-9]{2})?)/);
    const amount = amountMatch?.[1] ? parseFloat(amountMatch[1]) : 0;
    const domain = message.sender.split("@")[1] ?? "";
    const service = (domain.split(".")[0] ?? "Unknown").replace(/^./, (c) => c.toUpperCase());
    const planMatch = text.match(/Premium|Plus|Pro|Basic|Team|Enterprise/i);
    return {
      serviceName: service,
      monthlyAmount: amount,
      currency: "USD",
      billingCycle: "monthly",
      lastChargeDate: message.date.slice(0, 10),
      planName: planMatch ? planMatch[0].replace(/^./, (c) => c.toUpperCase()) : "Unknown",
      category: this.subscriptionCategory(service),
    };
  }

  private subscriptionCategory(service: string): string {
    const s = service.toLowerCase();
    if (["netflix", "spotify", "hulu"].includes(s)) return "entertainment";
    if (["notion", "github", "slack"].includes(s)) return "productivity";
    return "other";
  }
}
