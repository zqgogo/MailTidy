import type { Database } from "./database.js";
import { MemoryItemRepository } from "./memory-items.js";
import { DecisionLogRepository } from "./decision-logs-sqlite.js";
import { PreferenceRepository } from "./preferences.js";
import type { MemoryItemType } from "./memory-items.js";

export interface MemoryItemGeneratorOptions {
  db: Database;
}

export class MemoryItemGenerator {
  private readonly memoryItemRepo: MemoryItemRepository;
  private readonly decisionLogRepo: DecisionLogRepository;
  private readonly preferenceRepo: PreferenceRepository;

  constructor(options: MemoryItemGeneratorOptions) {
    this.memoryItemRepo = new MemoryItemRepository(options.db);
    this.decisionLogRepo = new DecisionLogRepository(options.db);
    this.preferenceRepo = new PreferenceRepository(options.db);
  }

  async generateFromDecisionLog(logId: string): Promise<void> {
    const log = await this.decisionLogRepo.getById(logId);
    if (!log) return;

    const existingItems = await this.memoryItemRepo.getItemsBySource("decision_logs", logId);
    if (existingItems.length > 0) {
      for (const item of existingItems) {
        await this.memoryItemRepo.tombstoneItem(item.id);
      }
    }

    const content = this.buildDecisionContent(log);

    await this.memoryItemRepo.createItem({
      type: "decision",
      sourceTable: "decision_logs",
      sourceId: logId,
      title: log.subject || "Decision Log",
      content,
      metadata: {
        sender: log.sender,
        category: log.original_category,
        suggestedAction: log.suggested_action,
        finalAction: log.final_action,
        userResponse: log.user_response,
        confidence: log.confidence,
      },
      importance: log.confidence ? Math.min(log.confidence, 1) : 0.5,
    });
  }

  async generateFromPreference(preferenceId: string): Promise<void> {
    const preference = await this.preferenceRepo.getById(preferenceId);
    if (!preference || preference.status !== "active") return;

    const existingItems = await this.memoryItemRepo.getItemsBySource("preferences", preferenceId);
    if (existingItems.length > 0) {
      for (const item of existingItems) {
        await this.memoryItemRepo.tombstoneItem(item.id);
      }
    }

    const content = this.buildPreferenceContent(preference);

    await this.memoryItemRepo.createItem({
      type: "preference_note",
      sourceTable: "preferences",
      sourceId: preferenceId,
      title: `${preference.scope}: ${preference.key}`,
      content,
      metadata: {
        scope: preference.scope,
        key: preference.key,
        confidence: preference.confidence,
        learnedFrom: preference.learned_from,
        learnedAt: preference.learned_at,
      },
      importance: preference.confidence,
    });
  }

  async rebuildAll(type?: MemoryItemType): Promise<{ generated: number; errors: string[] }> {
    const errors: string[] = [];
    let generated = 0;

    if (!type || type === "decision") {
      const logs = await this.decisionLogRepo.queryLogs({ limit: 1000 });
      for (const log of logs) {
        try {
          await this.generateFromDecisionLog(log.id);
          generated++;
        } catch (err) {
          errors.push(`Failed to generate from decision log ${log.id}: ${(err as Error).message}`);
        }
      }
    }

    if (!type || type === "preference_note") {
      const preferences = await this.preferenceRepo.getAllActive();
      for (const pref of preferences) {
        try {
          await this.generateFromPreference(pref.id);
          generated++;
        } catch (err) {
          errors.push(`Failed to generate from preference ${pref.id}: ${(err as Error).message}`);
        }
      }
    }

    return { generated, errors };
  }

  private buildDecisionContent(log: {
    sender: string;
    subject?: string;
    original_category: string;
    suggested_action: string;
    final_action?: string;
    user_response?: string;
    confidence?: number;
    reason?: string;
  }): string {
    const parts: string[] = [];
    
    if (log.subject) {
      parts.push(`Subject: ${log.subject}`);
    }
    parts.push(`Sender: ${log.sender}`);
    parts.push(`Category: ${log.original_category}`);
    parts.push(`Suggested Action: ${log.suggested_action}`);
    
    if (log.final_action) {
      parts.push(`Final Action: ${log.final_action}`);
    }
    if (log.user_response) {
      parts.push(`User Response: ${log.user_response}`);
    }
    if (log.confidence !== undefined) {
      parts.push(`Confidence: ${(log.confidence * 100).toFixed(0)}%`);
    }
    if (log.reason) {
      parts.push(`Reason: ${log.reason}`);
    }

    return parts.join("\n");
  }

  private buildPreferenceContent(preference: {
    scope: string;
    key: string;
    value_json: string;
    confidence: number;
    learned_from?: string;
    learned_at?: string;
  }): string {
    const parts: string[] = [];
    
    parts.push(`Scope: ${preference.scope}`);
    parts.push(`Key: ${preference.key}`);
    
    try {
      const value = JSON.parse(preference.value_json);
      if (value.category) parts.push(`Category: ${value.category}`);
      if (value.preferredAction) parts.push(`Preferred Action: ${value.preferredAction}`);
      if (value.importanceDelta !== undefined) parts.push(`Importance Delta: ${value.importanceDelta}`);
    } catch {
      parts.push(`Value: ${preference.value_json}`);
    }
    
    parts.push(`Confidence: ${(preference.confidence * 100).toFixed(0)}%`);
    
    if (preference.learned_from) {
      parts.push(`Learned From: ${preference.learned_from}`);
    }
    if (preference.learned_at) {
      parts.push(`Learned At: ${preference.learned_at}`);
    }

    return parts.join("\n");
  }
}