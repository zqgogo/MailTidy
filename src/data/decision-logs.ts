/**
 * 决策日志：记录用户反馈和学习信号，供学习层分析。
 *
 * Phase 2.2 同步学习信号：
 *   - askUser 回调挂学习钩子，记录用户确认/拒绝
 *   - applyAction 后写决策日志，记录动作执行/跳过
 *   - 每条日志包含 LearningSignal，供 LearningEngine 处理
 *
 * 文件结构：JSONL 格式，每行一条日志。
 * 路径：`.mailtidy/decision-logs.jsonl`
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { LearningSignal } from "./learning.js";

export interface DecisionLogEntry extends LearningSignal {
  logId: string;
  taskId: string;
}

export interface DecisionLogQuery {
  taskId?: string;
  sender?: string;
  signalType?: LearningSignal["type"];
  since?: string;
  until?: string;
  limit?: number;
}

export class DecisionLogStore {
  constructor(private readonly filePath: string) {}

  async append(entry: Omit<DecisionLogEntry, "logId">): Promise<string> {
    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const fullEntry: DecisionLogEntry = { ...entry, logId };
    
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify(fullEntry) + "\n";
    await fs.appendFile(this.filePath, line, "utf-8");
    
    return logId;
  }

  async query(query: DecisionLogQuery = {}): Promise<DecisionLogEntry[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const entries: DecisionLogEntry[] = lines.map((line) => JSON.parse(line));

      let filtered = entries;

      if (query.taskId) {
        filtered = filtered.filter((e) => e.taskId === query.taskId);
      }

      if (query.sender) {
        filtered = filtered.filter((e) => e.sender.toLowerCase() === query.sender!.toLowerCase());
      }

      if (query.signalType) {
        filtered = filtered.filter((e) => e.type === query.signalType);
      }

      if (query.since) {
        const since = new Date(query.since).getTime();
        filtered = filtered.filter((e) => new Date(e.timestamp).getTime() >= since);
      }

      if (query.until) {
        const until = new Date(query.until).getTime();
        filtered = filtered.filter((e) => new Date(e.timestamp).getTime() <= until);
      }

      filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      if (query.limit) {
        filtered = filtered.slice(0, query.limit);
      }

      return filtered;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async getRecentLogs(days: number = 7, limit: number = 1000): Promise<DecisionLogEntry[]> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    return this.query({ since: since.toISOString(), limit });
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

export function createDecisionLogStore(stateDir: string = ".mailtidy"): DecisionLogStore {
  const filePath = path.join(stateDir, "decision-logs.jsonl");
  return new DecisionLogStore(filePath);
}