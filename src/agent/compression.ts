/**
 * 上下文压缩模块。
 *
 * §2.2.3 上下文分层与压缩规则在这里落实：
 *   - 事实与推断分离：摘要里标明哪些是邮件原文事实、哪些是 Agent 推断、哪些是外部来源
 *   - 保留引用索引：任何摘要结论都必须能回到 emailId / traceStepId / memoryKey
 *   - 持续压缩：当 workingSummary 超过阈值时，先压缩成阶段摘要再继续
 */

import type { EvidenceRef, WorkingContext } from "./context.js";
import type { EmailMessage, EmailJudgment } from "../data/models.js";

export interface CompressionOptions {
  /** 摘要字符数阈值，超过则触发再压缩。默认 6000。 */
  summaryThreshold?: number;
  /** 再压缩后保留的最小字符数。默认 4000。 */
  minCompressedLength?: number;
}

export interface CompressedPhase {
  phase: string;
  timestamp: string;
  summary: string;
  refs: EvidenceRef[];
}

export interface CompressionResult {
  compressed: WorkingContext;
  originalLength: number;
  compressedLength: number;
  wasCompressed: boolean;
  phases: CompressedPhase[];
}

export interface Compressor {
  compress(parts: string[], refs?: EvidenceRef[]): Promise<CompressionResult>;
  compressEmailThread(messages: EmailMessage[], judgments: EmailJudgment[]): Promise<CompressionResult>;
  recompress(existing: WorkingContext, newContent: string): Promise<CompressionResult>;
}

const DEFAULT_THRESHOLD = 6000;
const DEFAULT_MIN_LENGTH = 4000;

export class ContextCompressor implements Compressor {
  private readonly threshold: number;
  private readonly minLength: number;

  constructor(options: CompressionOptions = {}) {
    this.threshold = options.summaryThreshold ?? DEFAULT_THRESHOLD;
    this.minLength = options.minCompressedLength ?? DEFAULT_MIN_LENGTH;
  }

  async compress(parts: string[], refs: EvidenceRef[] = []): Promise<CompressionResult> {
    const combined = parts.join("\n\n");
    const phases: CompressedPhase[] = [];

    if (combined.length <= this.threshold) {
      return {
        compressed: { summary: combined, refs },
        originalLength: combined.length,
        compressedLength: combined.length,
        wasCompressed: false,
        phases: [],
      };
    }

    const compressed = this.summarizeContent(combined);
    phases.push({
      phase: "initial_compression",
      timestamp: new Date().toISOString(),
      summary: compressed,
      refs,
    });

    return {
      compressed: { summary: compressed, refs },
      originalLength: combined.length,
      compressedLength: compressed.length,
      wasCompressed: true,
      phases,
    };
  }

  async compressEmailThread(messages: EmailMessage[], judgments: EmailJudgment[]): Promise<CompressionResult> {
    const refs: EvidenceRef[] = [];
    const facts: string[] = [];
    const inferences: string[] = [];

    for (const message of messages) {
      refs.push({
        kind: "email",
        id: message.id,
        digest: this.hashString(`${message.id}:${message.subject}:${message.date}`),
      });

      facts.push(`[FACT] email:${message.id} from ${message.sender} "${message.subject}" (${message.date}): ${message.snippet}`);
    }

    const judgmentById = new Map(judgments.map((j) => [j.emailId, j]));
    for (const judgment of judgments) {
      refs.push({
        kind: "email",
        id: judgment.emailId,
        digest: this.hashString(`judgment:${judgment.emailId}:${judgment.category}`),
      });

      const sourceInfo = judgment.suggestion?.confidence
        ? ` (confidence=${judgment.suggestion.confidence.toFixed(2)})`
        : ` (confidence=${judgment.confidence.toFixed(2)})`;

      inferences.push(
        `[INFERENCE] email:${judgment.emailId} classified as ${judgment.category}${sourceInfo}: ${judgment.reason}`,
      );
    }

    const combined = [...facts, "", "--- Inferences ---", ...inferences].join("\n");
    const result = await this.compress([combined], refs);

    return {
      ...result,
      phases: [
        {
          phase: "email_thread",
          timestamp: new Date().toISOString(),
          summary: combined,
          refs,
        },
        ...result.phases,
      ],
    };
  }

  async recompress(existing: WorkingContext, newContent: string): Promise<CompressionResult> {
    const combined = `${existing.summary}\n\n--- NEW CONTENT ---\n${newContent}`;
    const allRefs = [...existing.refs];

    if (combined.length <= this.threshold) {
      return {
        compressed: { summary: combined, refs: allRefs },
        originalLength: combined.length,
        compressedLength: combined.length,
        wasCompressed: false,
        phases: [],
      };
    }

    const compressed = this.summarizeContent(combined);
    const summaryRef: EvidenceRef = {
      kind: "memory_entry",
      id: `summary:${Date.now()}`,
      digest: this.hashString(compressed),
    };
    allRefs.push(summaryRef);

    return {
      compressed: { summary: compressed, refs: allRefs },
      originalLength: combined.length,
      compressedLength: compressed.length,
      wasCompressed: true,
      phases: [
        {
          phase: "recompression",
          timestamp: new Date().toISOString(),
          summary: compressed,
          refs: allRefs,
        },
      ],
    };
  }

  private summarizeContent(content: string): string {
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    const factLines = lines.filter((line) => line.startsWith("[FACT]"));
    const inferenceLines = lines.filter((line) => line.startsWith("[INFERENCE]"));
    const otherLines = lines.filter((line) => !line.startsWith("[FACT]") && !line.startsWith("[INFERENCE]"));

    const maxFactLines = Math.min(factLines.length, Math.ceil(this.minLength / 80));
    const maxInferenceLines = Math.min(inferenceLines.length, Math.ceil(this.minLength / 100));
    const maxOtherLines = Math.min(otherLines.length, 5);

    const selectedFacts = this.selectMostRelevant(factLines, maxFactLines);
    const selectedInferences = this.selectMostRelevant(inferenceLines, maxInferenceLines);
    const selectedOthers = otherLines.slice(0, maxOtherLines);

    const summaryParts = [
      `[COMPRESSED SUMMARY - ${content.length} -> ~${this.minLength} chars]`,
      "",
      "## Key Facts",
      ...selectedFacts,
      "",
      "## Inferences",
      ...selectedInferences,
      "",
      ...(selectedOthers.length > 0 ? ["## Additional Context", ...selectedOthers] : []),
      "",
      `Source count: ${factLines.length} facts, ${inferenceLines.length} inferences.`,
    ];

    const result = summaryParts.join("\n");
    return result.length > this.minLength ? result.slice(0, this.minLength - 3) + "..." : result;
  }

  private selectMostRelevant(lines: string[], maxCount: number): string[] {
    if (lines.length <= maxCount) return lines;

    const scored = lines.map((line) => ({
      line,
      score: this.scoreLine(line),
    }));

    return scored.sort((a, b) => b.score - a.score).slice(0, maxCount).map((s) => s.line);
  }

  private scoreLine(line: string): number {
    let score = 1;

    if (line.includes("important") || line.includes("urgent")) score += 5;
    if (line.includes("actionable") || line.includes("reply")) score += 3;
    if (line.includes("high") || line.includes("risk")) score += 3;
    if (line.includes("CEO") || line.includes("boss") || line.includes("manager")) score += 2;
    if (line.includes("$") || line.includes("payment") || line.includes("charge")) score += 2;
    if (line.includes("confidence=0.") && !line.includes("confidence=0.9")) score += 1;

    return score;
  }

  private hashString(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
  }
}

export function createCompressor(options?: CompressionOptions): Compressor {
  return new ContextCompressor(options);
}