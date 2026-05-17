/**
 * 上下文压缩（Phase 1 占位）。
 * 长邮件 thread、长 search 结果在送入下一轮 LLM 之前压成摘要 + EvidenceRef。
 */

import type { WorkingContext } from "./context.js";

export interface Compressor {
  compress(parts: string[]): Promise<WorkingContext>;
}
