/**
 * 用量与成本统计。在 pi 的 `afterToolCall` 钩子里累加 token，
 * Phase 1 主循环结束时写到任务记录的 notes / partialArtifacts。
 */

export interface UsageRecord {
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  /** 估算费用（USD），按 ModelProfile.{input,output}CostPer1k 计算。 */
  costUsd: number;
  at: string;
}

export class UsageLedger {
  private records: UsageRecord[] = [];

  record(entry: Omit<UsageRecord, "at">): void {
    this.records.push({ ...entry, at: new Date().toISOString() });
  }

  snapshot(): UsageRecord[] {
    return [...this.records];
  }

  totalCost(): number {
    return this.records.reduce((sum, r) => sum + r.costUsd, 0);
  }
}
