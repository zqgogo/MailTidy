/**
 * Rules 工具：自定义规则匹配。
 *
 * Phase 3.2 实现：
 *   - 连接 Phase 3.1 的规则引擎到工具层
 *   - match_rules 工具供主循环调用
 */

import type { EmailMessage } from "../data/models.js";
import type { AnyToolDefinition } from "./base.js";
import { createRuleEngine, createRuleStore } from "../rules/rules.js";

export interface MatchRulesArgs {
  message: EmailMessage;
}

export interface MatchedRule {
  ruleId: string;
  ruleName: string;
  description?: string;
  action: { kind: string; args?: Record<string, unknown> };
  priority: number;
  confidence: number;
}

export interface MatchRulesResult {
  matched: MatchedRule[];
  conflictsResolved?: {
    winningRule: string;
    discardedRules: string[];
    reason: string;
  };
  note?: string;
}

export function createRulesTools(stateDir?: string): AnyToolDefinition[] {
  const ruleStore = createRuleStore(stateDir);
  const ruleEngine = createRuleEngine(ruleStore);

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
      async invoke(args: MatchRulesArgs): Promise<MatchRulesResult> {
        try {
          const results = await ruleEngine.match(args.message);

          if (results.length === 0) {
            return {
              matched: [],
              note: "No rules matched this message.",
            };
          }

          const conflict = await ruleEngine.resolveConflicts(results);

          const matched: MatchedRule[] = results.map((r) => ({
            ruleId: r.rule.id,
            ruleName: r.rule.name,
            description: r.rule.description,
            action: {
              kind: r.actions[0]?.type ?? "ask_user",
              args: r.actions[0]?.params,
            },
            priority: r.rule.priority,
            confidence: r.confidence,
          }));

          return {
            matched,
            conflictsResolved: conflict.winningRule
              ? {
                  winningRule: conflict.winningRule.name,
                  discardedRules: conflict.discardedRules.map((r) => r.name),
                  reason: conflict.reason,
                }
              : undefined,
            note: conflict.discardedRules.length > 0
              ? `Conflict resolved: ${conflict.reason}`
              : undefined,
          };
        } catch (error) {
          return {
            matched: [],
            note: `Rules engine error: ${error instanceof Error ? error.message : "Unknown error"}`,
          };
        }
      },
    },
  ];
}