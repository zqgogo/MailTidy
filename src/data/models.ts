/**
 * MailTidy 的核心数据模型。
 *
 * 这里定义 Agent 在整条工作流里流转的所有数据结构：邮件本身、判断结果、
 * 执行计划、统计结果、风格画像。这些类型刻意做得"贫血"（纯接口而非类），
 * 决策逻辑集中在 `agent/policies.ts` / `agent/loop.ts` 中。
 *
 * 与 Python 版（old/mailtidy/data/models.py）一一对应；
 * 新增分类 / 动作时务必同步更新：
 *   - `agent/policies.ts` 的 actionFor()
 *   - `integrations/llm/heuristic.ts` 的 classifyEmail()
 *   - `docs/agent-design.md` 默认邮件分类小节
 */

export const Category = {
  IMPORTANT: "important",
  ACTIONABLE: "actionable",
  NEWSLETTER: "newsletter",
  PROMOTION: "promotion",
  NOTIFICATION: "notification",
  SPAM: "spam",
  TRANSACTIONAL: "transactional",
} as const;
export type Category = (typeof Category)[keyof typeof Category];

export const ActionType = {
  ARCHIVE: "archive",
  LABEL: "label",
  STAR: "star",
  KEEP_UNREAD: "keep_unread",
  MARK_READ: "mark_read",
  DRAFT_REPLY: "draft_reply",
  REPORT_ONLY: "report_only",
} as const;
export type ActionType = (typeof ActionType)[keyof typeof ActionType];

export const ActionRisk = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
} as const;
export type ActionRisk = (typeof ActionRisk)[keyof typeof ActionRisk];

export interface EmailMessage {
  readonly id: string;
  readonly sender: string;
  readonly subject: string;
  readonly snippet: string;
  /** ISO timestamp; we keep strings to make serialization trivial. */
  readonly date: string;
  readonly hasAttachment?: boolean;
  readonly unread?: boolean;
  readonly body?: string;
  readonly labels?: string[];
}

export interface EmailJudgment {
  emailId: string;
  category: Category;
  confidence: number;
  urgency: number;
  reason: string;
  actionSuggestion: string;
  requiresConfirmation?: boolean;
  customDimensions?: Record<string, unknown>;
}

export interface PlannedAction {
  action: ActionType;
  emailIds: string[];
  label?: string;
  draftBody?: string;
  reason?: string;
  risk?: ActionRisk;
  requiresConfirmation?: boolean;
}

export interface AgentPlan {
  intent: string;
  judgments: EmailJudgment[];
  actions: PlannedAction[];
  humanPrompts: string[];
}

export interface ExecutionResult {
  processed: number;
  archived: number;
  labeled: number;
  starred: number;
  markedRead: number;
  draftsCreated: number;
  skippedConfirmation: number;
  notes: string[];
}

export function emptyExecutionResult(processed = 0): ExecutionResult {
  return {
    processed,
    archived: 0,
    labeled: 0,
    starred: 0,
    markedRead: 0,
    draftsCreated: 0,
    skippedConfirmation: 0,
    notes: [],
  };
}

export interface StyleProfile {
  tone: string;
  language: string;
  openingPatterns: string[];
  closingPatterns: string[];
  signature: string;
  brevity: string;
}

export function defaultStyleProfile(): StyleProfile {
  return {
    tone: "semi-formal",
    language: "mixed",
    openingPatterns: ["Hi"],
    closingPatterns: ["Best"],
    signature: "",
    brevity: "concise",
  };
}
