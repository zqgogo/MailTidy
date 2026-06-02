/**
 * 学习层：纯函数，输入"信号"输出"偏好更新"。
 *
 * §2.8 Agent 意识 + §4.3 学习层在这里落实：
 *   - 同步学习信号：ask_user 回调、apply_action 后写决策日志
 *   - 异步学习提议器：扫近 N 天决策日志，候选偏好作为开场提问
 *   - 学习安全边界：单次反馈影响有上限；危险偏好必须 raise 而不是写入
 */

import type { AgentMemory, SenderPreference } from "./memory.js";
import type { EmailJudgment, EmailMessage, ExecutionResult } from "./models.js";

export interface LearningSignal {
  type: "user_confirmation" | "user_rejection" | "user_correction" | "action_executed" | "action_skipped";
  emailId: string;
  sender: string;
  originalCategory: string;
  suggestedAction: string;
  userResponse?: string;
  correctedCategory?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface PreferenceUpdate {
  kind: "sender" | "action" | "style";
  key: string;
  value: unknown;
  confidence: number;
  learnedFrom: string;
  learnedAt: string;
  reason: string;
  isDangerous?: boolean;
}

export interface LearningResult {
  updates: PreferenceUpdate[];
  notes: string[];
  rejectedSignals: LearningSignal[];
}

export interface LearningOptions {
  /** 同一发件人确认几次后才自动执行。默认 3。 */
  autoConfirmThreshold?: number;
  /** 单次反馈的最大影响值。默认 2。 */
  maxImpactPerSignal?: number;
  /** 低置信度阈值，低于此值不学习。默认 0.5。 */
  minConfidenceToLearn?: number;
  /** 危险关键词，命中时标记为危险偏好。 */
  dangerousKeywords?: string[];
}

const DEFAULT_OPTIONS: Required<LearningOptions> = {
  autoConfirmThreshold: 3,
  maxImpactPerSignal: 2,
  minConfidenceToLearn: 0.5,
  dangerousKeywords: ["delete", "permanently", "all", "every", "auto-send", "forward-all"],
};

export class LearningEngine {
  private readonly options: Required<LearningOptions>;

  constructor(options: LearningOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * 处理单个学习信号，输出偏好更新建议。
   * 纯函数：不修改内存，只返回更新建议。
   */
  processSignal(signal: LearningSignal, memory: AgentMemory): PreferenceUpdate[] {
    const updates: PreferenceUpdate[] = [];

    switch (signal.type) {
      case "user_confirmation":
        updates.push(...this.handleConfirmation(signal, memory));
        break;
      case "user_rejection":
        updates.push(...this.handleRejection(signal, memory));
        break;
      case "user_correction":
        updates.push(...this.handleCorrection(signal, memory));
        break;
      case "action_executed":
        updates.push(...this.handleActionExecuted(signal, memory));
        break;
      case "action_skipped":
        updates.push(...this.handleActionSkipped(signal, memory));
        break;
    }

    return updates.filter((u) => this.isSafeUpdate(u));
  }

  /**
   * 批量处理多个信号，聚合更新建议。
   */
  processSignals(signals: LearningSignal[], memory: AgentMemory): LearningResult {
    const updates: PreferenceUpdate[] = [];
    const notes: string[] = [];
    const rejectedSignals: LearningSignal[] = [];

    for (const signal of signals) {
      const signalUpdates = this.processSignal(signal, memory);
      if (signalUpdates.length === 0) {
        rejectedSignals.push(signal);
        notes.push(`Rejected signal for ${signal.sender}: no safe updates generated`);
      } else {
        updates.push(...signalUpdates);
        notes.push(`Processed ${signal.type} for ${signal.sender}: ${signalUpdates.length} update(s)`);
      }
    }

    return { updates, notes, rejectedSignals };
  }

  /**
   * 基于决策日志生成学习提议。
   * 扫描近 N 天的决策，找出可以自动化的模式。
   */
  proposePreferencesFromLogs(
    logs: LearningSignal[],
    memory: AgentMemory,
    days: number = 7,
  ): PreferenceUpdate[] {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const recentLogs = logs.filter((log) => new Date(log.timestamp) >= cutoff);
    const updates: PreferenceUpdate[] = [];

    const bySender = this.groupBySender(recentLogs);
    for (const [sender, senderLogs] of bySender) {
      const confirmCount = senderLogs.filter((l) => l.type === "user_confirmation").length;
      const currentPref = memory.senderPreferences[sender.toLowerCase()];

      if (confirmCount >= this.options.autoConfirmThreshold) {
        const dominantAction = this.findDominantAction(senderLogs);
        if (dominantAction && currentPref?.preferredAction !== dominantAction) {
          updates.push({
            kind: "sender",
            key: sender,
            value: {
              ...currentPref,
              preferredAction: dominantAction,
              importanceDelta: Math.min((currentPref?.importanceDelta ?? 0) + 1, this.options.maxImpactPerSignal),
            },
            confidence: Math.min(confirmCount / this.options.autoConfirmThreshold, 0.95),
            learnedFrom: `auto_confirm_pattern_${confirmCount}_times`,
            learnedAt: new Date().toISOString(),
            reason: `User confirmed ${dominantAction} for ${sender} ${confirmCount} times in the last ${days} days`,
          });
        }
      }
    }

    return updates;
  }

  /**
   * 应用更新到内存，返回是否成功。
   */
  applyUpdate(update: PreferenceUpdate, memory: AgentMemory): boolean {
    if (update.isDangerous) {
      return false;
    }

    switch (update.kind) {
      case "sender":
        memory.senderPreferences[update.key.toLowerCase()] = update.value as SenderPreference;
        break;
      case "action":
        memory.actionPreferences[update.key] = update.value as string;
        break;
      case "style":
        // Style updates handled separately
        break;
    }

    return true;
  }

  private handleConfirmation(signal: LearningSignal, memory: AgentMemory): PreferenceUpdate[] {
    const updates: PreferenceUpdate[] = [];
    const currentPref = memory.senderPreferences[signal.sender.toLowerCase()];
    const newConfirmCount = (currentPref?.ignoredCount ?? 0) + 1;

    updates.push({
      kind: "sender",
      key: signal.sender,
      value: {
        ...currentPref,
        category: signal.originalCategory,
        preferredAction: signal.suggestedAction,
        importanceDelta: Math.min((currentPref?.importanceDelta ?? 0) + 1, this.options.maxImpactPerSignal),
      },
      confidence: 0.8,
      learnedFrom: `user_confirmation_${signal.timestamp}`,
      learnedAt: new Date().toISOString(),
      reason: `User confirmed ${signal.suggestedAction} for ${signal.originalCategory} email from ${signal.sender}`,
    });

    return updates;
  }

  private handleRejection(signal: LearningSignal, _memory: AgentMemory): PreferenceUpdate[] {
    return [
      {
        kind: "sender",
        key: signal.sender,
        value: {
          category: signal.originalCategory,
          preferredAction: "ask",
          importanceDelta: -1,
        },
        confidence: 0.7,
        learnedFrom: `user_rejection_${signal.timestamp}`,
        learnedAt: new Date().toISOString(),
        reason: `User rejected ${signal.suggestedAction} for ${signal.sender}, will ask next time`,
      },
    ];
  }

  private handleCorrection(signal: LearningSignal, _memory: AgentMemory): PreferenceUpdate[] {
    if (!signal.correctedCategory) return [];

    return [
      {
        kind: "sender",
        key: signal.sender,
        value: {
          category: signal.correctedCategory,
          importanceDelta: 1,
        },
        confidence: 0.9,
        learnedFrom: `user_correction_${signal.timestamp}`,
        learnedAt: new Date().toISOString(),
        reason: `User corrected classification from ${signal.originalCategory} to ${signal.correctedCategory}`,
      },
    ];
  }

  private handleActionExecuted(signal: LearningSignal, _memory: AgentMemory): PreferenceUpdate[] {
    return [
      {
        kind: "action",
        key: `${signal.suggestedAction}:${signal.sender}`,
        value: "auto",
        confidence: 0.6,
        learnedFrom: `action_executed_${signal.timestamp}`,
        learnedAt: new Date().toISOString(),
        reason: `Action ${signal.suggestedAction} was executed for ${signal.sender}`,
      },
    ];
  }

  private handleActionSkipped(signal: LearningSignal, _memory: AgentMemory): PreferenceUpdate[] {
    return [
      {
        kind: "action",
        key: `${signal.suggestedAction}:${signal.sender}`,
        value: "confirm",
        confidence: 0.6,
        learnedFrom: `action_skipped_${signal.timestamp}`,
        learnedAt: new Date().toISOString(),
        reason: `Action ${signal.suggestedAction} was skipped for ${signal.sender}, requires confirmation`,
      },
    ];
  }

  private isSafeUpdate(update: PreferenceUpdate): boolean {
    const content = `${update.key} ${update.reason}`.toLowerCase();
    const hasDangerous = this.options.dangerousKeywords.some((kw) => content.includes(kw.toLowerCase()));
    
    if (hasDangerous) {
      update.isDangerous = true;
      return false;
    }

    if (update.confidence < this.options.minConfidenceToLearn) {
      return false;
    }

    return true;
  }

  private groupBySender(logs: LearningSignal[]): Map<string, LearningSignal[]> {
    const map = new Map<string, LearningSignal[]>();
    for (const log of logs) {
      const existing = map.get(log.sender) ?? [];
      existing.push(log);
      map.set(log.sender, existing);
    }
    return map;
  }

  private findDominantAction(logs: LearningSignal[]): string | null {
    const actionCounts = new Map<string, number>();
    for (const log of logs) {
      if (log.type === "user_confirmation") {
        const count = actionCounts.get(log.suggestedAction) ?? 0;
        actionCounts.set(log.suggestedAction, count + 1);
      }
    }

    let maxCount = 0;
    let dominantAction: string | null = null;
    for (const [action, count] of actionCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominantAction = action;
      }
    }

    return dominantAction;
  }
}

export function createLearningEngine(options?: LearningOptions): LearningEngine {
  return new LearningEngine(options);
}

export function createLearningSignal(
  type: LearningSignal["type"],
  message: EmailMessage,
  judgment: EmailJudgment,
  metadata?: Record<string, unknown>,
): LearningSignal {
  return {
    type,
    emailId: message.id,
    sender: message.sender,
    originalCategory: judgment.category,
    suggestedAction: judgment.actionSuggestion,
    timestamp: new Date().toISOString(),
    metadata,
  };
}