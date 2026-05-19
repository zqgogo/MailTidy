/**
 * History 工具：受限"回查原记录"通道。
 *
 * §2.2 "回查原记录的限制"硬约束在这里落实：
 *   - 单次邮件正文读取 maxChars=6000
 *   - 单次 trace 回查窗口前后各 3 步
 *   - 单轮回查次数 ≤ 3（pi rateLimit.perTask 强制）
 *
 * 当前实现读取 .mailtidy/{reports,traces} 下的文件；Phase 1.8 + Phase 2
 * 把 trace / report 真正写出来之后才有内容可读，但 schema 与限频先就位，
 * 让主循环可注册并让 LLM 知道这条受限通道。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { AnyToolDefinition } from "./base.js";

export interface HistoryToolOptions {
  /** 默认 .mailtidy；CLI 启动时传入实际 state 目录。 */
  stateDir?: string;
}

export interface ReadTraceSliceArgs {
  taskId: string;
  /** 围绕该 step 前后各 window 步，默认 3。硬上限 10。 */
  centerStepId?: string;
  window?: number;
}

export interface ReadReportSummaryArgs {
  taskId: string;
  /** "partial" → 读 -partial.md；省略读完成报告。 */
  variant?: "partial";
}

export interface ReadOriginalRecordArgs {
  kind: "email" | "memory_entry";
  id: string;
  /** 邮件正文最大返回字符数，默认 6000。硬上限 6000。 */
  maxChars?: number;
}

const MAX_CHARS = 6000;
const MAX_TRACE_WINDOW = 10;

export function createHistoryTools(options: HistoryToolOptions = {}): AnyToolDefinition[] {
  const stateDir = options.stateDir ?? ".mailtidy";
  const tracesDir = path.join(stateDir, "traces");
  const reportsDir = path.join(stateDir, "reports");

  return [
    {
      name: "read_trace_slice",
      description:
        "Read a windowed slice of a prior task's trace (JSONL). Use to revisit a specific decision step when the current decision conflicts with prior reasoning. Bounded window prevents context bloat.",
      schema: {
        type: "object",
        required: ["taskId"],
        properties: {
          taskId: { type: "string", minLength: 1 },
          centerStepId: { type: "string" },
          window: { type: "number", minimum: 1, maximum: MAX_TRACE_WINDOW },
        },
        additionalProperties: false,
      },
      risk: "low",
      rateLimit: { perTask: 3 },
      async invoke(args: ReadTraceSliceArgs): Promise<{ events: unknown[]; note?: string }> {
        const file = path.join(tracesDir, `${args.taskId}.jsonl`);
        const raw = await fs.readFile(file, "utf-8").catch(() => null);
        if (raw === null) {
          return { events: [], note: `trace file not found: ${file}` };
        }
        const lines = raw.split("\n").filter((l) => l.trim().length > 0);
        const events = lines.map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return { raw: l, parseError: true };
          }
        });
        if (!args.centerStepId) return { events };
        const window = Math.min(args.window ?? 3, MAX_TRACE_WINDOW);
        const center = events.findIndex(
          (e) => typeof e === "object" && e !== null && "stepId" in e && (e as { stepId: string }).stepId === args.centerStepId,
        );
        if (center === -1) return { events: [], note: "centerStepId not found in trace" };
        return { events: events.slice(Math.max(0, center - window), center + window + 1) };
      },
    },
    {
      name: "read_report_summary",
      description:
        "Read a prior task's report summary (completed or partial). Use to recall what the previous run accomplished before continuing a follow-up task.",
      schema: {
        type: "object",
        required: ["taskId"],
        properties: {
          taskId: { type: "string", minLength: 1 },
          variant: { type: "string", enum: ["partial"] },
        },
        additionalProperties: false,
      },
      risk: "low",
      rateLimit: { perTask: 5 },
      async invoke(args: ReadReportSummaryArgs): Promise<{ content: string | null; note?: string }> {
        const suffix = args.variant === "partial" ? "-partial.md" : ".md";
        const file = path.join(reportsDir, `${args.taskId}${suffix}`);
        const raw = await fs.readFile(file, "utf-8").catch(() => null);
        if (raw === null) {
          return { content: null, note: `report file not found: ${file}` };
        }
        return { content: raw };
      },
    },
    {
      name: "read_original_record",
      description:
        "Read up to 6000 characters of an original record (email body or memory entry). Use sparingly — main loop should rely on summaries; only call when summary alone is insufficient.",
      schema: {
        type: "object",
        required: ["kind", "id"],
        properties: {
          kind: { type: "string", enum: ["email", "memory_entry"] },
          id: { type: "string", minLength: 1 },
          maxChars: { type: "number", minimum: 100, maximum: MAX_CHARS },
        },
        additionalProperties: false,
      },
      risk: "low",
      rateLimit: { perTask: 3 },
      async invoke(args: ReadOriginalRecordArgs): Promise<{ content: string | null; note?: string }> {
        // Phase 1.8 之前没有持久化原始记录；先返回结构化提示。
        const cap = Math.min(args.maxChars ?? MAX_CHARS, MAX_CHARS);
        return {
          content: null,
          note: `read_original_record backend not yet implemented (Phase 1.8). Requested kind=${args.kind} id=${args.id} maxChars=${cap}`,
        };
      },
    },
  ];
}
