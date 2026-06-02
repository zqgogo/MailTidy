/**
 * 拒绝建议记录：跟踪用户拒绝的建议，30 天内不再重复浮出。
 *
 * Phase 2.5 "少即是多"约束实现：
 *   - 记录被拒绝的建议 ID 和时间
 *   - 扫描时过滤掉 30 天内被拒绝的建议
 *   - 定期清理过期记录
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export interface RejectedProposal {
  id: string;
  notificationId: string;
  sender?: string;
  suggestedAction?: string;
  rejectedAt: string;
  expiresAt: string;
}

export interface RejectedProposalStore {
  add(proposal: Omit<RejectedProposal, "id" | "expiresAt">): Promise<string>;
  isRejected(notificationId: string): Promise<boolean>;
  isRejectedBySender(sender: string): Promise<boolean>;
  cleanup(): Promise<number>;
  getAll(): Promise<RejectedProposal[]>;
  clear(): Promise<void>;
}

const EXPIRY_DAYS = 30;

export class FileRejectedProposalStore implements RejectedProposalStore {
  constructor(private readonly filePath: string) {}

  async add(proposal: Omit<RejectedProposal, "id" | "expiresAt">): Promise<string> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const rejected: RejectedProposal = {
      ...proposal,
      id: `rejected_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      expiresAt: expiresAt.toISOString(),
    };

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const line = JSON.stringify(rejected) + "\n";
    await fs.appendFile(this.filePath, line, "utf-8");

    return rejected.id;
  }

  async isRejected(notificationId: string): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const now = new Date().toISOString();

      for (const line of lines) {
        const entry: RejectedProposal = JSON.parse(line);
        if (entry.notificationId === notificationId && entry.expiresAt > now) {
          return true;
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return false;
  }

  async isRejectedBySender(sender: string): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const now = new Date().toISOString();

      for (const line of lines) {
        const entry: RejectedProposal = JSON.parse(line);
        if (entry.sender?.toLowerCase() === sender.toLowerCase() && entry.expiresAt > now) {
          return true;
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return false;
  }

  async cleanup(): Promise<number> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      const now = new Date().toISOString();

      const validLines: string[] = [];
      let removedCount = 0;

      for (const line of lines) {
        const entry: RejectedProposal = JSON.parse(line);
        if (entry.expiresAt > now) {
          validLines.push(line);
        } else {
          removedCount++;
        }
      }

      if (removedCount > 0) {
        await fs.writeFile(this.filePath, validLines.join("\n") + "\n", "utf-8");
      }

      return removedCount;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      return 0;
    }
  }

  async getAll(): Promise<RejectedProposal[]> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);
      return lines.map((line) => JSON.parse(line));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      return [];
    }
  }

  async clear(): Promise<void> {
    try {
      await fs.unlink(this.filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

export function createRejectedProposalStore(stateDir: string = ".mailtidy"): FileRejectedProposalStore {
  const filePath = path.join(stateDir, "rejected-proposals.jsonl");
  return new FileRejectedProposalStore(filePath);
}