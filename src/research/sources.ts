/**
 * 可信来源：管理研究型分析的可信来源。
 *
 * Phase 3.3 实现：
 *   - TrustedSources 管理可信来源列表
 *   - 支持来源权重和可信度评分
 *   - 支持动态更新和持久化
 */

import { promises as fs } from "node:fs";
import path from "node:path";

export interface TrustedSource {
  domain: string;
  name: string;
  weight: number;
  addedAt: string;
  lastVerified?: string;
  notes?: string;
}

export interface SourceVerification {
  domain: string;
  isTrusted: boolean;
  confidence: number;
  reasons: string[];
}

export class TrustedSources {
  private sources: Map<string, TrustedSource> = new Map();
  private readonly filePath: string;

  constructor(stateDir: string = ".mailtidy") {
    this.filePath = path.join(stateDir, "trusted-sources.jsonl");
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const lines = raw.trim().split("\n").filter(Boolean);

      for (const line of lines) {
        try {
          const source = JSON.parse(line) as TrustedSource;
          this.sources.set(source.domain, source);
        } catch {
          // Skip invalid lines
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        throw err;
      }
    }
  }

  async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    const lines = Array.from(this.sources.values()).map((s) => JSON.stringify(s));
    await fs.writeFile(this.filePath, lines.join("\n") + "\n", "utf-8");
  }

  add(source: Omit<TrustedSource, "addedAt">): void {
    const now = new Date().toISOString();
    this.sources.set(source.domain, {
      ...source,
      addedAt: now,
    });
  }

  remove(domain: string): boolean {
    return this.sources.delete(domain);
  }

  get(domain: string): TrustedSource | undefined {
    return this.sources.get(domain);
  }

  getAll(): TrustedSource[] {
    return Array.from(this.sources.values()).sort((a, b) => b.weight - a.weight);
  }

  isTrusted(domain: string): boolean {
    return this.sources.has(domain);
  }

  getWeight(domain: string): number {
    return this.sources.get(domain)?.weight ?? 0;
  }

  verify(domain: string, confidence: number, reasons: string[]): SourceVerification {
    const source = this.sources.get(domain);
    const isTrusted = source !== undefined;

    return {
      domain,
      isTrusted,
      confidence: isTrusted ? Math.max(confidence, source.weight) : confidence,
      reasons: isTrusted
        ? [`Domain is in trusted sources (weight: ${source.weight})`, ...reasons]
        : reasons,
    };
  }

  async updateWeight(domain: string, weight: number): Promise<boolean> {
    const source = this.sources.get(domain);
    if (!source) return false;

    source.weight = weight;
    source.lastVerified = new Date().toISOString();
    return true;
  }

  async bulkAdd(sources: Omit<TrustedSource, "addedAt">[]): Promise<void> {
    const now = new Date().toISOString();

    for (const source of sources) {
      this.sources.set(source.domain, {
        ...source,
        addedAt: now,
      });
    }
  }

  getTopSources(limit: number = 10): TrustedSource[] {
    return this.getAll().slice(0, limit);
  }

  getStats(): {
    total: number;
    highWeight: number;
    mediumWeight: number;
    lowWeight: number;
  } {
    const sources = this.getAll();

    return {
      total: sources.length,
      highWeight: sources.filter((s) => s.weight >= 0.8).length,
      mediumWeight: sources.filter((s) => s.weight >= 0.5 && s.weight < 0.8).length,
      lowWeight: sources.filter((s) => s.weight < 0.5).length,
    };
  }
}

export function createTrustedSources(stateDir?: string): TrustedSources {
  const sources = new TrustedSources(stateDir);
  sources.load().catch(() => {
    // Ignore load errors
  });
  return sources;
}