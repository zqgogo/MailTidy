/**
 * V2 架构核心类型定义
 */

export enum MemoryType {
  PREFERENCE = "preference",
  DECISION = "decision",
  EMAIL_SUMMARY = "email_summary",
}

export interface MemoryItem {
  id: string;
  memoryType: MemoryType;
  text: string;
  metadata: Record<string, unknown>;
  importance: number;
  createdAt: Date;
}

export interface MemoryItemRecord {
  id: string;
  memoryType: MemoryType;
  text: string;
  metadata: Record<string, unknown>;
  importance: number;
  createdAt: string;
}

export interface EmbeddingProvider {
  provider: string;
  model: string;
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface MemorySearchResult {
  id: string;
  memoryType: MemoryType;
  text: string;
  metadata: Record<string, unknown>;
  importance: number;
  score: number;
  createdAt: string;
}

export interface MemoryEngineConfig {
  databasePath: string;
  embeddingProvider: EmbeddingProvider;
}

export interface SearchOptions {
  query: string;
  memoryTypes?: MemoryType[];
  topK?: number;
  minScore?: number;
  metadataFilter?: Record<string, unknown>;
}

export interface EmailContext {
  sender?: string;
  subject?: string;
  content?: string;
  preference?: string;
  action?: string;
}