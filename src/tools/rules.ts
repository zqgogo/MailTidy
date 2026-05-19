/**
 * Rules 工具：自定义规则匹配。
 *
 * 当前是 Phase 1 的 schema-defined stub —— 真正的规则引擎 (NL 解析 / 匹配 /
 * 冲突处理) 在 Phase 3（src/rules/* 全部填充后）。但 schema 已固定，主循环
 * 现在就能注册它；命中阶段返回空数组 + note，让 LLM 知道规则机制存在但
 * 当前无规则可匹配。
 *
 * Phase 3 落地后改 invoke：调 RuleStore.list() + matcher.evaluate(message, rules)。
 */

import type { EmailMessage } from "../data/models.js";
import type { AnyToolDefinition } from "./base.js";

export interface MatchRulesArgs {
  message: EmailMessage;
}

export interface MatchedRule {
  ruleId: string;
  description: string;
  action: { kind: string; args?: Record<string, unknown> };
  priority: number;
}

export interface MatchRulesResult {
  matched: MatchedRule[];
  note?: string;
}

export function createRulesTools(): AnyToolDefinition[] {
  return [
    {
      name: "match_rules",
      description:
        "Evaluate user-defined rules against an email and return matched rules sorted by priority. Use before applying actions when the user has defined custom routing rules.",
      schema: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "object" },
        },
        additionalProperties: false,
      },
      risk: "low",
      rateLimit: { perTask: 30 },
      async invoke(_args: MatchRulesArgs): Promise<MatchRulesResult> {
        return {
          matched: [],
          note: "Rules engine not yet implemented (Phase 3). No user rules to match.",
        };
      },
    },
  ];
}
