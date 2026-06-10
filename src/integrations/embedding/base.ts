export type EmbeddingProviderType = "heuristic" | "openai" | "local" | "tfidf";

export interface EmbeddingProvider {
  readonly provider: EmbeddingProviderType;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderType;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}