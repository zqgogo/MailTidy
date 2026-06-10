import type { EmbeddingProvider, EmbeddingProviderConfig } from "./base.js";

interface OpenAIEmbeddingResponse {
  data: { embedding: number[] }[];
}

interface OpenAIError {
  error?: { message: string };
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "openai" as const;
  readonly model: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: EmbeddingProviderConfig) {
    this.model = config.model ?? "text-embedding-3-small";
    this.dimensions = this.getDimensionsForModel(this.model);
    this.apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.baseUrl = config.baseUrl ?? "https://api.openai.com";
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key is required");
    }

    const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
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
      const error = (await response.json()) as OpenAIError;
      throw new Error(`OpenAI API error: ${error.error?.message || response.statusText}`);
    }

    const result = (await response.json()) as OpenAIEmbeddingResponse;
    return result.data.map((item) => item.embedding);
  }

  private getDimensionsForModel(model: string): number {
    const modelDimensions: Record<string, number> = {
      "text-embedding-3-small": 1536,
      "text-embedding-3-large": 3072,
      "text-embedding-ada-002": 1536,
    };
    return modelDimensions[model] ?? 1536;
  }
}