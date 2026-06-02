/**
 * 规则模型：自定义规则的定义、匹配和冲突处理。
 *
 * Phase 3.1 实现：
 *   - 规则接口定义
 *   - 规则存储（JSONL持久化）
 *   - 规则匹配引擎
 *   - 冲突处理策略
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { EmailMessage } from "../data/models.js";

export type RuleConditionType =
  | "sender_contains"
  | "sender_equals"
  | "sender_matches"
  | "subject_contains"
  | "subject_matches"
  | "body_contains"
  | "body_matches"
  | "has_attachment"
  | "is_unread"
  | "has_label"
  | "snippet_contains";

export type RuleActionType =
  | "archive"
  | "delete"
  | "mark_read"
  | "mark_unread"
  | "star"
  | "label"
  | "forward"
  | "reply"
  | "ask_user"
  | "block_sender"
  | "flag_as_spam";

export interface RuleCondition {
  type: RuleConditionType;
  value: string | number;
  caseSensitive?: boolean;
  negate?: boolean;
}

export interface RuleAction {
  type: RuleActionType;
  params?: Record<string, unknown>;
  priority: number;
}

export interface Rule {
  id: string;
  name: string;
  description?: string;
  conditions: RuleCondition[];
  actions: RuleAction[];
  priority: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

export interface RuleMatchResult {
  rule: Rule;
  matchedConditions: RuleCondition[];
  actions: RuleAction[];
  confidence: number;
}

export interface ConflictResolution {
  winningRule: Rule | undefined;
  discardedRules: Rule[];
  reason: string;
}

export interface RuleStore {
  add(rule: Omit<Rule, "id" | "createdAt" | "updatedAt">): Promise<string>;
  getById(id: string): Promise<Rule | null>;
  getAll(): Promise<Rule[]>;
  update(id: string, updates: Partial<Omit<Rule, "id" | "createdAt">>): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  getEnabledRules(): Promise<Rule[]>;
}

export class FileRuleStore implements RuleStore {
  constructor(private readonly filePath: string) {}

  async add(rule: Omit<Rule, "id" | "createdAt" | "updatedAt">): Promise<string> {
    const now = new Date().toISOString();
    const newRule: Rule = {
      ...rule,
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      createdAt: now,
      updatedAt: now,
    };

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify(newRule) + "\n";
    await fs.appendFile(this.filePath, line, "utf-8");

    return newRule.id;
  }

  async getById(id: string): Promise<Rule | null> {
    const rules = await this.getAll();
    return rules.find((r) => r.id === id) ?? null;
  }

  async getAll(): Promise<Rule[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      return lines.map((line) => JSON.parse(line));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      return [];
    }
  }

  async update(id: string, updates: Partial<Omit<Rule, "id" | "createdAt">>): Promise<boolean> {
    const rules = await this.getAll();
    const index = rules.findIndex((r) => r.id === id);

    if (index === -1) {
      return false;
    }

    const existingRule = rules[index];
    rules[index] = {
      ...existingRule,
      ...updates,
      updatedAt: new Date().toISOString(),
    } as Rule;

    await fs.writeFile(this.filePath, rules.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
    return true;
  }

  async delete(id: string): Promise<boolean> {
    const rules = await this.getAll();
    const filtered = rules.filter((r) => r.id !== id);

    if (filtered.length === rules.length) {
      return false;
    }

    await fs.writeFile(this.filePath, filtered.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
    return true;
  }

  async getEnabledRules(): Promise<Rule[]> {
    const rules = await this.getAll();
    return rules.filter((r) => r.enabled).sort((a, b) => b.priority - a.priority);
  }
}

export class RuleEngine {
  constructor(private readonly ruleStore: RuleStore) {}

  async match(message: EmailMessage): Promise<RuleMatchResult[]> {
    const rules = await this.ruleStore.getEnabledRules();
    const results: RuleMatchResult[] = [];

    for (const rule of rules) {
      const matchedConditions = this.evaluateConditions(rule.conditions, message);

      if (matchedConditions.length === rule.conditions.length) {
        const confidence = matchedConditions.length / rule.conditions.length;
        results.push({
          rule,
          matchedConditions,
          actions: rule.actions,
          confidence,
        });
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  async resolveConflicts(results: RuleMatchResult[]): Promise<ConflictResolution> {
    if (results.length === 0) {
      return {
        winningRule: undefined,
        discardedRules: [],
        reason: "No rules matched",
      };
    }

    if (results.length === 1) {
      const firstResult = results[0];
      return {
        winningRule: firstResult ? firstResult.rule : undefined,
        discardedRules: [],
        reason: "Only one rule matched",
      };
    }

    const sortedResults = [...results].sort((a, b) => b.rule.priority - a.rule.priority);
    const winning = sortedResults[0];

    return {
      winningRule: winning ? winning.rule : undefined,
      discardedRules: sortedResults.slice(1).map((r) => r.rule),
      reason: winning ? `Highest priority rule (${winning.rule.priority}) wins` : "No rules matched",
    };
  }

  private evaluateConditions(conditions: RuleCondition[], message: EmailMessage): RuleCondition[] {
    const matched: RuleCondition[] = [];

    for (const condition of conditions) {
      if (this.matchesCondition(condition, message)) {
        matched.push(condition);
      }
    }

    return matched;
  }

  private matchesCondition(condition: RuleCondition, message: EmailMessage): boolean {
    const value = String(condition.value);
    const negate = condition.negate ?? false;
    const caseSensitive = condition.caseSensitive ?? false;

    let match = false;

    switch (condition.type) {
      case "sender_contains":
        match = caseSensitive
          ? message.sender.includes(value)
          : message.sender.toLowerCase().includes(value.toLowerCase());
        break;

      case "sender_equals":
        match = caseSensitive
          ? message.sender === value
          : message.sender.toLowerCase() === value.toLowerCase();
        break;

      case "sender_matches":
        match = new RegExp(value, caseSensitive ? "" : "i").test(message.sender);
        break;

      case "subject_contains":
        match = caseSensitive
          ? message.subject.includes(value)
          : message.subject.toLowerCase().includes(value.toLowerCase());
        break;

      case "subject_matches":
        match = new RegExp(value, caseSensitive ? "" : "i").test(message.subject);
        break;

      case "body_contains":
        if (message.body) {
          match = caseSensitive
            ? message.body.includes(value)
            : message.body.toLowerCase().includes(value.toLowerCase());
        }
        break;

      case "body_matches":
        if (message.body) {
          match = new RegExp(value, caseSensitive ? "" : "i").test(message.body);
        }
        break;

      case "has_attachment":
        match = message.hasAttachment ?? false;
        break;

      case "is_unread":
        match = message.unread ?? false;
        break;

      case "has_label":
        match = message.labels?.includes(value) ?? false;
        break;

      case "snippet_contains":
        match = caseSensitive
          ? message.snippet.includes(value)
          : message.snippet.toLowerCase().includes(value.toLowerCase());
        break;
    }

    return negate ? !match : match;
  }
}

export function createRuleStore(stateDir: string = ".mailtidy"): FileRuleStore {
  const filePath = path.join(stateDir, "rules.jsonl");
  return new FileRuleStore(filePath);
}

export function createRuleEngine(ruleStore?: RuleStore): RuleEngine {
  return new RuleEngine(ruleStore ?? createRuleStore());
}