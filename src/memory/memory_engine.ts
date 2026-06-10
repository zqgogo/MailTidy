import type { MemoryItem, MemorySearchResult, SearchOptions } from "./schemas.js";
import { MemoryType } from "./schemas.js";
import { MemoryStore } from "./memory_store.js";
import { BGEM3Embedding } from "./embedding_provider.js";

/**
 * Memory Engine - 对外唯一入口
 * 
 * 提供三个核心方法：
 * - add_memory: 新增记忆
 * - search: 记忆召回
 * - learn: 用户行为学习
 */
export class MemoryEngine {
  private store: MemoryStore;

  constructor(databasePath: string) {
    // 默认使用 BGE-M3 embedding
    const embeddingProvider = new BGEM3Embedding();
    this.store = new MemoryStore(databasePath, embeddingProvider);
  }

  /**
   * 新增记忆
   */
  async addMemory(
    text: string,
    memoryType: MemoryType,
    metadata: Record<string, unknown> = {},
    importance: number = 0.5
  ): Promise<string> {
    const id = await this.store.addMemory({
      memoryType,
      text,
      metadata,
      importance,
    });
    return id;
  }

  /**
   * 记忆召回
   */
  async search(options: SearchOptions): Promise<MemorySearchResult[]> {
    const results = await this.store.search(options.query, {
      memoryTypes: options.memoryTypes,
      topK: options.topK,
      minScore: options.minScore,
    });
    return results;
  }

  /**
   * 用户行为学习
   * 
   * 内部流程：
   * 用户行为 → LLM总结 → 生成经验记忆 → Embedding → 存储
   */
  async learn(email: EmailContext, userAction: string): Promise<string> {
    // 1. 生成经验总结（模拟 LLM 总结）
    const experience = this.generateExperience(email, userAction);

    // 2. 构建元数据
    const metadata: Record<string, unknown> = {
      sender: email.sender,
      subject: email.subject,
      action: userAction,
      domain: email.sender?.split("@")[1],
    };

    // 3. 确定记忆类型
    let memoryType: MemoryType;
    if (userAction === "learn_preference") {
      memoryType = MemoryType.PREFERENCE;
    } else {
      memoryType = MemoryType.DECISION;
    }

    // 4. 存储记忆
    const id = await this.addMemory(experience, memoryType, metadata, 0.8);
    return id;
  }

  /**
   * 生成经验总结
   * 
   * 将用户行为转化为有价值的经验知识
   */
  private generateExperience(email: EmailContext, action: string): string {
    const sender = email.sender || "unknown sender";
    const domain = sender.split("@")[1] || "unknown domain";
    const subject = email.subject || "no subject";

    const experienceTemplates: Record<string, (email: EmailContext) => string> = {
      archive: () => `用户倾向归档来自 ${domain} 的邮件`,
      delete: () => `用户倾向删除来自 ${domain} 的邮件`,
      mark_important: () => `用户认为来自 ${domain} 的邮件很重要`,
      mark_unimportant: () => `用户认为来自 ${domain} 的邮件优先级较低`,
      read: () => `用户已阅读来自 ${sender} 的邮件`,
      reply: () => `用户回复了来自 ${sender} 的邮件`,
      learn_preference: () => `用户偏好：${email.preference}`,
    };

    const template = experienceTemplates[action];
    if (template) {
      return template(email);
    }

    // 默认：基于主题生成经验
    return `用户对主题为"${subject}"的邮件执行了 ${action} 操作`;
  }

  /**
   * 关闭连接
   */
  close(): void {
    this.store.close();
  }
}

/**
 * 邮件上下文接口
 */
export interface EmailContext {
  sender?: string;
  subject?: string;
  content?: string;
  preference?: string;
  action?: string;
}