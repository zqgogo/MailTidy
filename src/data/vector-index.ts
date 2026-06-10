import type { Database } from "./database.js";
import { MemoryItemRepository } from "./memory-items.js";
import type { MemoryItemRecord, MemoryItemType } from "./memory-items.js";
import type { EmbeddingProvider } from "../integrations/embedding/base.js";

export interface SemanticMemoryQuery {
  query: string;
  types?: MemoryItemType[];
  limit?: number;
  minScore?: number;
  sender?: string;
  domain?: string;
  since?: string;
}

export interface SemanticMemoryMatch {
  memoryItemId: string;
  type: MemoryItemType;
  score: number;
  title?: string;
  summary: string;
  sourceTable?: string;
  sourceId?: string;
  metadata: Record<string, unknown>;
}

export interface MemoryIndex {
  upsert(items: MemoryItemRecord[]): Promise<void>;
  search(query: SemanticMemoryQuery): Promise<SemanticMemoryMatch[]>;
  deleteBySource(source: { table: string; id: string }): Promise<void>;
  tombstoneByScope(scope: string, key: string): Promise<void>;
  rebuild(options?: { model?: string; batchSize?: number }): Promise<void>;
}

export class SimpleMemoryIndex implements MemoryIndex {
  private readonly memoryItemRepo: MemoryItemRepository;
  private readonly embeddingProvider: EmbeddingProvider;
  private readonly db: Database;
  private embeddingsCache = new Map<string, number[]>();

  constructor(db: Database, embeddingProvider: EmbeddingProvider) {
    this.db = db;
    this.memoryItemRepo = new MemoryItemRepository(db);
    this.embeddingProvider = embeddingProvider;
  }

  async upsert(items: MemoryItemRecord[]): Promise<void> {
    const texts = items.map((item) => item.content);
    const embeddings = await this.embeddingProvider.embed(texts);

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;
      
      const embedding = embeddings[i];
      if (!embedding) continue;
      
      this.embeddingsCache.set(item.id, embedding);
      
      await this.memoryItemRepo.createEmbedding(
        item.id,
        this.embeddingProvider.model,
        this.embeddingProvider.dimensions,
        this.hashContent(item.content)
      );
    }
  }

  async search(query: SemanticMemoryQuery): Promise<SemanticMemoryMatch[]> {
    const queryEmbedding = await this.embeddingProvider.embed([query.query]);
    const queryVec = queryEmbedding[0] as number[];

    const items = await this.memoryItemRepo.getAllActiveItems();

    const filteredItems = query.types
      ? items.filter((item) => query.types!.includes(item.type))
      : items;

    const matches: { item: MemoryItemRecord; score: number }[] = [];

    for (const item of filteredItems) {
      let itemEmbedding = this.embeddingsCache.get(item.id);
      
      if (!itemEmbedding) {
        try {
          const embeddings = await this.embeddingProvider.embed([item.content]);
          itemEmbedding = embeddings[0] ?? undefined;
          if (itemEmbedding) {
            this.embeddingsCache.set(item.id, itemEmbedding);
          }
        } catch {
          continue;
        }
      }

      if (!itemEmbedding) continue;

      const score = this.cosineSimilarity(queryVec, itemEmbedding);
      
      if ((query.minScore ?? 0) <= score) {
        matches.push({ item, score });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    
    const limit = query.limit ?? 8;
    return matches.slice(0, limit).map(({ item, score }) => ({
      memoryItemId: item.id,
      type: item.type,
      score,
      title: item.title,
      summary: item.content.substring(0, 200) + (item.content.length > 200 ? "..." : ""),
      sourceTable: item.source_table,
      sourceId: item.source_id,
      metadata: item.metadata_json ? JSON.parse(item.metadata_json) : {},
    }));
  }

  async deleteBySource(source: { table: string; id: string }): Promise<void> {
    const items = await this.memoryItemRepo.getItemsBySource(source.table, source.id);
    for (const item of items) {
      await this.memoryItemRepo.tombstoneItem(item.id);
      this.embeddingsCache.delete(item.id);
      await this.memoryItemRepo.deleteEmbeddingsByMemoryItemId(item.id);
    }
  }

  async tombstoneByScope(scope: string, key: string): Promise<void> {
    const items = await this.memoryItemRepo.getAllActiveItems();
    
    for (const item of items) {
      if (item.type === "preference_note" && item.source_table === "preferences") {
        const metadata = item.metadata_json ? JSON.parse(item.metadata_json) : {};
        const metaScope = metadata.scope as string | undefined;
        const metaKey = metadata.key as string | undefined;
        if (metaScope === scope && metaKey === key) {
          await this.memoryItemRepo.tombstoneItem(item.id);
          this.embeddingsCache.delete(item.id);
          await this.memoryItemRepo.deleteEmbeddingsByMemoryItemId(item.id);
        }
      }
    }
  }

  async rebuild(options?: { model?: string; batchSize?: number }): Promise<void> {
    const batchSize = options?.batchSize ?? 50;
    const items = await this.memoryItemRepo.getAllActiveItems();

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await this.upsert(batch);
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    
    const minLength = Math.min(a.length, b.length);
    for (let i = 0; i < minLength; i++) {
      const ai = a[i] ?? 0;
      const bi = b[i] ?? 0;
      dot += ai * bi;
      magA += ai * ai;
      magB += bi * bi;
    }
    
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  private hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) - hash) + content.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}