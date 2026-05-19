/**
 * Tool 接口：Phase 1 把所有 connector / 规则 / 记忆 / 研究 / 用户问答都包成
 * 这套接口注册给 pi。本文件先定义类型，让后续模块可以类型对齐。
 *
 * 设计要点（§1.3 / §2.1.6）：
 *   - 描述清晰，让 LLM 自己选
 *   - JSON schema 描述参数，pi-agent-core 的 beforeToolCall 钩子会校验
 *   - risk: 低风险默认放过；中风险走 ask_user；高风险必须用户确认
 *   - 限频：rateLimit 字段在 executor 内统计
 */

export type ToolRisk = "low" | "medium" | "high";

export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  risk: ToolRisk;
  rateLimit?: { perTask?: number; perMinute?: number };
  invoke(args: TArgs): Promise<TResult>;
}

export type AnyToolDefinition = ToolDefinition<any, any>;
