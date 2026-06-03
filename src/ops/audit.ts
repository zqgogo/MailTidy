/**
 * 审计日志系统（Phase 5.4）
 * 
 * 实现：
 *   - 审计日志记录：所有重要操作的记录
 *   - 用户偏好导出/删除接口
 *   - 加密备份功能
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type AuditAction = 
  | "email_read"
  | "email_archive"
  | "email_delete"
  | "email_star"
  | "email_label"
  | "preference_add"
  | "preference_update"
  | "preference_delete"
  | "config_update"
  | "agent_start"
  | "agent_stop"
  | "cleanup_run"
  | "backup_create"
  | "backup_restore"
  | "data_export"
  | "data_delete";

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  details: Record<string, unknown>;
  user?: string;
  ipAddress?: string;
  success: boolean;
  error?: string;
}

export interface BackupOptions {
  password?: string;
  includePreferences?: boolean;
  includeHistory?: boolean;
  includeAuditLogs?: boolean;
}

export interface ExportOptions {
  format?: "json" | "csv";
  includePreferences?: boolean;
  includeHistory?: boolean;
}

export class AuditLogger {
  private readonly stateDir: string;
  private readonly auditLogPath: string;

  constructor(stateDir: string = ".mailtidy") {
    this.stateDir = stateDir;
    this.auditLogPath = path.join(stateDir, "audit.log");
  }

  async log(action: AuditAction, details: Record<string, unknown>, success: boolean = true, error?: string): Promise<void> {
    const entry: AuditEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      action,
      details,
      success,
      error,
    };

    const line = JSON.stringify(entry) + "\n";
    
    await fs.mkdir(path.dirname(this.auditLogPath), { recursive: true });
    await fs.appendFile(this.auditLogPath, line, "utf-8");
  }

  async query(options: {
    action?: AuditAction;
    startDate?: Date;
    endDate?: Date;
    success?: boolean;
    limit?: number;
  }): Promise<AuditEntry[]> {
    const results: AuditEntry[] = [];
    const limit = options.limit ?? 100;

    try {
      const content = await fs.readFile(this.auditLogPath, "utf-8");
      const lines = content.trim().split("\n");

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as AuditEntry;
          
          // Filter by action
          if (options.action && entry.action !== options.action) continue;
          
          // Filter by date
          const entryDate = new Date(entry.timestamp);
          if (options.startDate && entryDate < options.startDate) continue;
          if (options.endDate && entryDate > options.endDate) continue;
          
          // Filter by success
          if (options.success !== undefined && entry.success !== options.success) continue;
          
          results.push(entry);
        } catch {
          // Skip invalid lines
        }
      }
    } catch {
      // File doesn't exist
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return results.slice(0, limit);
  }

  async getStats(): Promise<{
    totalEntries: number;
    byAction: Record<AuditAction, number>;
    successRate: number;
    lastActivity: string | null;
  }> {
    const stats: Record<AuditAction, number> = {} as Record<AuditAction, number>;
    let totalEntries = 0;
    let successCount = 0;
    let lastActivity: string | null = null;

    try {
      const content = await fs.readFile(this.auditLogPath, "utf-8");
      const lines = content.trim().split("\n");

      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as AuditEntry;
          totalEntries++;
          stats[entry.action] = (stats[entry.action] ?? 0) + 1;
          if (entry.success) successCount++;
          if (!lastActivity || entry.timestamp > lastActivity) {
            lastActivity = entry.timestamp;
          }
        } catch {
          // Skip invalid lines
        }
      }
    } catch {
      // File doesn't exist
    }

    return {
      totalEntries,
      byAction: stats,
      successRate: totalEntries > 0 ? successCount / totalEntries : 1,
      lastActivity,
    };
  }
}

export class DataManager {
  private readonly stateDir: string;
  private readonly auditLogger: AuditLogger;

  constructor(stateDir: string = ".mailtidy") {
    this.stateDir = stateDir;
    this.auditLogger = new AuditLogger(stateDir);
  }

  async exportPreferences(options: ExportOptions = {}): Promise<string> {
    const format = options.format ?? "json";
    const includePreferences = options.includePreferences ?? true;
    const includeHistory = options.includeHistory ?? true;

    const exportData: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      format,
    };

    if (includePreferences) {
      try {
        const prefPath = path.join(this.stateDir, "preferences.json");
        const prefContent = await fs.readFile(prefPath, "utf-8");
        exportData.preferences = JSON.parse(prefContent);
      } catch {
        exportData.preferences = {};
      }
    }

    if (includeHistory) {
      try {
        const historyPath = path.join(this.stateDir, "history.json");
        const historyContent = await fs.readFile(historyPath, "utf-8");
        exportData.history = JSON.parse(historyContent);
      } catch {
        exportData.history = [];
      }
    }

    await this.auditLogger.log("data_export", { format, includePreferences, includeHistory }, true);

    if (format === "csv") {
      return this.toCSV(exportData);
    }
    return JSON.stringify(exportData, null, 2);
  }

  private toCSV(data: Record<string, unknown>): string {
    let csv = "";
    
    if (data.preferences) {
      csv += "preferences\n";
      csv += "sender,category,weight,lastUpdated\n";
      const prefs = data.preferences as Record<string, { category: string; weight: number; lastUpdated: string }>;
      for (const [sender, pref] of Object.entries(prefs)) {
        csv += `${sender},${pref.category},${pref.weight},${pref.lastUpdated}\n`;
      }
    }
    
    if (data.history) {
      csv += "\nhistory\n";
      csv += "timestamp,sender,action,details\n";
      const history = data.history as Array<{ timestamp: string; sender: string; action: string; details: string }>;
      for (const entry of history) {
        csv += `${entry.timestamp},${entry.sender},${entry.action},"${JSON.stringify(entry.details)}"\n`;
      }
    }
    
    return csv;
  }

  async deletePreferences(sender?: string): Promise<{ deletedCount: number }> {
    let deletedCount = 0;

    // Delete preferences
    const prefPath = path.join(this.stateDir, "preferences.json");
    try {
      const prefContent = await fs.readFile(prefPath, "utf-8");
      const prefs = JSON.parse(prefContent) as Record<string, unknown>;

      if (sender) {
        if (prefs[sender]) {
          delete prefs[sender];
          deletedCount++;
        }
      } else {
        deletedCount = Object.keys(prefs).length;
        Object.keys(prefs).forEach(key => delete prefs[key]);
      }

      await fs.writeFile(prefPath, JSON.stringify(prefs, null, 2), "utf-8");
      await this.auditLogger.log("preference_delete", { sender, deletedCount }, true);
    } catch {
      // File doesn't exist
    }

    // Delete related history
    const historyPath = path.join(this.stateDir, "history.json");
    try {
      const historyContent = await fs.readFile(historyPath, "utf-8");
      let history = JSON.parse(historyContent) as Array<{ sender: string }>;

      if (sender) {
        const originalLength = history.length;
        history = history.filter(h => h.sender !== sender);
        deletedCount += originalLength - history.length;
      } else {
        deletedCount += history.length;
        history = [];
      }

      await fs.writeFile(historyPath, JSON.stringify(history, null, 2), "utf-8");
    } catch {
      // File doesn't exist
    }

    return { deletedCount };
  }

  async createBackup(options: BackupOptions = {}): Promise<string> {
    const { password, includePreferences = true, includeHistory = true, includeAuditLogs = true } = options;
    
    const backupData: Record<string, unknown> = {
      createdAt: new Date().toISOString(),
      includes: { preferences: includePreferences, history: includeHistory, auditLogs: includeAuditLogs },
    };

    if (includePreferences) {
      try {
        const prefPath = path.join(this.stateDir, "preferences.json");
        backupData.preferences = JSON.parse(await fs.readFile(prefPath, "utf-8"));
      } catch {
        backupData.preferences = {};
      }
    }

    if (includeHistory) {
      try {
        const historyPath = path.join(this.stateDir, "history.json");
        backupData.history = JSON.parse(await fs.readFile(historyPath, "utf-8"));
      } catch {
        backupData.history = [];
      }
    }

    if (includeAuditLogs) {
      try {
        const auditPath = path.join(this.stateDir, "audit.log");
        const auditContent = await fs.readFile(auditPath, "utf-8");
        backupData.auditLogs = auditContent.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
      } catch {
        backupData.auditLogs = [];
      }
    }

    const backupContent = JSON.stringify(backupData, null, 2);
    const backupFileName = `backup-${Date.now()}.mtb`;
    const backupPath = path.join(this.stateDir, "backups", backupFileName);

    await fs.mkdir(path.dirname(backupPath), { recursive: true });

    if (password) {
      const iv = crypto.randomBytes(12);
      const salt = crypto.randomBytes(16);
      const key = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");
      
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      let encrypted = cipher.update(backupContent, "utf-8", "hex");
      encrypted += cipher.final("hex");
      const authTag = cipher.getAuthTag().toString("hex");

      const encryptedData = {
        iv: iv.toString("hex"),
        salt: salt.toString("hex"),
        authTag,
        data: encrypted,
      };

      await fs.writeFile(backupPath, JSON.stringify(encryptedData), "utf-8");
    } else {
      await fs.writeFile(backupPath, backupContent, "utf-8");
    }

    await this.auditLogger.log("backup_create", { fileName: backupFileName, encrypted: !!password }, true);

    return backupPath;
  }

  async restoreBackup(backupPath: string, password?: string): Promise<{ restored: boolean; message: string }> {
    try {
      const content = await fs.readFile(backupPath, "utf-8");
      let backupData: Record<string, unknown>;

      try {
        // Try as encrypted backup
        const encrypted = JSON.parse(content);
        if (encrypted.iv && encrypted.data && password) {
          const iv = Buffer.from(encrypted.iv, "hex");
          const salt = Buffer.from(encrypted.salt, "hex");
          const authTag = Buffer.from(encrypted.authTag, "hex");
          const key = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");

          const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
          decipher.setAuthTag(authTag);
          let decrypted = decipher.update(encrypted.data, "hex", "utf-8");
          decrypted += decipher.final("utf-8");
          backupData = JSON.parse(decrypted);
        } else {
          backupData = JSON.parse(content);
        }
      } catch {
        backupData = JSON.parse(content);
      }

      // Restore preferences
      if (backupData.preferences) {
        await fs.writeFile(
          path.join(this.stateDir, "preferences.json"),
          JSON.stringify(backupData.preferences, null, 2),
          "utf-8"
        );
      }

      // Restore history
      if (backupData.history) {
        await fs.writeFile(
          path.join(this.stateDir, "history.json"),
          JSON.stringify(backupData.history, null, 2),
          "utf-8"
        );
      }

      await this.auditLogger.log("backup_restore", { backupPath }, true);

      return { restored: true, message: "Backup restored successfully" };
    } catch (error) {
      await this.auditLogger.log("backup_restore", { backupPath }, false, error instanceof Error ? error.message : "Unknown error");
      return { restored: false, message: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  async listBackups(): Promise<Array<{ fileName: string; path: string; size: number; createdAt: Date | null }>> {
    const backupsDir = path.join(this.stateDir, "backups");
    const backups: Array<{ fileName: string; path: string; size: number; createdAt: Date | null }> = [];

    try {
      const files = await fs.readdir(backupsDir);
      
      for (const file of files) {
        if (file.endsWith(".mtb")) {
          const filePath = path.join(backupsDir, file);
          const stat = await fs.stat(filePath);
          
          // Extract timestamp from filename (backup-{timestamp}.mtb)
          const match = file.match(/backup-(\d+)\.mtb/);
          const createdAt = match ? new Date(parseInt(match[1])) : null;
          
          backups.push({
            fileName: file,
            path: filePath,
            size: stat.size,
            createdAt,
          });
        }
      }

      backups.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    } catch {
      // Directory doesn't exist
    }

    return backups;
  }

  async deleteAllData(): Promise<{ deleted: boolean; message: string }> {
    try {
      const files = ["preferences.json", "history.json", "audit.log", "metrics.json"];
      
      for (const file of files) {
        const filePath = path.join(this.stateDir, file);
        await fs.unlink(filePath).catch(() => {});
      }

      // Delete backups directory
      const backupsDir = path.join(this.stateDir, "backups");
      await fs.rm(backupsDir, { recursive: true, force: true });

      await this.auditLogger.log("data_delete", {}, true);

      return { deleted: true, message: "All data deleted successfully" };
    } catch (error) {
      return { deleted: false, message: error instanceof Error ? error.message : "Unknown error" };
    }
  }
}

export function createAuditLogger(stateDir?: string): AuditLogger {
  return new AuditLogger(stateDir);
}

export function createDataManager(stateDir?: string): DataManager {
  return new DataManager(stateDir);
}