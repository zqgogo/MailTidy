/**
 * 决策策略：把 LLM 的判断翻译成具体可执行的动作计划。
 *
 * 所有"为什么这封邮件要做这件事"的规则都集中在这里，主循环 `agent/loop.ts`
 * 不应出现 if/else 决策分支。这样未来接入 Gmail / Outlook 时只要换 connector，
 * 决策行为完全一致。
 *
 * 思路：
 *   1. applyMemory：把用户长期偏好叠加到本次判断上（老板永远重要）。
 *   2. buildPlan：按 (action, label, 是否需要确认) 三元组聚合，得到批量动作。
 *   3. actionFor：单封邮件 → 单个动作的核心规则表。
 *
 * 后续如果要拆出"自定义规则引擎"（见 src/rules/），应在 applyMemory 之后、
 * buildPlan 之前插入 `CustomRuleEngine.apply`，避免污染本文件。
 */

import { ActionType, type AgentPlan, Category, type EmailJudgment, type PlannedAction } from "../data/models.js";
import { type AgentMemory, preferenceFor } from "../data/memory.js";

export interface DecisionPolicyOptions {
  archiveThreshold?: number;
  markReadThreshold?: number;
  autoArchivePromotions?: boolean;
}

export class DecisionPolicy {
  private readonly archiveThreshold: number;
  private readonly markReadThreshold: number;
  private readonly autoArchivePromotions: boolean;

  constructor(options: DecisionPolicyOptions = {}) {
    this.archiveThreshold = options.archiveThreshold ?? 0.85;
    this.markReadThreshold = options.markReadThreshold ?? 0.82;
    this.autoArchivePromotions = options.autoArchivePromotions ?? false;
  }

  applyMemory(judgment: EmailJudgment, sender: string, memory: AgentMemory): EmailJudgment {
    const preference = preferenceFor(memory, sender);
    if (preference.category) {
      judgment.category = preference.category as Category;
      judgment.reason = `User preference for sender overrides classification. ${judgment.reason}`;
      judgment.confidence = Math.max(judgment.confidence, 0.93);
    }
    judgment.urgency = Math.max(1, Math.min(5, judgment.urgency + preference.importanceDelta));
    return judgment;
  }

  buildPlan(intent: string, judgments: EmailJudgment[]): AgentPlan {
    const grouped = new Map<string, { action: ActionType; label?: string; requiresConfirmation: boolean; ids: string[] }>();
    const prompts: string[] = [];

    for (const judgment of judgments) {
      const decision = this.actionFor(judgment);
      const key = `${decision.action}|${decision.label ?? ""}|${decision.requiresConfirmation}`;
      const bucket = grouped.get(key);
      if (bucket) {
        bucket.ids.push(judgment.emailId);
      } else {
        grouped.set(key, { ...decision, ids: [judgment.emailId] });
      }
    }

    const actions: PlannedAction[] = [];
    for (const bucket of grouped.values()) {
      if (bucket.requiresConfirmation) {
        prompts.push(
          `Found ${bucket.ids.length} high-confidence spam/promotion email(s). Archive them?`,
        );
      }
      const action: PlannedAction = {
        action: bucket.action,
        emailIds: bucket.ids,
        reason: `Policy selected ${bucket.action}`,
        requiresConfirmation: bucket.requiresConfirmation,
      };
      if (bucket.label) action.label = bucket.label;
      actions.push(action);
    }

    return { intent, judgments, actions, humanPrompts: prompts };
  }

  private actionFor(judgment: EmailJudgment): {
    action: ActionType;
    label?: string;
    requiresConfirmation: boolean;
  } {
    if (judgment.category === Category.SPAM || judgment.category === Category.PROMOTION) {
      if (judgment.confidence >= this.archiveThreshold) {
        return { action: ActionType.ARCHIVE, requiresConfirmation: !this.autoArchivePromotions };
      }
      return { action: ActionType.REPORT_ONLY, requiresConfirmation: false };
    }
    if (judgment.category === Category.NEWSLETTER) {
      return { action: ActionType.LABEL, label: "Newsletters", requiresConfirmation: false };
    }
    if (
      judgment.category === Category.NOTIFICATION &&
      judgment.confidence >= this.markReadThreshold
    ) {
      return { action: ActionType.MARK_READ, requiresConfirmation: false };
    }
    if (judgment.category === Category.IMPORTANT || judgment.category === Category.ACTIONABLE) {
      return { action: ActionType.STAR, requiresConfirmation: false };
    }
    if (judgment.category === Category.TRANSACTIONAL) {
      return { action: ActionType.LABEL, label: "Receipts", requiresConfirmation: false };
    }
    return { action: ActionType.REPORT_ONLY, requiresConfirmation: false };
  }
}
