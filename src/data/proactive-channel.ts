/**
 * 主动告知通道：每次任务结束扫描场景，最多浮出 3 条按重要性排序的建议。
 *
 * Phase 2.4 + 2.5 实现：
 *   - 扫描四类场景（安全风险、自动化机会、学习提议、记忆提醒）
 *   - 按重要性排序（安全 > 自动化 > 学习）
 *   - 最多浮出 3 条建议
 *   - 支持 --quiet 模式只在高风险时提醒
 *   - "少即是多"约束：拒绝过的建议 30 天内不再重复浮出
 */

import type { AgentMemory } from "./memory.js";
import type { DecisionLogStore } from "./decision-logs.js";
import type { LearningProposer, LearningProposal } from "./learning-proposer.js";
import { createLearningProposer } from "./learning-proposer.js";
import type { RejectedProposalStore } from "./rejected-proposals.js";
import { createRejectedProposalStore } from "./rejected-proposals.js";

export interface ProactiveNotification {
  id: string;
  type: "security_warning" | "automation_suggestion" | "learning_proposal" | "memory_reminder";
  severity: "high" | "medium" | "low";
  title: string;
  message: string;
  sender?: string;
  suggestedAction?: string;
  importance: number;
  metadata?: Record<string, unknown>;
}

export interface NotificationResult {
  notifications: ProactiveNotification[];
  filteredCount: number;
  rejectedCount: number;
  notes: string[];
}

export interface ProactiveChannelOptions {
  maxNotifications?: number;
  quietMode?: boolean;
  securityThreshold?: number;
}

const DEFAULT_OPTIONS: Required<ProactiveChannelOptions> = {
  maxNotifications: 3,
  quietMode: false,
  securityThreshold: 0.7,
};

export class ProactiveChannel {
  private readonly options: Required<ProactiveChannelOptions>;
  private readonly learningProposer: LearningProposer;
  private readonly rejectedStore: RejectedProposalStore;

  constructor(
    private readonly decisionLogs: DecisionLogStore,
    options: ProactiveChannelOptions = {},
    learningProposer?: LearningProposer,
    rejectedStore?: RejectedProposalStore,
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.learningProposer = learningProposer ?? createLearningProposer(decisionLogs);
    this.rejectedStore = rejectedStore ?? createRejectedProposalStore();
  }

  async scanAndNotify(memory: AgentMemory): Promise<NotificationResult> {
    const allNotifications: ProactiveNotification[] = [];
    const notes: string[] = [];

    if (!this.options.quietMode) {
      const learningNotifications = await this.checkLearningProposals(memory);
      allNotifications.push(...learningNotifications);
      notes.push(`Found ${learningNotifications.length} learning proposals`);
    }

    const securityNotifications = await this.checkSecurityRisks(memory);
    allNotifications.push(...securityNotifications);
    notes.push(`Found ${securityNotifications.length} security warnings`);

    const automationNotifications = await this.checkAutomationOpportunities(memory);
    allNotifications.push(...automationNotifications);
    notes.push(`Found ${automationNotifications.length} automation suggestions`);

    const memoryNotifications = await this.checkMemoryReminders(memory);
    allNotifications.push(...memoryNotifications);
    notes.push(`Found ${memoryNotifications.length} memory reminders`);

    allNotifications.sort((a, b) => b.importance - a.importance);

    const filteredByRejection = await this.filterRejected(allNotifications);
    const rejectedCount = allNotifications.length - filteredByRejection.length;
    notes.push(`Filtered ${rejectedCount} previously rejected notifications`);

    const filteredNotifications = this.options.quietMode
      ? filteredByRejection.filter((n) => n.severity === "high")
      : filteredByRejection.slice(0, this.options.maxNotifications);

    const filteredCount = filteredByRejection.length - filteredNotifications.length;

    await this.rejectedStore.cleanup();

    return {
      notifications: filteredNotifications,
      filteredCount,
      rejectedCount,
      notes,
    };
  }

  async getNotificationSummary(memory: AgentMemory): Promise<string> {
    const result = await this.scanAndNotify(memory);

    if (result.notifications.length === 0) {
      return "";
    }

    const lines: string[] = [];

    if (result.notifications.some((n) => n.type === "security_warning")) {
      lines.push("⚠️ 安全提醒：");
      const securityWarnings = result.notifications.filter((n) => n.type === "security_warning");
      for (const warning of securityWarnings) {
        lines.push(`  - ${warning.message}`);
      }
    }

    const otherNotifications = result.notifications.filter((n) => n.type !== "security_warning");
    if (otherNotifications.length > 0) {
      lines.push("💡 建议：");
      for (const notification of otherNotifications) {
        lines.push(`  - ${notification.message}`);
      }
    }

    if (result.filteredCount > 0) {
      lines.push(`\n还有 ${result.filteredCount} 条建议被过滤`);
    }

    if (result.rejectedCount > 0) {
      lines.push(`\n${result.rejectedCount} 条建议因之前被拒绝而跳过（30天内不再显示）`);
    }

    return lines.join("\n");
  }

  async rejectNotification(notification: ProactiveNotification): Promise<string> {
    return this.rejectedStore.add({
      notificationId: notification.id,
      sender: notification.sender,
      suggestedAction: notification.suggestedAction,
      rejectedAt: new Date().toISOString(),
    });
  }

  private async filterRejected(notifications: ProactiveNotification[]): Promise<ProactiveNotification[]> {
    const filtered: ProactiveNotification[] = [];

    for (const notification of notifications) {
      const isRejected = await this.rejectedStore.isRejected(notification.id);
      if (!isRejected && notification.sender) {
        const isSenderRejected = await this.rejectedStore.isRejectedBySender(notification.sender);
        if (!isSenderRejected) {
          filtered.push(notification);
        }
      } else if (!isRejected) {
        filtered.push(notification);
      }
    }

    return filtered;
  }

  private async checkLearningProposals(memory: AgentMemory): Promise<ProactiveNotification[]> {
    const result = await this.learningProposer.propose(memory);

    return result.proposals.map((proposal) => this.proposalToNotification(proposal));
  }

  private async checkSecurityRisks(_memory: AgentMemory): Promise<ProactiveNotification[]> {
    const notifications: ProactiveNotification[] = [];

    const recentLogs = await this.decisionLogs.getRecentLogs(3);
    const suspiciousSenders = new Set<string>();

    for (const log of recentLogs) {
      if (this.isSuspiciousSender(log.sender)) {
        suspiciousSenders.add(log.sender);
      }
    }

    for (const sender of suspiciousSenders) {
      const isRejected = await this.rejectedStore.isRejectedBySender(sender);
      if (!isRejected) {
        notifications.push({
          id: `security_${sender}_${Date.now()}`,
          type: "security_warning",
          severity: "high",
          title: "可疑发件人",
          message: `检测到来自「${sender}」的可疑活动，请谨慎处理其邮件`,
          sender,
          importance: 100,
        });
      }
    }

    return notifications;
  }

  private async checkAutomationOpportunities(memory: AgentMemory): Promise<ProactiveNotification[]> {
    const notifications: ProactiveNotification[] = [];

    const recentLogs = await this.decisionLogs.getRecentLogs(7);
    const senderActions = new Map<string, Map<string, number>>();

    for (const log of recentLogs) {
      const actions = senderActions.get(log.sender) ?? new Map<string, number>();
      const count = actions.get(log.suggestedAction) ?? 0;
      actions.set(log.suggestedAction, count + 1);
      senderActions.set(log.sender, actions);
    }

    for (const [sender, actions] of senderActions) {
      for (const [action, count] of actions) {
        if (count >= 3) {
          const existingPref = memory.senderPreferences[sender.toLowerCase()];
          if (!existingPref || existingPref.preferredAction !== action) {
            const isRejected = await this.rejectedStore.isRejectedBySender(sender);
            if (!isRejected) {
              notifications.push({
                id: `automation_${sender}_${action}_${Date.now()}`,
                type: "automation_suggestion",
                severity: "medium",
                title: "自动化建议",
                message: `「${sender}」的邮件已执行「${action}」操作 ${count} 次，是否设置为自动处理？`,
                sender,
                suggestedAction: action,
                importance: 50 + count,
              });
            }
          }
        }
      }
    }

    return notifications;
  }

  private async checkMemoryReminders(_memory: AgentMemory): Promise<ProactiveNotification[]> {
    return [];
  }

  private proposalToNotification(proposal: LearningProposal): ProactiveNotification {
    return {
      id: `learning_${proposal.id}`,
      type: "learning_proposal",
      severity: proposal.confidence >= 0.9 ? "medium" : "low",
      title: "学习建议",
      message: `建议对来自「${proposal.sender}」的邮件自动${proposal.suggestedAction}（已确认 ${proposal.confirmCount} 次）`,
      sender: proposal.sender,
      suggestedAction: proposal.suggestedAction,
      importance: 30 + Math.round(proposal.confidence * 20),
    };
  }

  private isSuspiciousSender(sender: string): boolean {
    const suspiciousPatterns = [
      /@.*\.test$/i,
      /@.*-secure.*\.com$/i,
      /@.*-login.*\.com$/i,
      /@.*-verify.*\.com$/i,
      /@.*auth.*\.com$/i,
      /@.*account.*\.com$/i,
      /@.*support-.*\.com$/i,
      /@.*service-.*\.com$/i,
      /^no-reply.*@/i,
      /^noreply.*@/i,
    ];

    return suspiciousPatterns.some((pattern) => pattern.test(sender));
  }
}

export function createProactiveChannel(
  decisionLogs: DecisionLogStore,
  options?: ProactiveChannelOptions,
): ProactiveChannel {
  return new ProactiveChannel(decisionLogs, options);
}