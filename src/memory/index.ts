/**
 * Memory Engine 公共 API 导出
 */

export { MemoryEngine } from "./memory_engine.js";
export { MemoryStore } from "./memory_store.js";
export { BGEM3Embedding, OpenAIEmbedding } from "./embedding_provider.js";
export { MemoryType } from "./schemas.js";
export type { 
  MemoryItem, 
  MemoryItemRecord, 
  MemorySearchResult, 
  SearchOptions,
  EmailContext 
} from "./schemas.js";