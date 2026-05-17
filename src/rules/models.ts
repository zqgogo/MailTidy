/**
 * 自定义规则模型（Phase 3 占位）。
 */

export interface Rule {
  id: string;
  description: string;
  match: Record<string, unknown>;
  action: { kind: string; args?: Record<string, unknown> };
  priority: number;
  source: "user_nl" | "user_yaml" | "imported";
}
