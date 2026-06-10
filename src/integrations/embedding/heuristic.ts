import type { EmbeddingProvider } from "./base.js";

export class HeuristicEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "heuristic" as const;
  readonly model = "heuristic";
  readonly dimensions = 384;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.generateHeuristicEmbedding(text));
  }

  private generateHeuristicEmbedding(text: string): number[] {
    const hash = this.stringHash(text);
    const embedding: number[] = [];
    
    for (let i = 0; i < this.dimensions; i++) {
      const seed = (hash * (i + 1) + i) % 10000;
      embedding.push((seed / 10000 - 0.5) * 2);
    }
    
    return embedding;
  }

  private stringHash(text: string): number {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }
}