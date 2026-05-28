/**
 * Trace 事件流：把 pi 的事件（turn_start / tool_execution_start / ...）
 * 转成 MailTidy 友好的可回放结构（Phase 1 占位）。
 *
 * §2.5 "展示思考"开关 (--show-thinking) 会消费这里的事件输出。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type TraceEventKind =
  | "turn_start"
  | "turn_end"
  | "tool_call"
  | "tool_result"
  | "deep_think_triggered"
  | "checkpoint_written"
  | "exit";

export interface TraceEvent {
  kind: TraceEventKind;
  at: string;
  taskId: string;
  stepId?: string;
  payload?: Record<string, unknown>;
}

export interface CreateTraceEventOptions {
  at?: string | Date;
  stepId?: string;
  payload?: Record<string, unknown>;
}

export function createTraceEvent(
  taskId: string,
  kind: TraceEventKind,
  options: CreateTraceEventOptions = {},
): TraceEvent {
  return {
    kind,
    at: normalizeTimestamp(options.at),
    taskId,
    stepId: options.stepId,
    payload: options.payload,
  };
}

export function traceEventToJsonLine(event: TraceEvent): string {
  return JSON.stringify(event);
}

export function parseTraceJsonLines(raw: string): TraceEvent[] {
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parsed = JSON.parse(line) as TraceEvent;
      if (!isTraceEvent(parsed)) {
        throw new Error("Invalid trace event JSONL entry");
      }
      return parsed;
    });
}

export function traceSliceAroundStep(events: TraceEvent[], centerStepId: string, window = 3): TraceEvent[] {
  const center = events.findIndex((event) => event.stepId === centerStepId);
  if (center === -1) return [];
  const safeWindow = Math.max(0, Math.floor(window));
  return events.slice(Math.max(0, center - safeWindow), center + safeWindow + 1);
}

export class TraceStore {
  constructor(private readonly dir: string) {}

  async append(event: TraceEvent): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const file = this.pathFor(event.taskId);
    const existing = await readFile(file, "utf-8").catch(() => "");
    await writeFile(file, `${existing}${traceEventToJsonLine(event)}\n`, "utf-8");
  }

  async load(taskId: string): Promise<TraceEvent[]> {
    const raw = await readFile(this.pathFor(taskId), "utf-8");
    return parseTraceJsonLines(raw);
  }

  pathFor(taskId: string): string {
    return path.join(this.dir, `${taskId}.jsonl`);
  }
}

function normalizeTimestamp(at: string | Date | undefined): string {
  if (at instanceof Date) return at.toISOString();
  return at ?? new Date().toISOString();
}

function isTraceEvent(value: unknown): value is TraceEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Partial<TraceEvent>;
  return typeof event.kind === "string" && typeof event.at === "string" && typeof event.taskId === "string";
}
