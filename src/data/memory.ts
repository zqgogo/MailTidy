/**
 * Agent 长期记忆：发件人偏好、写作风格、订阅历史。
 *
 * 学习层（Phase 2）会基于 ask_user 回调和 apply_action 后的决策日志
 * 向这里写偏好。当前 demo 阶段只读不写。
 *
 * 当前实现：本地 JSON。生产版应换成 SQLite + SQLCipher 加密。
 * `.mailtidy/memory.json` 已在 .gitignore 中排除。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { type StyleProfile, defaultStyleProfile } from "./models.js";

export interface SenderPreference {
  category?: string;
  importanceDelta: number;
  preferredAction?: string;
  ignoredCount: number;
}

export function emptyPreference(): SenderPreference {
  return { importanceDelta: 0, ignoredCount: 0 };
}

export interface SubscriptionScanSnapshot {
  scannedAt: string;
  items: Record<string, unknown>[];
}

export interface AgentMemory {
  senderPreferences: Record<string, SenderPreference>;
  actionPreferences: Record<string, string>;
  styleProfile: StyleProfile;
  subscriptionHistory: SubscriptionScanSnapshot[];
}

export function emptyMemory(): AgentMemory {
  return {
    senderPreferences: {},
    actionPreferences: {},
    styleProfile: defaultStyleProfile(),
    subscriptionHistory: [],
  };
}

export function preferenceFor(memory: AgentMemory, sender: string): SenderPreference {
  return memory.senderPreferences[sender.toLowerCase()] ?? emptyPreference();
}

export function rememberSender(
  memory: AgentMemory,
  sender: string,
  preference: SenderPreference,
): void {
  memory.senderPreferences[sender.toLowerCase()] = preference;
}

export class JsonMemoryStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<AgentMemory> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const data = JSON.parse(raw) as Partial<AgentMemory>;
      return {
        senderPreferences: data.senderPreferences ?? {},
        actionPreferences: data.actionPreferences ?? {},
        styleProfile: { ...defaultStyleProfile(), ...(data.styleProfile ?? {}) },
        subscriptionHistory: data.subscriptionHistory ?? [],
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyMemory();
      throw err;
    }
  }

  async save(memory: AgentMemory): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(memory, null, 2), "utf-8");
  }
}
