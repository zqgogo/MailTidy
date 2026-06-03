/**
 * 运行时监控和告警机制（Phase 5.2）
 * 
 * 实现：
 *   - 指标收集：决策准确率、工具调用次数、执行时间
 *   - 告警规则：准确率低于阈值、工具错误率过高、执行超时
 *   - 告警通知：控制台、日志、Webhook
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { SelfAssessment } from "../agent/self-awareness.js";

export interface AlertRule {
  id: string;
  name: string;
  type: "performance" | "tool" | "preference" | "system";
  condition: (metrics: Metrics) => boolean;
  severity: "info" | "warning" | "critical";
  threshold: number;
  message: string;
}

export interface Alert {
  id: string;
  ruleId: string;
  name: string;
  severity: "info" | "warning" | "critical";
  message: string;
  timestamp: string;
  metrics: Partial<Metrics>;
}

export interface Metrics {
  // Performance metrics
  totalDecisions: number;
  accuracy: number;
  confirmationRate: number;
  averageConfidence: number;
  
  // Tool metrics
  totalToolCalls: number;
  toolErrorRate: number;
  averageToolTime: number;
  
  // Preference metrics
  totalPreferences: number;
  averagePreferenceAgeDays: number;
  stalePreferenceRatio: number;
  
  // System metrics
  totalExecutionTime: number;
  errorCount: number;
  successCount: number;
}

export interface AlertNotification {
  type: "console" | "log" | "webhook";
  config?: Record<string, unknown>;
}

export interface MonitorOptions {
  stateDir?: string;
  rules?: AlertRule[];
  notifications?: AlertNotification[];
  checkIntervalMs?: number;
}

const DEFAULT_RULES: AlertRule[] = [
  {
    id: "perf-low-accuracy",
    name: "Low Accuracy",
    type: "performance",
    condition: (m) => m.accuracy < 0.7,
    severity: "critical",
    threshold: 0.7,
    message: "决策准确率低于70%，需要关注",
  },
  {
    id: "perf-low-confidence",
    name: "Low Confidence",
    type: "performance",
    condition: (m) => m.averageConfidence < 0.5,
    severity: "warning",
    threshold: 0.5,
    message: "平均置信度低于50%",
  },
  {
    id: "tool-high-error-rate",
    name: "High Tool Error Rate",
    type: "tool",
    condition: (m) => m.toolErrorRate > 0.1,
    severity: "warning",
    threshold: 0.1,
    message: "工具调用错误率超过10%",
  },
  {
    id: "tool-slow-response",
    name: "Slow Tool Response",
    type: "tool",
    condition: (m) => m.averageToolTime > 5000,
    severity: "warning",
    threshold: 5000,
    message: "工具平均响应时间超过5秒",
  },
  {
    id: "pref-stale-preferences",
    name: "Stale Preferences",
    type: "preference",
    condition: (m) => m.stalePreferenceRatio > 0.5,
    severity: "info",
    threshold: 0.5,
    message: "超过50%的偏好已过期",
  },
  {
    id: "sys-high-error-count",
    name: "High Error Count",
    type: "system",
    condition: (m) => m.errorCount > 10,
    severity: "critical",
    threshold: 10,
    message: "错误计数超过10次",
  },
];

export class RuntimeMonitor {
  private readonly stateDir: string;
  private readonly rules: AlertRule[];
  private readonly notifications: AlertNotification[];
  private readonly checkIntervalMs: number;
  private alertHistory: Alert[] = [];
  private metrics: Metrics = this.createEmptyMetrics();
  private intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(options: MonitorOptions = {}) {
    this.stateDir = options.stateDir ?? ".mailtidy";
    this.rules = options.rules ?? DEFAULT_RULES;
    this.notifications = options.notifications ?? [{ type: "console" }, { type: "log" }];
    this.checkIntervalMs = options.checkIntervalMs ?? 60000;
  }

  private createEmptyMetrics(): Metrics {
    return {
      totalDecisions: 0,
      accuracy: 0,
      confirmationRate: 0,
      averageConfidence: 0,
      totalToolCalls: 0,
      toolErrorRate: 0,
      averageToolTime: 0,
      totalPreferences: 0,
      averagePreferenceAgeDays: 0,
      stalePreferenceRatio: 0,
      totalExecutionTime: 0,
      errorCount: 0,
      successCount: 0,
    };
  }

  updateMetrics(newMetrics: Partial<Metrics>): void {
    this.metrics = { ...this.metrics, ...newMetrics };
  }

  recordDecision(outcome: "success" | "error", executionTimeMs?: number): void {
    if (outcome === "success") {
      this.metrics.successCount++;
    } else {
      this.metrics.errorCount++;
    }
    if (executionTimeMs) {
      this.metrics.totalExecutionTime += executionTimeMs;
    }
  }

  recordToolCall(success: boolean, durationMs: number): void {
    this.metrics.totalToolCalls++;
    if (!success) {
      this.metrics.toolErrorRate = 
        (this.metrics.toolErrorRate * (this.metrics.totalToolCalls - 1) + 1) / this.metrics.totalToolCalls;
    } else {
      this.metrics.toolErrorRate = 
        this.metrics.toolErrorRate * (this.metrics.totalToolCalls - 1) / this.metrics.totalToolCalls;
    }
    this.metrics.averageToolTime = 
      (this.metrics.averageToolTime * (this.metrics.totalToolCalls - 1) + durationMs) / this.metrics.totalToolCalls;
  }

  evaluateRules(): Alert[] {
    const triggeredAlerts: Alert[] = [];
    
    for (const rule of this.rules) {
      if (rule.condition(this.metrics)) {
        const alert: Alert = {
          id: `${rule.id}-${Date.now()}`,
          ruleId: rule.id,
          name: rule.name,
          severity: rule.severity,
          message: rule.message,
          timestamp: new Date().toISOString(),
          metrics: { ...this.metrics },
        };
        
        triggeredAlerts.push(alert);
        this.alertHistory.push(alert);
        
        // Keep only last 100 alerts
        if (this.alertHistory.length > 100) {
          this.alertHistory = this.alertHistory.slice(-100);
        }
      }
    }
    
    return triggeredAlerts;
  }

  async checkAndNotify(): Promise<void> {
    const alerts = this.evaluateRules();
    
    for (const alert of alerts) {
      await this.notify(alert);
    }
  }

  private async notify(alert: Alert): Promise<void> {
    for (const notification of this.notifications) {
      switch (notification.type) {
        case "console":
          this.notifyConsole(alert);
          break;
        case "log":
          await this.notifyLog(alert);
          break;
        case "webhook":
          await this.notifyWebhook(alert, notification.config);
          break;
      }
    }
  }

  private notifyConsole(alert: Alert): void {
    const color = alert.severity === "critical" ? "\x1b[31m" : 
                  alert.severity === "warning" ? "\x1b[33m" : "\x1b[32m";
    const reset = "\x1b[0m";
    
    console.log(
      `${color}[${alert.severity.toUpperCase()}] ${alert.timestamp}: ${alert.name}\n` +
      `  ${alert.message}\n${reset}`
    );
  }

  private async notifyLog(alert: Alert): Promise<void> {
    const logPath = path.join(this.stateDir, "logs", "alerts.log");
    const logEntry = JSON.stringify({
      ...alert,
      timestamp: new Date().toISOString(),
    }) + "\n";
    
    await fs.mkdir(path.dirname(logPath), { recursive: true });
    await fs.appendFile(logPath, logEntry, "utf-8");
  }

  private async notifyWebhook(alert: Alert, config?: Record<string, unknown>): Promise<void> {
    const url = config?.url as string;
    if (!url) return;
    
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(alert),
      });
    } catch {
      // Ignore webhook errors
    }
  }

  startMonitoring(): void {
    if (this.intervalId) {
      this.stopMonitoring();
    }
    
    this.intervalId = setInterval(() => {
      this.checkAndNotify().catch(() => {});
    }, this.checkIntervalMs);
    
    console.log(`🔍 Runtime monitor started (check interval: ${this.checkIntervalMs}ms)`);
  }

  stopMonitoring(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log("🛑 Runtime monitor stopped");
    }
  }

  getMetrics(): Metrics {
    return { ...this.metrics };
  }

  getAlerts(count: number = 10): Alert[] {
    return this.alertHistory.slice(-count);
  }

  async exportMetrics(): Promise<string> {
    return JSON.stringify({
      metrics: this.metrics,
      alerts: this.alertHistory,
      timestamp: new Date().toISOString(),
    }, null, 2);
  }

  async saveMetrics(): Promise<void> {
    const metricsPath = path.join(this.stateDir, "metrics.json");
    await fs.writeFile(metricsPath, await this.exportMetrics(), "utf-8");
  }

  async loadMetrics(): Promise<void> {
    const metricsPath = path.join(this.stateDir, "metrics.json");
    try {
      const raw = await fs.readFile(metricsPath, "utf-8");
      const data = JSON.parse(raw);
      this.metrics = data.metrics ?? this.createEmptyMetrics();
      this.alertHistory = data.alerts ?? [];
    } catch {
      // Ignore file not found
    }
  }
}

export function createRuntimeMonitor(options?: MonitorOptions): RuntimeMonitor {
  return new RuntimeMonitor(options);
}

export { DEFAULT_RULES };