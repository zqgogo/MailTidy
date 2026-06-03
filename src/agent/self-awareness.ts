/**
 * Agent 自我意识：监控和评估 Agent 性能
 *
 * Phase 3.6 实现：
 *   - 统计准确率：追踪决策准确性
 *   - 偏好年龄：追踪偏好的时效性
 *   - 工具消耗：追踪工具使用情况和成本
 */

import type { AgentMemory, SenderPreference } from "../data/memory.js";
import type { LearningSignal } from "../data/learning.js";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface PerformanceStats {
  totalDecisions: number;
  confirmedDecisions: number;
  rejectedDecisions: number;
  correctedDecisions: number;
  accuracy: number;
  confirmationRate: number;
  averageConfidence: number;
  topConfidentDecisions: Array<{
    emailId: string;
    sender: string;
    action: string;
    confidence: number;
    timestamp: string;
  }>;
  lowConfidenceDecisions: Array<{
    emailId: string;
    sender: string;
    action: string;
    confidence: number;
    timestamp: string;
  }>;
}

export interface PreferenceAgeStats {
  totalPreferences: number;
  averageAgeDays: number;
  stalePreferences: number;
  freshPreferences: number;
  oldestPreferences: Array<{
    sender: string;
    ageDays: number;
    lastUsed: string;
    preferredAction: string;
  }>;
  newestPreferences: Array<{
    sender: string;
    ageDays: number;
    lastUsed: string;
    preferredAction: string;
  }>;
}

export interface ToolUsageStats {
  totalCalls: number;
  byTool: Record<string, {
    count: number;
    totalTime: number;
    averageTime: number;
    errors: number;
  }>;
  mostUsedTools: Array<{
    name: string;
    count: number;
    averageTime: number;
  }>;
  errorRate: number;
  totalExecutionTime: number;
}

export interface SelfAssessment {
  performance: PerformanceStats;
  preferences: PreferenceAgeStats;
  tools: ToolUsageStats;
  overallHealth: "excellent" | "good" | "fair" | "poor";
  recommendations: string[];
}

export interface SelfAwarenessOptions {
  maxHistorySize?: number;
  stalePreferenceThresholdDays?: number;
  lowConfidenceThreshold?: number;
  stateDir?: string;
}

const DEFAULT_OPTIONS: Required<SelfAwarenessOptions> = {
  maxHistorySize: 1000,
  stalePreferenceThresholdDays: 90,
  lowConfidenceThreshold: 0.5,
  stateDir: ".mailtidy",
};

export class AgentSelfAwareness {
  private readonly options: Required<SelfAwarenessOptions>;
  private decisionHistory: Array<{
    emailId: string;
    sender: string;
    action: string;
    confidence: number;
    timestamp: string;
    outcome?: "confirmed" | "rejected" | "corrected";
  }> = [];

  private toolUsageHistory: Array<{
    toolName: string;
    durationMs: number;
    success: boolean;
    timestamp: string;
  }> = [];

  private readonly statePath: string;

  constructor(options: SelfAwarenessOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.statePath = path.join(this.options.stateDir, "self-awareness.json");
    this.loadState().catch(() => {});
  }

  async loadState(): Promise<void> {
    try {
      const raw = await fs.readFile(this.statePath, "utf-8");
      const state = JSON.parse(raw) as {
        decisionHistory: typeof this.decisionHistory;
        toolUsageHistory: typeof this.toolUsageHistory;
      };
      this.decisionHistory = state.decisionHistory || [];
      this.toolUsageHistory = state.toolUsageHistory || [];
    } catch {
      // Ignore file not found or parse errors
    }
  }

  async saveState(): Promise<void> {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    await fs.writeFile(
      this.statePath,
      JSON.stringify({
        decisionHistory: this.decisionHistory,
        toolUsageHistory: this.toolUsageHistory,
      }),
      "utf-8",
    );
  }

  recordDecision(
    emailId: string,
    sender: string,
    action: string,
    confidence: number,
  ): void {
    this.decisionHistory.push({
      emailId,
      sender,
      action,
      confidence,
      timestamp: new Date().toISOString(),
    });

    // Keep history within limits
    if (this.decisionHistory.length > this.options.maxHistorySize) {
      this.decisionHistory = this.decisionHistory.slice(-this.options.maxHistorySize);
    }
  }

  recordDecisionOutcome(emailId: string, outcome: "confirmed" | "rejected" | "corrected"): void {
    const decision = this.decisionHistory.find((d) => d.emailId === emailId);
    if (decision) {
      decision.outcome = outcome;
    }
  }

  recordToolUsage(toolName: string, durationMs: number, success: boolean): void {
    this.toolUsageHistory.push({
      toolName,
      durationMs,
      success,
      timestamp: new Date().toISOString(),
    });

    // Keep history within limits
    if (this.toolUsageHistory.length > this.options.maxHistorySize) {
      this.toolUsageHistory = this.toolUsageHistory.slice(-this.options.maxHistorySize);
    }
  }

  calculatePerformanceStats(): PerformanceStats {
    const total = this.decisionHistory.length;
    const confirmed = this.decisionHistory.filter((d) => d.outcome === "confirmed").length;
    const rejected = this.decisionHistory.filter((d) => d.outcome === "rejected").length;
    const corrected = this.decisionHistory.filter((d) => d.outcome === "corrected").length;

    const accuracy = total > 0 ? (confirmed + corrected * 0.5) / total : 0;
    const confirmationRate = total > 0 ? confirmed / total : 0;
    const avgConfidence = total > 0
      ? this.decisionHistory.reduce((sum, d) => sum + d.confidence, 0) / total
      : 0;

    const sortedByConfidence = [...this.decisionHistory].sort((a, b) => b.confidence - a.confidence);
    const sortedByLowConfidence = [...this.decisionHistory].sort((a, b) => a.confidence - b.confidence);

    return {
      totalDecisions: total,
      confirmedDecisions: confirmed,
      rejectedDecisions: rejected,
      correctedDecisions: corrected,
      accuracy: Math.round(accuracy * 100) / 100,
      confirmationRate: Math.round(confirmationRate * 100) / 100,
      averageConfidence: Math.round(avgConfidence * 100) / 100,
      topConfidentDecisions: sortedByConfidence.slice(0, 5),
      lowConfidenceDecisions: sortedByLowConfidence
        .filter((d) => d.confidence < this.options.lowConfidenceThreshold)
        .slice(0, 5),
    };
  }

  calculatePreferenceAgeStats(memory: AgentMemory): PreferenceAgeStats {
    const now = new Date();
    const preferences = Object.entries(memory.senderPreferences) as Array<[string, SenderPreference]>;
    const total = preferences.length;

    const ageStats = preferences.map(([sender, pref]) => {
      const created = pref.createdAt ? new Date(pref.createdAt) : now;
      const ageDays = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      return {
        sender,
        ageDays,
        lastUsed: pref.lastUsed ?? "Never",
        preferredAction: pref.preferredAction ?? "unknown",
      };
    });

    const staleThreshold = this.options.stalePreferenceThresholdDays;
    const stale = ageStats.filter((s) => s.ageDays >= staleThreshold).length;
    const fresh = ageStats.filter((s) => s.ageDays < staleThreshold).length;
    const avgAge = total > 0 ? Math.round(ageStats.reduce((sum, s) => sum + s.ageDays, 0) / total) : 0;

    const sortedByAge = [...ageStats].sort((a, b) => b.ageDays - a.ageDays);
    const sortedByNewest = [...ageStats].sort((a, b) => a.ageDays - b.ageDays);

    return {
      totalPreferences: total,
      averageAgeDays: avgAge,
      stalePreferences: stale,
      freshPreferences: fresh,
      oldestPreferences: sortedByAge.slice(0, 5),
      newestPreferences: sortedByNewest.slice(0, 5),
    };
  }

  calculateToolUsageStats(): ToolUsageStats {
    const total = this.toolUsageHistory.length;
    const byTool: ToolUsageStats["byTool"] = {};

    for (const usage of this.toolUsageHistory) {
      if (!byTool[usage.toolName]) {
        byTool[usage.toolName] = {
          count: 0,
          totalTime: 0,
          averageTime: 0,
          errors: 0,
        };
      }

      byTool[usage.toolName].count++;
      byTool[usage.toolName].totalTime += usage.durationMs;
      byTool[usage.toolName].averageTime =
        byTool[usage.toolName].totalTime / byTool[usage.toolName].count;

      if (!usage.success) {
        byTool[usage.toolName].errors++;
      }
    }

    const totalErrors = this.toolUsageHistory.filter((u) => !u.success).length;
    const totalTime = this.toolUsageHistory.reduce((sum, u) => sum + u.durationMs, 0);

    const mostUsed = Object.entries(byTool)
      .map(([name, stats]) => ({
        name,
        count: stats.count,
        averageTime: Math.round(stats.averageTime),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalCalls: total,
      byTool,
      mostUsedTools: mostUsed,
      errorRate: total > 0 ? Math.round((totalErrors / total) * 100) / 100 : 0,
      totalExecutionTime: totalTime,
    };
  }

  assess(memory: AgentMemory): SelfAssessment {
    const performance = this.calculatePerformanceStats();
    const preferences = this.calculatePreferenceAgeStats(memory);
    const tools = this.calculateToolUsageStats();

    const recommendations: string[] = [];

    // Performance recommendations
    if (performance.accuracy < 0.7) {
      recommendations.push("决策准确率低于70%，建议增加用户确认次数");
    }
    if (performance.lowConfidenceDecisions.length > 3) {
      recommendations.push("存在多个低置信度决策，建议优化分类模型");
    }

    // Preference recommendations
    if (preferences.stalePreferences > preferences.freshPreferences) {
      recommendations.push("过期偏好数量较多，建议定期清理或更新");
    }
    if (preferences.totalPreferences === 0) {
      recommendations.push("尚未建立任何发件人偏好，建议使用一段时间以学习用户习惯");
    }

    // Tool recommendations
    if (tools.errorRate > 0.1) {
      recommendations.push("工具调用错误率较高，建议检查工具配置");
    }
    if (tools.totalExecutionTime > 60000) {
      recommendations.push("工具执行总时间超过60秒，建议优化工具调用策略");
    }

    // Overall health assessment
    let overallHealth: SelfAssessment["overallHealth"] = "good";
    if (performance.accuracy >= 0.85 && tools.errorRate < 0.05 && preferences.stalePreferences < 3) {
      overallHealth = "excellent";
    } else if (performance.accuracy < 0.6 || tools.errorRate > 0.2 || preferences.stalePreferences > preferences.totalPreferences * 0.5) {
      overallHealth = "poor";
    } else if (performance.accuracy < 0.7 || tools.errorRate > 0.1) {
      overallHealth = "fair";
    }

    return {
      performance,
      preferences,
      tools,
      overallHealth,
      recommendations,
    };
  }

  generateReport(memory: AgentMemory): string {
    const assessment = this.assess(memory);
    const now = new Date().toLocaleString("zh-CN");

    let report = `=== Agent 自我评估报告 ===\n`;
    report += `生成时间: ${now}\n\n`;

    report += `【整体健康状态】\n`;
    report += `评级: ${assessment.overallHealth === "excellent" ? "优秀" : assessment.overallHealth === "good" ? "良好" : assessment.overallHealth === "fair" ? "一般" : "较差"}\n\n`;

    report += `【性能统计】\n`;
    report += `总决策数: ${assessment.performance.totalDecisions}\n`;
    report += `确认决策: ${assessment.performance.confirmedDecisions}\n`;
    report += `拒绝决策: ${assessment.performance.rejectedDecisions}\n`;
    report += `修正决策: ${assessment.performance.correctedDecisions}\n`;
    report += `准确率: ${(assessment.performance.accuracy * 100).toFixed(1)}%\n`;
    report += `确认率: ${(assessment.performance.confirmationRate * 100).toFixed(1)}%\n`;
    report += `平均置信度: ${(assessment.performance.averageConfidence * 100).toFixed(1)}%\n\n`;

    report += `【偏好状态】\n`;
    report += `总偏好数: ${assessment.preferences.totalPreferences}\n`;
    report += `平均年龄: ${assessment.preferences.averageAgeDays} 天\n`;
    report += `过期偏好: ${assessment.preferences.stalePreferences}\n`;
    report += `新鲜偏好: ${assessment.preferences.freshPreferences}\n\n`;

    report += `【工具使用】\n`;
    report += `总调用次数: ${assessment.tools.totalCalls}\n`;
    report += `总执行时间: ${(assessment.tools.totalExecutionTime / 1000).toFixed(2)} 秒\n`;
    report += `错误率: ${(assessment.tools.errorRate * 100).toFixed(1)}%\n\n`;

    if (assessment.recommendations.length > 0) {
      report += `【建议】\n`;
      assessment.recommendations.forEach((rec, i) => {
        report += `${i + 1}. ${rec}\n`;
      });
    }

    return report;
  }

  async updateFromLearningSignals(signals: LearningSignal[]): Promise<void> {
    for (const signal of signals) {
      if (signal.type === "user_confirmation") {
        this.recordDecisionOutcome(signal.emailId, "confirmed");
      } else if (signal.type === "user_rejection") {
        this.recordDecisionOutcome(signal.emailId, "rejected");
      } else if (signal.type === "user_correction") {
        this.recordDecisionOutcome(signal.emailId, "corrected");
      }
    }

    await this.saveState();
  }

  reset(): void {
    this.decisionHistory = [];
    this.toolUsageHistory = [];
    this.saveState().catch(() => {});
  }

  getSummary(): {
    totalDecisions: number;
    accuracy: number;
    totalPreferences: number;
    averagePreferenceAgeDays: number;
    totalToolCalls: number;
    toolErrorRate: number;
    healthStatus: string;
  } {
    const now = new Date();
    const recentDecisions = this.decisionHistory.filter(
      (d) => new Date(d.timestamp) > new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    );

    const confirmed = recentDecisions.filter((d) => d.outcome === "confirmed").length;
    const rejected = recentDecisions.filter((d) => d.outcome === "rejected").length;
    const corrected = recentDecisions.filter((d) => d.outcome === "corrected").length;
    const accuracy = recentDecisions.length > 0 ? (confirmed + corrected * 0.5) / recentDecisions.length : 0;

    return {
      totalDecisions: this.decisionHistory.length,
      accuracy: Math.round(accuracy * 100) / 100,
      totalPreferences: this.calculatePreferenceAgeStats({ senderPreferences: {}, actionPreferences: {}, stylePreferences: {} }).totalPreferences,
      averagePreferenceAgeDays: this.calculatePreferenceAgeStats({ senderPreferences: {}, actionPreferences: {}, stylePreferences: {} }).averageAgeDays,
      totalToolCalls: this.toolUsageHistory.length,
      toolErrorRate: this.calculateToolUsageStats().errorRate,
      healthStatus: this.assess({ senderPreferences: {}, actionPreferences: {}, stylePreferences: {} }).overallHealth,
    };
  }
}

export function createSelfAwareness(options?: SelfAwarenessOptions): AgentSelfAwareness {
  return new AgentSelfAwareness(options);
}