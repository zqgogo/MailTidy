/**
 * Pending 队列：管理需要延迟执行或重试的操作。
 *
 * Phase 2.8 实现：
 *   - 支持任务排队、延迟执行、重试机制
 *   - 持久化存储，重启后自动恢复
 *   - 支持任务状态追踪（pending, running, completed, failed）
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export type PendingTaskStatus = "pending" | "running" | "completed" | "failed";

export interface PendingTask {
  id: string;
  type: "email_action" | "learning_update" | "notification" | "sync";
  payload: Record<string, unknown>;
  status: PendingTaskStatus;
  createdAt: string;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  errorMessage?: string;
  retryCount: number;
  maxRetries: number;
  delayMs: number;
}

export interface PendingQueue {
  add(task: Omit<PendingTask, "id" | "status" | "createdAt" | "retryCount">): Promise<string>;
  getPending(): Promise<PendingTask[]>;
  getById(id: string): Promise<PendingTask | null>;
  markRunning(id: string): Promise<boolean>;
  markCompleted(id: string): Promise<boolean>;
  markFailed(id: string, errorMessage: string): Promise<boolean>;
  retryTask(id: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  cleanup(): Promise<number>;
  getAll(): Promise<PendingTask[]>;
}

export class FilePendingQueue implements PendingQueue {
  constructor(private readonly filePath: string) {}

  async add(task: Omit<PendingTask, "id" | "status" | "createdAt" | "retryCount">): Promise<string> {
    const now = new Date();
    const scheduledAt = task.scheduledAt
      ? task.scheduledAt
      : new Date(now.getTime() + (task.delayMs ?? 0)).toISOString();

    const pendingTask: PendingTask = {
      ...task,
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      status: "pending",
      createdAt: now.toISOString(),
      scheduledAt,
      retryCount: 0,
    };

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify(pendingTask) + "\n";
    await fs.appendFile(this.filePath, line, "utf-8");

    return pendingTask.id;
  }

  async getPending(): Promise<PendingTask[]> {
    const tasks = await this.getAll();
    const now = new Date().toISOString();
    return tasks.filter((t) => t.status === "pending" && t.scheduledAt !== undefined && t.scheduledAt <= now);
  }

  async getById(id: string): Promise<PendingTask | null> {
    const tasks = await this.getAll();
    return tasks.find((t) => t.id === id) ?? null;
  }

  async markRunning(id: string): Promise<boolean> {
    return this.updateTask(id, (task) => ({
      ...task,
      status: "running" as PendingTaskStatus,
      startedAt: new Date().toISOString(),
    }));
  }

  async markCompleted(id: string): Promise<boolean> {
    return this.updateTask(id, (task) => ({
      ...task,
      status: "completed" as PendingTaskStatus,
      completedAt: new Date().toISOString(),
    }));
  }

  async markFailed(id: string, errorMessage: string): Promise<boolean> {
    return this.updateTask(id, (task) => ({
      ...task,
      status: "failed" as PendingTaskStatus,
      completedAt: new Date().toISOString(),
      errorMessage,
      retryCount: task.retryCount + 1,
    }));
  }

  async retryTask(id: string): Promise<boolean> {
    const task = await this.getById(id);
    if (!task) return false;

    if (task.retryCount > task.maxRetries) {
      return false;
    }

    const newDelay = task.delayMs * 2;
    const newScheduledAt = new Date(Date.now() + newDelay).toISOString();

    return this.updateTask(id, (t) => ({
      ...t,
      status: "pending" as PendingTaskStatus,
      scheduledAt: newScheduledAt,
      delayMs: newDelay,
    }));
  }

  async delete(id: string): Promise<boolean> {
    const tasks = await this.getAll();
    const filtered = tasks.filter((t) => t.id !== id);

    if (filtered.length === tasks.length) {
      return false;
    }

    await fs.writeFile(this.filePath, filtered.map((t) => JSON.stringify(t)).join("\n") + "\n", "utf-8");
    return true;
  }

  async cleanup(): Promise<number> {
    const tasks = await this.getAll();
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const validTasks = tasks.filter((t) => {
      if (t.status === "completed" || t.status === "failed") {
        const completedAt = new Date(t.completedAt ?? t.createdAt);
        return completedAt > twoWeeksAgo;
      }
      return true;
    });

    const removedCount = tasks.length - validTasks.length;

    if (removedCount > 0) {
      await fs.writeFile(this.filePath, validTasks.map((t) => JSON.stringify(t)).join("\n") + "\n", "utf-8");
    }

    return removedCount;
  }

  async getAll(): Promise<PendingTask[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      return lines.map((line) => JSON.parse(line));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      return [];
    }
  }

  private async updateTask(
    id: string,
    updater: (task: PendingTask) => PendingTask,
  ): Promise<boolean> {
    const tasks = await this.getAll();
    const index = tasks.findIndex((t) => t.id === id);

    if (index === -1) {
      return false;
    }

    const task = tasks[index];
    if (!task) {
      return false;
    }

    tasks[index] = updater(task);
    await fs.writeFile(this.filePath, tasks.map((t) => JSON.stringify(t)).join("\n") + "\n", "utf-8");
    return true;
  }
}

export function createPendingQueue(stateDir: string = ".mailtidy"): FilePendingQueue {
  const filePath = path.join(stateDir, "pending-queue.jsonl");
  return new FilePendingQueue(filePath);
}