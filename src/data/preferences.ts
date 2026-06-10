import type { Database } from "./database.js";
import type { SenderPreference } from "./memory.js";

export type PreferenceScope = "sender" | "domain" | "category" | "action" | "style" | "global";

export interface PreferenceRecord {
  id: string;
  scope: PreferenceScope;
  key: string;
  value_json: string;
  confidence: number;
  status: "active" | "archived" | "rejected";
  learned_from?: string;
  learned_at?: string;
  created_at: string;
  updated_at: string;
}

export interface PreferenceHistoryRecord {
  id: string;
  preference_id: string;
  action: "create" | "update" | "delete" | "rollback";
  previous_json?: string;
  next_json: string;
  reason?: string;
  task_id?: string;
  email_id?: string;
  created_at: string;
}

export interface UpsertPreferenceOptions {
  scope: PreferenceScope;
  key: string;
  value: SenderPreference;
  confidence?: number;
  learnedFrom?: string;
  learnedAt?: string;
  reason?: string;
  taskId?: string;
  emailId?: string;
}

export class PreferenceRepository {
  constructor(private readonly db: Database) {}

  async upsertPreference(options: UpsertPreferenceOptions): Promise<PreferenceRecord> {
    const { scope, key, value, confidence = 0, learnedFrom, learnedAt, reason, taskId, emailId } = options;
    const now = new Date().toISOString();
    const valueJson = JSON.stringify(value);

    return this.db.transaction(async () => {
      const existing = await this.getByScopeAndKey(scope, key);

      if (existing) {
        await this.db.run(
          `UPDATE preferences 
           SET value_json = ?, confidence = ?, learned_from = ?, learned_at = ?, updated_at = ?
           WHERE id = ?`,
          [valueJson, confidence, learnedFrom, learnedAt, now, existing.id]
        );

        await this.db.run(
          `INSERT INTO preference_history 
           (id, preference_id, action, previous_json, next_json, reason, task_id, email_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            this.generateId("hist"),
            existing.id,
            "update",
            existing.value_json,
            valueJson,
            reason,
            taskId,
            emailId,
            now,
          ]
        );

        return { ...existing, value_json: valueJson, confidence, learned_from: learnedFrom, learned_at: learnedAt, updated_at: now };
      } else {
        const id = this.generateId("pref");
        await this.db.run(
          `INSERT INTO preferences 
           (id, scope, key, value_json, confidence, learned_from, learned_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, scope, key, valueJson, confidence, learnedFrom, learnedAt, now, now]
        );

        await this.db.run(
          `INSERT INTO preference_history 
           (id, preference_id, action, previous_json, next_json, reason, task_id, email_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            this.generateId("hist"),
            id,
            "create",
            null,
            valueJson,
            reason,
            taskId,
            emailId,
            now,
          ]
        );

        return {
          id,
          scope,
          key,
          value_json: valueJson,
          confidence,
          status: "active",
          learned_from: learnedFrom,
          learned_at: learnedAt,
          created_at: now,
          updated_at: now,
        };
      }
    });
  }

  async getByScopeAndKey(scope: PreferenceScope, key: string): Promise<PreferenceRecord | undefined> {
    return this.db.get<PreferenceRecord>(
      "SELECT * FROM preferences WHERE scope = ? AND key = ? AND status = 'active'",
      [scope, key]
    );
  }

  async getById(id: string): Promise<PreferenceRecord | undefined> {
    return this.db.get<PreferenceRecord>("SELECT * FROM preferences WHERE id = ?", [id]);
  }

  async getAllByScope(scope: PreferenceScope): Promise<PreferenceRecord[]> {
    return this.db.all<PreferenceRecord>(
      "SELECT * FROM preferences WHERE scope = ? AND status = 'active'",
      [scope]
    );
  }

  async getAllActive(): Promise<PreferenceRecord[]> {
    return this.db.all<PreferenceRecord>("SELECT * FROM preferences WHERE status = 'active'");
  }

  async archivePreference(id: string, reason?: string, taskId?: string): Promise<void> {
    const now = new Date().toISOString();
    
    return this.db.transaction(async () => {
      const existing = await this.getById(id);
      if (!existing) throw new Error(`Preference not found: ${id}`);

      await this.db.run(
        "UPDATE preferences SET status = 'archived', updated_at = ? WHERE id = ?",
        [now, id]
      );

      await this.db.run(
        `INSERT INTO preference_history 
         (id, preference_id, action, previous_json, next_json, reason, task_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [this.generateId("hist"), id, "delete", existing.value_json, JSON.stringify({}), reason, taskId, now]
      );
    });
  }

  async rollbackToHistory(historyId: string): Promise<{ success: boolean; message: string }> {
    const history = await this.db.get<PreferenceHistoryRecord>(
      "SELECT * FROM preference_history WHERE id = ?",
      [historyId]
    );

    if (!history) {
      return { success: false, message: `找不到历史记录 ID: ${historyId}` };
    }

    return this.db.transaction(async () => {
      const preference = await this.getById(history.preference_id);
      if (!preference) {
        return { success: false, message: `找不到偏好记录: ${history.preference_id}` };
      }

      if (history.action === "create") {
        await this.archivePreference(history.preference_id, `回滚到创建之前 (${historyId})`);
      } else if (history.action === "update") {
        if (history.previous_json) {
          await this.db.run(
            "UPDATE preferences SET value_json = ?, updated_at = ? WHERE id = ?",
            [history.previous_json, new Date().toISOString(), history.preference_id]
          );
        } else {
          await this.archivePreference(history.preference_id, `回滚到更新之前 (${historyId})`);
        }
      } else if (history.action === "delete") {
        if (history.previous_json) {
          await this.db.run(
            "UPDATE preferences SET value_json = ?, status = 'active', updated_at = ? WHERE id = ?",
            [history.previous_json, new Date().toISOString(), history.preference_id]
          );
        }
      }

      await this.db.run(
        `INSERT INTO preference_history 
         (id, preference_id, action, previous_json, next_json, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          this.generateId("hist"),
          history.preference_id,
          "rollback",
          preference.value_json,
          history.previous_json || JSON.stringify({}),
          `回滚到历史记录 ${historyId}`,
          new Date().toISOString(),
        ]
      );

      return { success: true, message: `已回滚偏好到历史记录 ${historyId}` };
    });
  }

  async getHistoryByPreferenceId(preferenceId: string): Promise<PreferenceHistoryRecord[]> {
    return this.db.all<PreferenceHistoryRecord>(
      "SELECT * FROM preference_history WHERE preference_id = ? ORDER BY created_at DESC",
      [preferenceId]
    );
  }

  async getRecentHistory(limit: number = 20): Promise<PreferenceHistoryRecord[]> {
    return this.db.all<PreferenceHistoryRecord>(
      "SELECT * FROM preference_history ORDER BY created_at DESC LIMIT ?",
      [limit]
    );
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}