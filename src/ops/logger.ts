/**
 * 日志系统（Phase 5.3）
 * 
 * 实现：
 *   - 结构化日志记录
 *   - 日志分级：debug/info/warn/error
 *   - 日志轮转策略
 *   - 日志查询功能
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: Record<string, unknown>;
  error?: Error;
}

export interface LogOptions {
  stateDir?: string;
  level?: LogLevel;
  maxFileSizeBytes?: number;
  maxFiles?: number;
}

const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

export class Logger {
  private readonly stateDir: string;
  private readonly level: LogLevel;
  private readonly maxFileSizeBytes: number;
  private readonly maxFiles: number;
  private currentFileSize = 0;
  private currentFileIndex = 0;

  constructor(options: LogOptions = {}) {
    this.stateDir = options.stateDir ?? ".mailtidy";
    this.level = options.level ?? "info";
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? 10 * 1024 * 1024; // 10MB
    this.maxFiles = options.maxFiles ?? 5;
  }

  private getLogFilePath(index: number = 0): string {
    const fileName = index === 0 ? "mailtidy.log" : `mailtidy.${index}.log`;
    return path.join(this.stateDir, "logs", fileName);
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(this.level);
  }

  private async rotateLog(): Promise<void> {
    try {
      // Remove oldest file if we've reached max files
      const oldestPath = this.getLogFilePath(this.maxFiles);
      await fs.unlink(oldestPath).catch(() => {});

      // Rotate existing files
      for (let i = this.maxFiles - 1; i > 0; i--) {
        const src = this.getLogFilePath(i - 1);
        const dest = this.getLogFilePath(i);
        await fs.rename(src, dest).catch(() => {});
      }

      // Reset current file
      this.currentFileSize = 0;
      await fs.writeFile(this.getLogFilePath(), "", "utf-8");
    } catch {
      // Ignore rotation errors
    }
  }

  async log(level: LogLevel, category: string, message: string, data?: Record<string, unknown>): Promise<void> {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      data,
    };

    const line = JSON.stringify(entry) + "\n";
    const lineSize = Buffer.byteLength(line, "utf-8");

    // Check if we need to rotate
    if (this.currentFileSize + lineSize > this.maxFileSizeBytes) {
      await this.rotateLog();
    }

    await fs.mkdir(path.dirname(this.getLogFilePath()), { recursive: true });
    await fs.appendFile(this.getLogFilePath(), line, "utf-8");
    this.currentFileSize += lineSize;

    // Also log to console for critical levels
    if (level === "error" || level === "warn") {
      const color = level === "error" ? "\x1b[31m" : "\x1b[33m";
      console.log(`${color}[${level.toUpperCase()}] ${category}: ${message}\x1b[0m`);
    }
  }

  async debug(category: string, message: string, data?: Record<string, unknown>): Promise<void> {
    await this.log("debug", category, message, data);
  }

  async info(category: string, message: string, data?: Record<string, unknown>): Promise<void> {
    await this.log("info", category, message, data);
  }

  async warn(category: string, message: string, data?: Record<string, unknown>): Promise<void> {
    await this.log("warn", category, message, data);
  }

  async error(category: string, message: string, error?: Error, data?: Record<string, unknown>): Promise<void> {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "error",
      category,
      message,
      data: { ...data, error: error?.message, stack: error?.stack },
      error,
    };

    const line = JSON.stringify(entry) + "\n";
    await fs.mkdir(path.dirname(this.getLogFilePath()), { recursive: true });
    await fs.appendFile(this.getLogFilePath(), line, "utf-8");

    console.error(`\x1b[31m[ERROR] ${category}: ${message}\x1b[0m`);
    if (error) {
      console.error(error.stack);
    }
  }

  async query(options: {
    level?: LogLevel;
    category?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }): Promise<LogEntry[]> {
    const results: LogEntry[] = [];
    const limit = options.limit ?? 100;

    for (let i = 0; i <= this.maxFiles; i++) {
      try {
        const filePath = this.getLogFilePath(i);
        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.trim().split("\n");

        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as LogEntry;
            
            // Filter by level
            if (options.level && entry.level !== options.level) continue;
            
            // Filter by category
            if (options.category && !entry.category.includes(options.category)) continue;
            
            // Filter by date
            const entryDate = new Date(entry.timestamp);
            if (options.startDate && entryDate < options.startDate) continue;
            if (options.endDate && entryDate > options.endDate) continue;
            
            results.push(entry);
          } catch {
            // Skip invalid lines
          }
        }
      } catch {
        // File doesn't exist
        break;
      }
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    return results.slice(0, limit);
  }

  async getStats(): Promise<{
    totalEntries: number;
    byLevel: Record<LogLevel, number>;
    byCategory: Record<string, number>;
    fileCount: number;
    totalSizeBytes: number;
  }> {
    const stats = {
      totalEntries: 0,
      byLevel: { debug: 0, info: 0, warn: 0, error: 0 },
      byCategory: {},
      fileCount: 0,
      totalSizeBytes: 0,
    };

    for (let i = 0; i <= this.maxFiles; i++) {
      try {
        const filePath = this.getLogFilePath(i);
        const stat = await fs.stat(filePath);
        stats.fileCount++;
        stats.totalSizeBytes += stat.size;

        const content = await fs.readFile(filePath, "utf-8");
        const lines = content.trim().split("\n");
        
        for (const line of lines) {
          try {
            const entry = JSON.parse(line) as LogEntry;
            stats.totalEntries++;
            stats.byLevel[entry.level]++;
            stats.byCategory[entry.category] = (stats.byCategory[entry.category] ?? 0) + 1;
          } catch {
            // Skip invalid lines
          }
        }
      } catch {
        // File doesn't exist
        break;
      }
    }

    return stats;
  }

  async clear(): Promise<void> {
    for (let i = 0; i <= this.maxFiles; i++) {
      await fs.unlink(this.getLogFilePath(i)).catch(() => {});
    }
    this.currentFileSize = 0;
  }
}

export function createLogger(options?: LogOptions): Logger {
  return new Logger(options);
}