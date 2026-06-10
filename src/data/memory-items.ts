import type { Database } from "./database.js";

export type MemoryItemType = "decision" | "preference_note" | "email_summary" | "style_sample" | "subscription";

export interface MemoryItemRecord {
  id: string;
  type: MemoryItemType;
  source_table?: string;
  source_id?: string;
  title?: string;
  content: string;
  metadata_json?: string;
  importance: number;
  status: "active" | "tombstoned";
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface EmbeddingRecord {
  id: string;
  memory_item_id: string;
  model: string;
  dimensions: number;
  content_hash: string;
  status: "active";
  created_at: string;
}

export interface CreateMemoryItemOptions {
  type: MemoryItemType;
  sourceTable?: string;
  sourceId?: string;
  title?: string;
  content: string;
  metadata?: Record<string, unknown>;
  importance?: number;
}

export class MemoryItemRepository {
  constructor(private readonly db: Database) {}

  async createItem(options: CreateMemoryItemOptions): Promise<MemoryItemRecord> {
    const { type, sourceTable, sourceId, title, content, metadata, importance = 0.5 } = options;
    const now = new Date().toISOString();
    const id = this.generateId("mem");
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    await this.db.run(
      `INSERT INTO memory_items 
       (id, type, source_table, source_id, title, content, metadata_json, importance, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, type, sourceTable, sourceId, title, content, metadataJson, importance, now, now]
    );

    return {
      id,
      type,
      source_table: sourceTable,
      source_id: sourceId,
      title,
      content,
      metadata_json: metadataJson ?? undefined,
      importance,
      status: "active",
      created_at: now,
      updated_at: now,
    };
  }

  async getItemById(id: string): Promise<MemoryItemRecord | undefined> {
    return this.db.get<MemoryItemRecord>("SELECT * FROM memory_items WHERE id = ?", [id]);
  }

  async getItemsBySource(sourceTable: string, sourceId: string): Promise<MemoryItemRecord[]> {
    return this.db.all<MemoryItemRecord>(
      "SELECT * FROM memory_items WHERE source_table = ? AND source_id = ? AND status = 'active'",
      [sourceTable, sourceId]
    );
  }

  async getItemsByType(type: MemoryItemType): Promise<MemoryItemRecord[]> {
    return this.db.all<MemoryItemRecord>(
      "SELECT * FROM memory_items WHERE type = ? AND status = 'active'",
      [type]
    );
  }

  async getAllActiveItems(): Promise<MemoryItemRecord[]> {
    return this.db.all<MemoryItemRecord>("SELECT * FROM memory_items WHERE status = 'active'");
  }

  async tombstoneItem(id: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      "UPDATE memory_items SET status = 'tombstoned', deleted_at = ?, updated_at = ? WHERE id = ?",
      [now, now, id]
    );
  }

  async tombstoneBySource(sourceTable: string, sourceId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      "UPDATE memory_items SET status = 'tombstoned', deleted_at = ?, updated_at = ? WHERE source_table = ? AND source_id = ?",
      [now, now, sourceTable, sourceId]
    );
  }

  async updateItem(id: string, updates: Partial<Pick<MemoryItemRecord, "title" | "content" | "metadata_json" | "importance">>): Promise<void> {
    const now = new Date().toISOString();
    const setParts: string[] = [];
    const params: unknown[] = [];

    if (updates.title !== undefined) {
      setParts.push("title = ?");
      params.push(updates.title);
    }
    if (updates.content !== undefined) {
      setParts.push("content = ?");
      params.push(updates.content);
    }
    if (updates.metadata_json !== undefined) {
      setParts.push("metadata_json = ?");
      params.push(updates.metadata_json);
    }
    if (updates.importance !== undefined) {
      setParts.push("importance = ?");
      params.push(updates.importance);
    }
    setParts.push("updated_at = ?");
    params.push(now);
    params.push(id);

    await this.db.run(
      `UPDATE memory_items SET ${setParts.join(", ")} WHERE id = ?`,
      params
    );
  }

  async createEmbedding(memoryItemId: string, model: string, dimensions: number, contentHash: string): Promise<EmbeddingRecord> {
    const now = new Date().toISOString();
    const id = this.generateId("emb");

    await this.db.run(
      `INSERT INTO embeddings 
       (id, memory_item_id, model, dimensions, content_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, memoryItemId, model, dimensions, contentHash, now]
    );

    return {
      id,
      memory_item_id: memoryItemId,
      model,
      dimensions,
      content_hash: contentHash,
      status: "active",
      created_at: now,
    };
  }

  async getEmbeddingByMemoryItemId(memoryItemId: string): Promise<EmbeddingRecord | undefined> {
    return this.db.get<EmbeddingRecord>(
      "SELECT * FROM embeddings WHERE memory_item_id = ? AND status = 'active'",
      [memoryItemId]
    );
  }

  async getEmbeddingsByModel(model: string): Promise<EmbeddingRecord[]> {
    return this.db.all<EmbeddingRecord>(
      "SELECT * FROM embeddings WHERE model = ? AND status = 'active'",
      [model]
    );
  }

  async deleteEmbedding(id: string): Promise<void> {
    await this.db.run("DELETE FROM embeddings WHERE id = ?", [id]);
  }

  async deleteEmbeddingsByMemoryItemId(memoryItemId: string): Promise<void> {
    await this.db.run("DELETE FROM embeddings WHERE memory_item_id = ?", [memoryItemId]);
  }

  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}