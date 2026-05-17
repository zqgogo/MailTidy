/**
 * Working context：长上下文压缩与"按需回查原记录"机制（Phase 1 占位）。
 *
 * 思路：超长 thread / 大量证据时先用 compression.ts 摘要 → 写入 WorkingContext，
 * 主循环只持有摘要 + EvidenceRef 指针；需要时再用 ref 拉回原始内容。
 */

export interface EvidenceRef {
  kind: "email" | "search_result" | "web_page" | "memory_entry";
  id: string;
  digest: string;
}

export interface WorkingContext {
  summary: string;
  refs: EvidenceRef[];
}
