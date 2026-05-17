/**
 * 报告生成：把 AgentPlan / ExecutionResult 转成人类可读输出。
 *
 * 让"决策逻辑"和"展示逻辑"严格分离，未来要换 HTML / Slack Block Kit /
 * Telegram Markdown 等格式时只动这里。
 */

import { Category, type AgentPlan, type EmailMessage, type ExecutionResult } from "./models.js";

export interface SubscriptionRow {
  serviceName: string;
  monthlyAmount: number;
  currency: string;
  billingCycle: string;
  lastChargeDate: string;
  planName: string;
  category: string;
  unsubscribeLink?: string;
}

export function cleanupReport(
  plan: AgentPlan,
  result: ExecutionResult,
  messages: EmailMessage[],
  newsletterSummary: string,
): string {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const attention = plan.judgments.filter(
    (j) => j.category === Category.IMPORTANT || j.category === Category.ACTIONABLE,
  );
  const lines = [
    "# MailTidy Cleanup Report",
    "",
    `- Processed: ${result.processed}`,
    `- Archived: ${result.archived}`,
    `- Labeled: ${result.labeled}`,
    `- Starred: ${result.starred}`,
    `- Marked read: ${result.markedRead}`,
    `- Estimated cost: development heuristic mode ($0.00)`,
    "",
    "## Needs Your Attention",
  ];
  if (attention.length === 0) {
    lines.push("- None");
  } else {
    for (const j of attention) {
      const m = byId.get(j.emailId);
      if (!m) continue;
      lines.push(`- ${m.sender}: ${m.subject} - ${j.reason}`);
    }
  }
  lines.push("", "## Newsletter Summary", newsletterSummary);
  if (plan.humanPrompts.length > 0) {
    lines.push("", "## Confirmation Needed", ...plan.humanPrompts.map((p) => `- ${p}`));
  }
  return lines.join("\n");
}

export function dailyBrief(plan: AgentPlan, messages: EmailMessage[]): string {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const groups: Array<[string, typeof plan.judgments]> = [
    ["Urgent Today", plan.judgments.filter((j) => j.urgency >= 4)],
    ["Important This Week", plan.judgments.filter((j) => j.urgency >= 2 && j.urgency < 4)],
    ["FYI", plan.judgments.filter((j) => j.urgency < 2)],
  ];
  const lines = ["# MailTidy Daily Brief", ""];
  for (const [title, judgments] of groups) {
    lines.push(`## ${title}`);
    if (judgments.length === 0) lines.push("- None");
    for (const j of judgments) {
      const m = byId.get(j.emailId);
      if (!m) continue;
      lines.push(`- [${m.sender}] ${m.subject} - ${m.snippet} - ${j.actionSuggestion}`);
    }
    lines.push("");
  }
  const replies = plan.judgments.filter((j) => j.category === Category.ACTIONABLE).length;
  lines.push(`Unread: ${messages.length}; likely needs reply: ${replies}`);
  return lines.join("\n");
}

export function subscriptionsMarkdown(rows: SubscriptionRow[]): string {
  const total = rows.reduce((sum, r) => sum + r.monthlyAmount, 0);
  const lines = [
    "# Subscription Scan",
    "",
    `You have ${rows.length} likely active subscription(s), about $${total.toFixed(2)}/month.`,
    "",
    "| Service | Monthly | Category | Last Charge | Plan |",
    "| --- | ---: | --- | --- | --- |",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.serviceName} | $${r.monthlyAmount.toFixed(2)} | ${r.category} | ${r.lastChargeDate} | ${r.planName} |`,
    );
  }
  return lines.join("\n");
}

export function subscriptionsCsv(rows: SubscriptionRow[]): string {
  const fieldnames = [
    "service_name",
    "monthly_amount",
    "currency",
    "billing_cycle",
    "last_charge_date",
    "plan_name",
    "category",
  ];
  const out: string[] = [fieldnames.join(",")];
  for (const r of rows) {
    out.push(
      [
        r.serviceName,
        r.monthlyAmount.toFixed(2),
        r.currency,
        r.billingCycle,
        r.lastChargeDate,
        r.planName,
        r.category,
      ]
        .map((v) => (typeof v === "string" && v.includes(",") ? `"${v}"` : String(v)))
        .join(","),
    );
  }
  return out.join("\n") + "\n";
}
