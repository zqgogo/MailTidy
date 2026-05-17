/**
 * Deep think / 主动调查触发（Phase 1 占位）。
 *
 * §2.2.2 触发条件命中时，把"建议你接下来调查 X"作为 system 提示注入主循环。
 */

export interface DeepThinkResult {
  triggered: boolean;
  reason?: string;
  suggestedTool?: string;
  suggestedArgs?: Record<string, unknown>;
}

export interface OriginalRecordCheck {
  emailId: string;
  domain?: string;
  riskNote?: string;
}
