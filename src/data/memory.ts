/**
 * Agent 长期记忆：发件人偏好、写作风格、订阅历史。
 *
 * Phase 2.1: 学习层基于 ask_user 回调和 apply_action 后的决策日志向这里写偏好
 * Phase 2.6: 偏好加 learnedFrom/learnedAt 元数据；支持一键回滚
 * Phase V2: SQLite 作为权威数据层，JSON 只做配置和向后兼容。
 *
 * `.mailtidy/memory.json` 已在 .gitignore 中排除。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { type StyleProfile, defaultStyleProfile } from "./models.js";
import type { Database } from "./database.js";
import { PreferenceRepository } from "./preferences.js";

export interface SenderPreference {
  category?: string;
  importanceDelta: number;
  preferredAction?: string;
  ignoredCount: number;
  learnedFrom?: string;
  learnedAt?: string;
  createdAt?: string;
  lastUsed?: string;
}

export interface PreferenceHistoryEntry {
  id: string;
  timestamp: string;
  sender: string;
  previousPreference?: SenderPreference;
  newPreference: SenderPreference;
  reason?: string;
  actionType: "create" | "update" | "delete";
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
  preferenceHistory: PreferenceHistoryEntry[];
}

export function emptyMemory(): AgentMemory {
  return {
    senderPreferences: {},
    actionPreferences: {},
    styleProfile: defaultStyleProfile(),
    subscriptionHistory: [],
    preferenceHistory: [],
  };
}

export function preferenceFor(memory: AgentMemory, sender: string): SenderPreference {
  return memory.senderPreferences[sender.toLowerCase()] ?? emptyPreference();
}

export function rememberSender(
  memory: AgentMemory,
  sender: string,
  preference: SenderPreference,
  reason?: string,
): void {
  const senderKey = sender.toLowerCase();
  const previousPreference = memory.senderPreferences[senderKey];
  
  const historyEntry: PreferenceHistoryEntry = {
    id: `pref_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date().toISOString(),
    sender: senderKey,
    previousPreference,
    newPreference: preference,
    reason,
    actionType: previousPreference ? "update" : "create",
  };
  
  memory.preferenceHistory.unshift(historyEntry);
  
  if (memory.preferenceHistory.length > 1000) {
    memory.preferenceHistory = memory.preferenceHistory.slice(0, 1000);
  }
  
  memory.senderPreferences[senderKey] = preference;
}

export function forgetSender(
  memory: AgentMemory,
  sender: string,
  reason?: string,
): void {
  const senderKey = sender.toLowerCase();
  const previousPreference = memory.senderPreferences[senderKey];
  
  if (previousPreference) {
    const historyEntry: PreferenceHistoryEntry = {
      id: `pref_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
      sender: senderKey,
      previousPreference,
      newPreference: emptyPreference(),
      reason,
      actionType: "delete",
    };
    
    memory.preferenceHistory.unshift(historyEntry);
    
    if (memory.preferenceHistory.length > 1000) {
      memory.preferenceHistory = memory.preferenceHistory.slice(0, 1000);
    }
    
    delete memory.senderPreferences[senderKey];
  }
}

export function rollbackToHistoryEntry(
  memory: AgentMemory,
  historyId: string,
): { success: boolean; message: string } {
  const entry = memory.preferenceHistory.find((e) => e.id === historyId);
  
  if (!entry) {
    return { success: false, message: `找不到历史记录 ID: ${historyId}` };
  }
  
  if (entry.actionType === "create") {
    delete memory.senderPreferences[entry.sender];
    const rollbackReason = `回滚到创建之前 (${entry.id})`;
    forgetSender(memory, entry.sender, rollbackReason);
    return { success: true, message: `已回滚「${entry.sender}」的偏好到创建之前` };
  }
  
  if (entry.actionType === "update") {
    if (entry.previousPreference) {
      memory.senderPreferences[entry.sender] = entry.previousPreference;
    } else {
      delete memory.senderPreferences[entry.sender];
    }
    const rollbackReason = `回滚到更新之前 (${entry.id})`;
    rememberSender(memory, entry.sender, entry.previousPreference ?? emptyPreference(), rollbackReason);
    return { success: true, message: `已回滚「${entry.sender}」的偏好到更新之前` };
  }
  
  if (entry.actionType === "delete") {
    memory.senderPreferences[entry.sender] = entry.previousPreference ?? emptyPreference();
    const rollbackReason = `撤销删除 (${entry.id})`;
    rememberSender(memory, entry.sender, entry.previousPreference ?? emptyPreference(), rollbackReason);
    return { success: true, message: `已撤销删除「${entry.sender}」的偏好` };
  }
  
  return { success: false, message: `无法处理历史记录类型: ${entry.actionType}` };
}

export function getRecentHistory(memory: AgentMemory, limit: number = 20): PreferenceHistoryEntry[] {
  return memory.preferenceHistory.slice(0, limit);
}

export function getHistoryBySender(memory: AgentMemory, sender: string): PreferenceHistoryEntry[] {
  return memory.preferenceHistory.filter((e) => e.sender.toLowerCase() === sender.toLowerCase());
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
        preferenceHistory: data.preferenceHistory ?? [],
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

export function createMemoryStore(stateDir: string = ".mailtidy"): JsonMemoryStore {
  const filePath = path.join(stateDir, "memory.json");
  return new JsonMemoryStore(filePath);
}

export async function loadAgentMemoryFromSQLite(db: Database): Promise<AgentMemory> {
  const preferenceRepo = new PreferenceRepository(db);
  const preferences = await preferenceRepo.getAllActive();

  const senderPreferences: Record<string, SenderPreference> = {};
  const actionPreferences: Record<string, string> = {};

  for (const pref of preferences) {
    const value = JSON.parse(pref.value_json) as SenderPreference;
    
    if (pref.scope === "sender") {
      senderPreferences[pref.key] = {
        ...value,
        learnedFrom: pref.learned_from,
        learnedAt: pref.learned_at,
      };
    } else if (pref.scope === "action") {
      actionPreferences[pref.key] = value.preferredAction ?? "confirm";
    }
  }

  const historyRecords = await preferenceRepo.getRecentHistory(1000);
  const preferenceHistory: PreferenceHistoryEntry[] = historyRecords.map((record) => ({
    id: record.id,
    timestamp: record.created_at,
    sender: record.preference_id,
    previousPreference: record.previous_json ? JSON.parse(record.previous_json) : undefined,
    newPreference: JSON.parse(record.next_json),
    reason: record.reason,
    actionType: record.action as PreferenceHistoryEntry["actionType"],
  }));

  return {
    senderPreferences,
    actionPreferences,
    styleProfile: defaultStyleProfile(),
    subscriptionHistory: [],
    preferenceHistory,
  };
}