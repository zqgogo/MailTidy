import type { EmbeddingProvider } from "./schemas.js";

/**
 * BGE-M3 Embedding Provider
 * 参考：https://huggingface.co/BAAI/bge-m3
 */
export class BGEM3Embedding implements EmbeddingProvider {
  readonly provider = "bge-m3";
  readonly model = "BAAI/bge-m3";
  readonly dimensions = 1024;

  async embed(texts: string[]): Promise<number[][]> {
    // TODO: 集成 BGE-M3 模型
    // 当前使用启发式实现作为占位符
    // 实际实现需要调用 Hugging Face 或本地模型
    
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

/**
 * OpenAI Embedding Provider
 */
export class OpenAIEmbedding implements EmbeddingProvider {
  readonly provider = "openai";
  readonly model: string;
  readonly dimensions: number;
  private readonly apiKey: string;

  constructor(model: string = "text-embedding-3-small") {
    this.model = model;
    this.dimensions = this.getDimensions();
    this.apiKey = process.env.OPENAI_API_KEY ?? "";
  }

  private getDimensions(): number {
    const dimensions: Record<string, number> = {
      "text-embedding-3-small": 1536,
      "text-embedding-3-large": 3072,
      "text-embedding-ada-002": 1536,
    };
    return dimensions[this.model] ?? 1536;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key is required");
    }

    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        encoding_format: "float",
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    interface OpenAIEmbeddingResponse {
      data: { embedding: number[] }[];
    }
    const result = (await response.json()) as OpenAIEmbeddingResponse;
    return result.data.map((item) => item.embedding);
  }
}