/**
 * LLM 层的稳定抽象。
 *
 * 不绑定任何供应商：Agent / tools / skills 只依赖这里定义的接口；
 * OpenAI、Anthropic、本地模型、启发式兜底都放在 `integrations/llm/`。
 *
 * Phase 1 接入 pi 后，OpenAI / Anthropic adapter 内部会用 `@earendil-works/pi-ai`
 * 完成协议层（tool_use schema、流式解析、并行 tool call、token 统计）；
 * 但暴露给 Agent 的仍然是这套窄接口。
 */

import type { EmailJudgment, EmailMessage, StyleProfile } from "../data/models.js";

export interface ModelProfile {
  name: string;
  provider: string;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
  contextWindow?: number;
  supportsTools: boolean;
  supportsLocal?: boolean;
}

export interface LLMClient {
  readonly profile: ModelProfile;
  classifyEmail(message: EmailMessage, customDimensions?: string[]): Promise<EmailJudgment>;
  draftReply(message: EmailMessage, style: StyleProfile): Promise<string>;
  summarizeNewsletters(messages: EmailMessage[]): Promise<string>;
}
