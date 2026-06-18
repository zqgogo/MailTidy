import type { EmbeddingProvider } from "./schemas.js";
import { pipeline, env } from "@xenova/transformers";

/**
 * BGE-M3 Embedding Provider
 * 使用 Xenova/transformers 加载真正的 BGE-M3 模型
 * 参考：https://huggingface.co/Xenova/bge-m3
 */
export class BGEM3Embedding implements EmbeddingProvider {
  readonly provider = "bge-m3";
  readonly model = "Xenova/bge-m3";
  readonly dimensions = 1024;

  private embeddingPipeline: any = null;
  private isInitializing = false;
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    // 设置模型缓存目录
    env.cacheDir = "./models";
  }

  /**
   * 初始化模型（懒加载）
   */
  private async initialize(): Promise<void> {
    if (this.embeddingPipeline) return;
    if (this.isInitializing) {
      await this.initializationPromise;
      return;
    }

    this.isInitializing = true;
    this.initializationPromise = (async () => {
      try {
        console.log("[BGE-M3] Loading model... (首次运行会下载约 1GB 模型文件)");
        this.embeddingPipeline = await pipeline(
          "feature-extraction",
          this.model,
          {
            progress_callback: (progress: number | undefined) => {
              if (progress !== undefined && !isNaN(progress)) {
                const percentage = Math.round(progress * 100);
                if (percentage % 10 === 0) {
                  console.log(`[BGE-M3] Loading model... ${percentage}%`);
                }
              }
            },
          }
        );
        console.log("[BGE-M3] Model loaded successfully");
      } catch (error) {
        console.error("[BGE-M3] Failed to load model:", error);
        throw error;
      } finally {
        this.isInitializing = false;
      }
    })();

    await this.initializationPromise;
  }

  /**
   * 生成向量嵌入
   */
  async embed(texts: string[]): Promise<number[][]> {
    // 确保模型已初始化
    await this.initialize();

    // 处理空输入
    if (texts.length === 0) {
      return [];
    }

    // 使用 BGE-M3 的指令格式（可选但推荐）
    const inputs = texts.map((text) => `Represent this sentence for searching relevant passages: ${text}`);

    // 生成嵌入
    const output = await this.embeddingPipeline(inputs, {
      pooling: "mean",
      normalize: true,
    });

    // 转换为数字数组
    return output.tolist() as number[][];
  }

  /**
   * 获取模型状态
   */
  isLoaded(): boolean {
    return this.embeddingPipeline !== null;
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