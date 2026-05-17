/**
 * 任务记录：每次 Agent 跑 SOP 都对应一条 TaskRecord，写盘后才开始真正动作。
 *
 * 这是 §2.1.7 的硬要求：任何一次执行都必须有可恢复的痕迹。设计上：
 *   1. 启动时先 `JsonTaskStore.create()` 写盘一条 `running` 记录；
 *   2. 每个 turn 结束 / 每个工具调用结束，更新 `progress` 字段并写盘；
 *   3. 收到 SIGINT 时 `markInterrupted()`；正常结束时 `markCompleted()`。
 *   4. 下次进程启动 `scanInterrupted()` 找出未收尾的任务，交给 CheckpointStore 决定恢复。
 *
 * 文件结构：每条任务一个 JSON 文件，路径 `.mailtidy/tasks/<taskId>.json`。
 * 选择"一任务一文件"而非单个 DB：写时不需要锁、kill -9 损坏面只影响当条。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ExitReason } from "../agent/exits.js";

export type TaskStatus = "running" | "completed" | "interrupted" | "failed" | "cancelled";

export type SopKind = "inbox_cleanup" | "daily_brief" | "subscription_scan" | "draft_replies";

export interface TaskProgress {
  /** 当前阶段，例如 "fetch" / "classify" / "plan" / "execute" / "report"。 */
  phase: string;
  /** 已处理邮件数 / 已完成动作数，便于"恢复时跳过"。 */
  completed: number;
  total?: number;
  /** 已完成的动作 ID 集合，恢复时不再重做。 */
  completedActionIds: string[];
  /** 半成品产物（部分报告、部分计划），允许在异常退出时仍能交付部分结果。 */
  partialArtifacts?: Record<string, unknown>;
}

export interface TaskRecord {
  taskId: string;
  sop: SopKind;
  status: TaskStatus;
  /** 启动参数（hours/limit/dimensions/auto_confirm）。恢复时按原样复用。 */
  invocation: Record<string, unknown>;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  exitReason?: ExitReason;
  progress: TaskProgress;
  /** 错误链：捕获的异常 / 重试历史 / 降级日志。 */
  notes: string[];
}

export interface CreateTaskInput {
  sop: SopKind;
  invocation: Record<string, unknown>;
  initialPhase?: string;
  total?: number;
}

export class JsonTaskStore {
  constructor(private readonly dir: string) {}

  /** 创建一条新任务，写盘后返回，调用方应立刻持有 taskId 以便后续更新。 */
  async create(input: CreateTaskInput): Promise<TaskRecord> {
    const now = new Date().toISOString();
    const record: TaskRecord = {
      taskId: randomUUID(),
      sop: input.sop,
      status: "running",
      invocation: input.invocation,
      startedAt: now,
      updatedAt: now,
      progress: {
        phase: input.initialPhase ?? "init",
        completed: 0,
        total: input.total,
        completedActionIds: [],
      },
      notes: [],
    };
    await this.persist(record);
    return record;
  }

  /** 更新已存在的任务记录；用 deep-merge 思路按字段覆盖。 */
  async update(record: TaskRecord): Promise<void> {
    record.updatedAt = new Date().toISOString();
    await this.persist(record);
  }

  async markCompleted(record: TaskRecord, reason: ExitReason = "completed"): Promise<void> {
    record.status = "completed";
    record.exitReason = reason;
    record.endedAt = new Date().toISOString();
    await this.update(record);
  }

  async markInterrupted(record: TaskRecord, reason: ExitReason = "sigint"): Promise<void> {
    record.status = "interrupted";
    record.exitReason = reason;
    record.endedAt = new Date().toISOString();
    await this.update(record);
  }

  async markFailed(record: TaskRecord, reason: ExitReason, note: string): Promise<void> {
    record.status = "failed";
    record.exitReason = reason;
    record.endedAt = new Date().toISOString();
    record.notes.push(note);
    await this.update(record);
  }

  /** 扫描所有未收尾（running / interrupted）任务，按更新时间倒序返回。 */
  async scanInterrupted(): Promise<TaskRecord[]> {
    await this.ensureDir();
    const entries = await fs.readdir(this.dir);
    const results: TaskRecord[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(this.dir, entry), "utf-8");
        const record = JSON.parse(raw) as TaskRecord;
        if (record.status === "running" || record.status === "interrupted") {
          results.push(record);
        }
      } catch {
        // 损坏的 JSON 直接跳过；不让一条坏文件阻塞整个恢复扫描
      }
    }
    results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return results;
  }

  async load(taskId: string): Promise<TaskRecord | null> {
    try {
      const raw = await fs.readFile(this.pathFor(taskId), "utf-8");
      return JSON.parse(raw) as TaskRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async purge(taskId: string): Promise<void> {
    await fs.unlink(this.pathFor(taskId)).catch(() => undefined);
  }

  private pathFor(taskId: string): string {
    return path.join(this.dir, `${taskId}.json`);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  private async persist(record: TaskRecord): Promise<void> {
    await this.ensureDir();
    await fs.writeFile(this.pathFor(record.taskId), JSON.stringify(record, null, 2), "utf-8");
  }
}
