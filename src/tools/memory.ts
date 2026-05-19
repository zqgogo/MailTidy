/**
 * Memory 工具：让 LLM 能在主循环里查 AgentMemory（发件人偏好、风格画像、订阅历史）。
 *
 * - `recall_memory` 是低风险读操作，给主循环每轮按需查偏好。
 * - `write_memory` 是高风险写操作；DecisionPolicy 必须在 beforeToolCall 钩点
 *   阻断，需要用户确认；同时受 perTask=5 频率限制（§2.9 工具表）。
 *
 * 数据形状参考 src/data/memory.ts 的 AgentMemory；写入不持久化，主循环在 turn
 * 结束 / SOP 收尾时由 CLI 层调 JsonMemoryStore.save 把整个 memory 落盘。
 */

import {
  type AgentMemory,
  type SenderPreference,
  emptyPreference,
  preferenceFor,
  rememberSender,
} from "../data/memory.js";
import type { AnyToolDefinition } from "./base.js";

export interface RecallMemoryArgs {
  /** "sender" → 单个发件人偏好；"style" → 写作风格；"subscriptions" → 订阅历史。 */
  kind: "sender" | "style" | "subscriptions" | "action_preferences";
  /** kind=sender 时必填，取发件人邮箱。其他 kind 忽略。 */
  sender?: string;
  /** kind=subscriptions 时可选返回最近 N 条，默认 5。 */
  limit?: number;
}

export interface WriteMemoryArgs {
  kind: "sender" | "action_preference";
  /** kind=sender 时填发件人邮箱；kind=action_preference 时填 "<sender>:<action>"。 */
  key: string;
  /** kind=sender 时为部分 SenderPreference；kind=action_preference 时为字符串。 */
  value: Partial<SenderPreference> | string;
  /** §2.4.3 学习层透明度：必填来源，便于 rollback。 */
  learnedFrom: string;
}

export function createMemoryTools(memory: AgentMemory): AnyToolDefinition[] {
  return [
    {
      name: "recall_memory",
      description:
        "Recall persisted MailTidy preferences. Use to fetch sender-specific preferences, the user's writing style profile, action preferences, or recent subscription scans before deciding on an action.",
      schema: {
        type: "object",
        required: ["kind"],
        properties: {
          kind: { type: "string", enum: ["sender", "style", "subscriptions", "action_preferences"] },
          sender: { type: "string", minLength: 1 },
          limit: { type: "number", minimum: 1, maximum: 50 },
        },
        additionalProperties: false,
      },
      risk: "low",
      rateLimit: { perTask: 20 },
      async invoke(args: RecallMemoryArgs): Promise<unknown> {
        switch (args.kind) {
          case "sender": {
            if (!args.sender) return { error: "sender is required when kind=sender" };
            return preferenceFor(memory, args.sender);
          }
          case "style":
            return memory.styleProfile;
          case "action_preferences":
            return memory.actionPreferences;
          case "subscriptions": {
            const limit = args.limit ?? 5;
            return memory.subscriptionHistory.slice(-limit);
          }
        }
      },
    },
    {
      name: "write_memory",
      description:
        "Write a learned preference back to MailTidy memory. HIGH RISK — must only be called after the user explicitly confirms the new preference. Always set learnedFrom for rollback traceability.",
      schema: {
        type: "object",
        required: ["kind", "key", "value", "learnedFrom"],
        properties: {
          kind: { type: "string", enum: ["sender", "action_preference"] },
          key: { type: "string", minLength: 1 },
          value: {},
          learnedFrom: { type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      risk: "high",
      rateLimit: { perTask: 5 },
      async invoke(args: WriteMemoryArgs): Promise<{ ok: true; key: string }> {
        if (args.kind === "sender") {
          const existing = preferenceFor(memory, args.key);
          const merged: SenderPreference = {
            ...emptyPreference(),
            ...existing,
            ...(args.value as Partial<SenderPreference>),
          };
          rememberSender(memory, args.key, merged);
        } else {
          memory.actionPreferences[args.key] = String(args.value);
        }
        return { ok: true, key: args.key };
      },
    },
  ];
}
