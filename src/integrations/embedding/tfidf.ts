import type { EmbeddingProvider } from "./base.js";

/**
 * TF-IDF based embedding provider
 * 更好地捕捉文本相似性，无需外部 API
 */
export class TfidfEmbeddingProvider implements EmbeddingProvider {
  readonly provider = "tfidf" as const;
  readonly model = "tfidf";
  readonly dimensions = 512; // 词汇表大小

  private vocabulary = new Map<string, number>();
  private idf = new Map<number, number>();
  private initialized = false;

  /**
   * 初始化词汇表（需要训练数据）
   */
  async initialize(trainingTexts: string[]): Promise<void> {
    // 1. 构建词汇表
    const wordCounts = new Map<string, number>();
    const docCounts = new Map<string, number>();

    for (const text of trainingTexts) {
      const words = this.tokenize(text);
      const uniqueWords = new Set(words);

      for (const word of words) {
        wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
      }

      for (const word of uniqueWords) {
        docCounts.set(word, (docCounts.get(word) ?? 0) + 1);
      }
    }

    // 2. 选择最常见的词作为词汇表
    const sortedWords = Array.from(wordCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.dimensions);

    this.vocabulary = new Map(sortedWords.map(([word, count], idx) => [word, idx]));

    // 3. 计算 IDF
    const totalDocs = trainingTexts.length;
    for (const [word, docCount] of docCounts) {
      const wordId = this.vocabulary.get(word);
      if (wordId !== undefined) {
        this.idf.set(wordId, Math.log(totalDocs / (docCount + 1)));
      }
    }

    this.initialized = true;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.initialized) {
      throw new Error("TF-IDF provider not initialized. Call initialize() first.");
    }

    return texts.map((text) => this.computeTfidf(text));
  }

  private computeTfidf(text: string): number[] {
    const words = this.tokenize(text);
    const wordCounts = new Map<string, number>();

    // 计算 TF
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }

    const embedding = new Array(this.dimensions).fill(0);
    const maxCount = Math.max(...wordCounts.values(), 1);

    // 计算 TF-IDF
    for (const [word, count] of wordCounts) {
      const wordId = this.vocabulary.get(word);
      if (wordId !== undefined) {
        const tf = count / maxCount;
        const idf = this.idf.get(wordId) ?? 1;
        embedding[wordId] = tf * idf;
      }
    }

    // 归一化
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      return embedding.map((val) => val / norm);
    }

    return embedding;
  }

  private tokenize(text: string): string[] {
    // 简单的分词：转小写，按非字母数字分割
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2); // 过滤短词
  }
}

// 测试
async function testTfidf() {
  const provider = new TfidfEmbeddingProvider();

  // 训练数据
  const trainingTexts = [
    "Archive newsletter emails from sender",
    "Archive weekly newsletter",
    "Reply to boss about project",
    "Email manager about meeting",
    "Delete spam emails",
    "Save important documents",
  ];

  await provider.initialize(trainingTexts);

  // 测试用例
  const testCases = [
    {
      name: "完全相同的文本",
      text1: "Archive newsletter emails from sender",
      text2: "Archive newsletter emails from sender",
    },
    {
      name: "语义相似但文本不同",
      text1: "Archive newsletter emails",
      text2: "Archive weekly newsletter",
    },
    {
      name: "完全不同的文本",
      text1: "Archive newsletter emails",
      text2: "Reply to boss about project",
    },
  ];

  console.log("=== TF-IDF EmbeddingProvider 测试 ===\n");

  for (const testCase of testCases) {
    const embeddings = await provider.embed([testCase.text1, testCase.text2]);
    const vec1 = embeddings[0];
    const vec2 = embeddings[1];

    if (!vec1 || !vec2) continue;

    const similarity = cosineSimilarity(vec1, vec2);

    console.log(`测试: ${testCase.name}`);
    console.log(`文本1: "${testCase.text1}"`);
    console.log(`文本2: "${testCase.text2}"`);
    console.log(`相似度: ${similarity.toFixed(4)}`);
    console.log("---\n");
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

// 运行测试
testTfidf().catch(console.error);