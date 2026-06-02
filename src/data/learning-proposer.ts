/**
 * 异步学习提议器：每次 Agent 启动时扫描近 N 天决策日志，生成候选偏好作为开场提问。
 *
 * Phase 2.3 实现：
 *   - 扫描近 N 天的决策日志
 *   - 识别可以自动化的模式（如连续 3 次确认同一发件人）
 *   - 生成候选偏好提议
 *   - 作为开场提问呈现给用户
 */

import type { AgentMemory } from "./memory.js";
import type { DecisionLogStore } from "./decision-logs.js";
import type { LearningEngine, PreferenceUpdate } from "./learning.js";
import { createLearningEngine } from "./learning.js";

export interface LearningProposal {
  id: string;
  type: "auto_confirm" | "sender_preference" | "action_preference";
  sender?: string;
  suggestedAction?: string;
  category?: string;
  confidence: number;
  reason: string;
  confirmCount: number;
  examples: string[];
}

export interface ProposalResult {
  proposals: LearningProposal[];
  skippedCount: number;
  notes: string[];
}

export interface LearningProposerOptions {
  daysToScan?: number;
  autoConfirmThreshold?: number;
  maxProposals?: number;
  minConfidence?: number;
}

const DEFAULT_OPTIONS: Required<LearningProposerOptions> = {
  daysToScan: 7,
  autoConfirmThreshold: 3,
  maxProposals: 5,
  minConfidence: 0.7,
};

export class LearningProposer {
  private readonly options: Required<LearningProposerOptions>;
  private readonly learningEngine: LearningEngine;

  constructor(
    private readonly decisionLogs: DecisionLogStore,
    options: LearningProposerOptions = {},
    learningEngine?: LearningEngine,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.learningEngine = learningEngine ?? createLearningEngine();
  }

  async propose(memory: AgentMemory): Promise<ProposalResult> {
    const logs = await this.decisionLogs.getRecentLogs(
      this.options.daysToScan,
      1000,
    );

    const proposals: LearningProposal[] = [];
    const skippedCount = 0;
    const notes: string[] = [];

    if (logs.length === 0) {
      notes.push("No recent decision logs found");
      return { proposals, skippedCount, notes };
    }

    const bySender = this.groupBySender(logs);
    notes.push(`Scanned ${logs.length} logs from ${bySender.size} senders`);

    for (const [sender, senderLogs] of bySender) {
      const proposal = await this.analyzeSenderPattern(sender, senderLogs, memory);
      if (proposal) {
        proposals.push(proposal);
      }
    }

    proposals.sort((a, b) => b.confidence - a.confidence);
    const limitedProposals = proposals.slice(0, this.options.maxProposals);

    notes.push(`Generated ${limitedProposals.length} proposals (${proposals.length} total)`);

    return { proposals: limitedProposals, skippedCount, notes };
  }

  async hasEnoughData(): Promise<boolean> {
    const logs = await this.decisionLogs.getRecentLogs(this.options.daysToScan);
    return logs.length >= this.options.autoConfirmThreshold;
  }

  async getOpeningPrompt(memory: AgentMemory): Promise<string> {
    const result = await this.propose(memory);

    if (result.proposals.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push("根据你的近期操作模式，我有以下学习建议：");

    result.proposals.forEach((proposal, index) => {
      const action = proposal.suggestedAction
        ? `自动${proposal.suggestedAction}`
        : "优化处理";
      lines.push(
        `${index + 1}. ${action} 来自「${proposal.sender}」的邮件（已确认 ${proposal.confirmCount} 次，置信度 ${Math.round(proposal.confidence * 100)}%）`,
      );
    });

    lines.push("");
    lines.push("是否接受以上建议？[Y/n]");

    return lines.join("\n");
  }

  async applyProposals(
    proposals: LearningProposal[],
    memory: AgentMemory,
  ): Promise<number> {
    let appliedCount = 0;

    for (const proposal of proposals) {
      const update: PreferenceUpdate = {
        kind: "sender",
        key: proposal.sender!,
        value: {
          category: proposal.category,
          preferredAction: proposal.suggestedAction,
          importanceDelta: 1,
          ignoredCount: proposal.confirmCount,
        },
        confidence: proposal.confidence,
        learnedFrom: `auto_proposal_${proposal.id}`,
        learnedAt: new Date().toISOString(),
        reason: proposal.reason,
      };

      if (this.learningEngine.applyUpdate(update, memory)) {
        appliedCount++;
      }
    }

    return appliedCount;
  }

  private groupBySender(
    logs: Awaited<ReturnType<DecisionLogStore["query"]>>,
  ): Map<string, typeof logs> {
    const map = new Map<string, typeof logs>();
    for (const log of logs) {
      const existing = map.get(log.sender) ?? [];
      existing.push(log);
      map.set(log.sender, existing);
    }
    return map;
  }

  private async analyzeSenderPattern(
    sender: string,
    logs: Awaited<ReturnType<DecisionLogStore["query"]>>,
    memory: AgentMemory,
  ): Promise<LearningProposal | null> {
    const confirmLogs = logs.filter((l) => l.type === "user_confirmation");
    const actionLogs = logs.filter((l) => l.type === "action_executed");

    const effectiveLogs = [...confirmLogs, ...actionLogs];

    if (effectiveLogs.length < this.options.autoConfirmThreshold) {
      return null;
    }

    const actionCounts = new Map<string, number>();
    for (const log of effectiveLogs) {
      const count = actionCounts.get(log.suggestedAction) ?? 0;
      actionCounts.set(log.suggestedAction, count + 1);
    }

    let maxCount = 0;
    let dominantAction: string | null = null;
    for (const [action, count] of actionCounts) {
      if (count > maxCount) {
        maxCount = count;
        dominantAction = action;
      }
    }

    if (!dominantAction || maxCount < this.options.autoConfirmThreshold) {
      return null;
    }

    const categories = new Set(
      effectiveLogs.map((l) => l.originalCategory).filter(Boolean),
    );
    const mainCategory = categories.size === 1 ? categories.values().next().value : undefined;

    const confidence = Math.min(maxCount / this.options.autoConfirmThreshold, 0.95);
    if (confidence < this.options.minConfidence) {
      return null;
    }

    const existingPref = memory.senderPreferences[sender.toLowerCase()];
    if (existingPref?.preferredAction === dominantAction) {
      return null;
    }

    const examples = effectiveLogs.slice(0, 3).map((l) => l.emailId);

    return {
      id: `proposal_${sender}_${Date.now()}`,
      type: "auto_confirm",
      sender,
      suggestedAction: dominantAction,
      category: mainCategory,
      confidence,
      reason: `User confirmed ${dominantAction} for ${sender} ${maxCount} times in the last ${this.options.daysToScan} days`,
      confirmCount: maxCount,
      examples,
    };
  }
}

export function createLearningProposer(
  decisionLogs: DecisionLogStore,
  options?: LearningProposerOptions,
): LearningProposer {
  return new LearningProposer(decisionLogs, options);
}