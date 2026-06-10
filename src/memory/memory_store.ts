import type { MemoryItem, MemoryItemRecord, MemorySearchResult, MemoryType } from "./schemas.js";
import type { EmbeddingProvider } from "./schemas.js";

// 使用 any 类型避免 better-sqlite3 类型声明问题
type SqliteDatabase = any;

/**
 * Memory Store - 基于 sqlite-vec 的向量存储实现
 */
export class MemoryStore {
  private db: SqliteDatabase;
  private embeddingProvider: EmbeddingProvider;

  constructor(databasePath: string, embeddingProvider: EmbeddingProvider) {
    // 动态导入
    const sqlite = require("better-sqlite3");
    this.db = new sqlite(databasePath);
    this.embeddingProvider = embeddingProvider;
    this.initialize();
  }

  private initialize(): void {
    // 确保 sqlite-vec 扩展加载
    try {
      this.db.loadExtension("vec0");
    } catch {
      // 如果扩展不可用，使用纯 SQLite 回退
      console.warn("sqlite-vec extension not available, using fallback mode");
    }

    // 创建 memory_items 表
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_items (
        id TEXT PRIMARY KEY,
        memory_type TEXT NOT NULL,
        text TEXT NOT NULL,
        metadata TEXT NOT NULL,
        importance REAL DEFAULT 0.5,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 创建向量存储表（使用 sqlite-vec）
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_vectors 
        USING vec0(
          id TEXT PRIMARY KEY,
          embedding FLOAT[${this.embeddingProvider.dimensions}]
        )
      `);
    } catch {
      // 回退到普通表存储向量
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS memory_vectors (
          id TEXT PRIMARY KEY,
          embedding BLOB
        )
      `);
    }
  }

  async addMemory(item: Omit<MemoryItem, "id" | "createdAt">): Promise<string> {
    const id = `mem-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();

    // 插入元数据
    this.db.prepare(`
      INSERT INTO memory_items (id, memory_type, text, metadata, importance, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      id,
      item.memoryType,
      item.text,
      JSON.stringify(item.metadata),
      item.importance,
      now
    );

    // 生成并存储向量
    const embeddings = await this.embeddingProvider.embed([item.text]);
    const embedding = embeddings[0];

    try {
      // 尝试使用 sqlite-vec 插入
      this.db.prepare(`
        INSERT INTO memory_vectors (id, embedding)
        VALUES (?, ?)
      `).run(id, JSON.stringify(embedding));
    } catch {
      // 回退方式：存储为 BLOB
      this.db.prepare(`
        INSERT INTO memory_vectors (id, embedding)
        VALUES (?, ?)
      `).run(id, Buffer.from(JSON.stringify(embedding)));
    }

    return id;
  }

  async search(
    query: string,
    options: {
      memoryTypes?: MemoryType[];
      topK?: number;
      minScore?: number;
    } = {}
  ): Promise<MemorySearchResult[]> {
    const topK = options.topK ?? 5;
    const minScore = options.minScore ?? 0.5;

    // 生成查询向量
    const queryEmbedding = await this.embeddingProvider.embed([query]);
    const queryVec = queryEmbedding[0];

    try {
      // 尝试使用 sqlite-vec 搜索
      const results = this.db.prepare(`
        SELECT 
          mi.id,
          mi.memory_type as memoryType,
          mi.text,
          mi.metadata,
          mi.importance,
          mi.created_at as createdAt,
          vec_distance(mv.embedding, ?) as distance
        FROM memory_items mi
        JOIN memory_vectors mv ON mi.id = mv.id
        WHERE mi.memory_type IN (${options.memoryTypes?.map(() => "?").join(",")}${!options.memoryTypes ? "" : " OR 1=1"})
        ORDER BY distance ASC
        LIMIT ?
      `).all(
        JSON.stringify(queryVec),
        ...(options.memoryTypes || []),
        topK
      );

      return results.map((row: any) => ({
        id: row.id,
        memoryType: row.memoryType as MemoryType,
        text: row.text,
        metadata: JSON.parse(row.metadata),
        importance: row.importance,
        score: 1 - row.distance, // 转换为相似度分数
        createdAt: row.createdAt,
      })).filter((r: MemorySearchResult) => r.score >= minScore);
    } catch {
      // 回退：使用余弦相似度计算
      const items = this.db.prepare(`
        SELECT * FROM memory_items
        WHERE ${options.memoryTypes ? `memory_type IN (${options.memoryTypes.map(() => "?").join(",")})` : "1=1"}
      `).all(...(options.memoryTypes || []));

      const results: { item: MemoryItemRecord; score: number }[] = [];

      for (const item of items as MemoryItemRecord[]) {
        // 获取向量
        const vectorRow = this.db.prepare(`
          SELECT embedding FROM memory_vectors WHERE id = ?
        `).get(item.id);

        if (!vectorRow) continue;

        let storedEmbedding: number[];
        try {
          storedEmbedding = JSON.parse(Buffer.isBuffer(vectorRow.embedding) 
            ? vectorRow.embedding.toString() 
            : vectorRow.embedding);
        } catch {
          continue;
        }

        // 计算余弦相似度
        if (!queryVec) continue;
        const score = this.cosineSimilarity(queryVec, storedEmbedding);
        if (score >= minScore) {
          results.push({ item, score });
        }
      }

      // 排序并返回
      return results
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((r) => ({
          id: r.item.id,
          memoryType: r.item.memoryType as MemoryType,
          text: r.item.text,
          metadata: r.item.metadata,
          importance: r.item.importance,
          score: r.score,
          createdAt: r.item.createdAt,
        }));
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dot += ai * bi;
      normA += ai * ai;
      normB += bi * bi;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dot / denominator;
  }

  close(): void {
    this.db.close();
  }
}