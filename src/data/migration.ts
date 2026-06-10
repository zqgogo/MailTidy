import { promises as fs } from "node:fs";
import path from "node:path";
import type { Database } from "./database.js";
import type { AgentMemory, SenderPreference } from "./memory.js";
import { PreferenceRepository, type PreferenceScope } from "./preferences.js";

export interface MigrationResult {
  migratedPreferences: number;
  migratedHistory: number;
  migratedActionPreferences: number;
  migratedStyleProfile: boolean;
  migratedSubscriptions: number;
  errors: string[];
}

export async function migrateFromJson(db: Database, memoryJsonPath: string): Promise<MigrationResult> {
  const result: MigrationResult = {
    migratedPreferences: 0,
    migratedHistory: 0,
    migratedActionPreferences: 0,
    migratedStyleProfile: false,
    migratedSubscriptions: 0,
    errors: [],
  };

  try {
    const raw = await fs.readFile(memoryJsonPath, "utf-8");
    const memory = JSON.parse(raw) as AgentMemory;

    const preferenceRepo = new PreferenceRepository(db);

    for (const [sender, preference] of Object.entries(memory.senderPreferences)) {
      try {
        await preferenceRepo.upsertPreference({
          scope: "sender",
          key: sender.toLowerCase(),
          value: preference,
          confidence: preference.importanceDelta ? Math.min(Math.abs(preference.importanceDelta) / 5, 0.9) : 0.5,
          learnedFrom: preference.learnedFrom,
          learnedAt: preference.learnedAt,
          reason: "Migrated from memory.json",
        });
        result.migratedPreferences++;
      } catch (err) {
        result.errors.push(`Failed to migrate preference for ${sender}: ${(err as Error).message}`);
      }
    }

    for (const actionKey of Object.keys(memory.actionPreferences)) {
      try {
        const value = memory.actionPreferences[actionKey];
        await preferenceRepo.upsertPreference({
          scope: "action",
          key: actionKey,
          value: { importanceDelta: 0, ignoredCount: 0, preferredAction: value },
          confidence: 0.5,
          reason: "Migrated action preference from memory.json",
        });
        result.migratedActionPreferences++;
      } catch (err) {
        result.errors.push(`Failed to migrate action preference ${actionKey}: ${(err as Error).message}`);
      }
    }

    if (memory.styleProfile) {
      try {
        await preferenceRepo.upsertPreference({
          scope: "style",
          key: "default",
          value: { importanceDelta: 0, ignoredCount: 0 },
          confidence: 0.5,
          reason: "Migrated style profile from memory.json",
        });
        result.migratedStyleProfile = true;
      } catch (err) {
        result.errors.push(`Failed to migrate style profile: ${(err as Error).message}`);
      }
    }

    for (const subscription of memory.subscriptionHistory) {
      try {
        await preferenceRepo.upsertPreference({
          scope: "category",
          key: "subscriptions",
          value: { importanceDelta: 0, ignoredCount: 0 },
          confidence: 0.5,
          reason: "Migrated subscription history from memory.json",
        });
        result.migratedSubscriptions++;
      } catch (err) {
        result.errors.push(`Failed to migrate subscription: ${(err as Error).message}`);
      }
    }

    for (const historyEntry of memory.preferenceHistory) {
      try {
        const existingPref = await preferenceRepo.getByScopeAndKey("sender", historyEntry.sender);
        if (existingPref) {
          const now = new Date().toISOString();
          await db.run(
            `INSERT INTO preference_history 
             (id, preference_id, action, previous_json, next_json, reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              historyEntry.id,
              existingPref.id,
              historyEntry.actionType,
              historyEntry.previousPreference ? JSON.stringify(historyEntry.previousPreference) : null,
              JSON.stringify(historyEntry.newPreference),
              historyEntry.reason,
              historyEntry.timestamp,
            ]
          );
          result.migratedHistory++;
        }
      } catch (err) {
        result.errors.push(`Failed to migrate history entry ${historyEntry.id}: ${(err as Error).message}`);
      }
    }

  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      result.errors.push("memory.json not found, skipping migration");
    } else {
      result.errors.push(`Migration failed: ${(err as Error).message}`);
    }
  }

  return result;
}

export async function checkMigrationNeeded(db: Database, memoryJsonPath: string): Promise<boolean> {
  try {
    await fs.access(memoryJsonPath);
    const prefCount = await db.get<{ count: number }>("SELECT COUNT(*) as count FROM preferences");
    return (prefCount?.count ?? 0) === 0;
  } catch {
    return false;
  }
}