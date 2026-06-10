# MailTidy V2 Memory Architecture

## 1. 目标

V2 的目标不是构建通用长期记忆系统。

V2 只解决三个问题：

### 1. 用户偏好学习

例如：

* GitHub 通知邮件归档
* AWS 账单邮件保留
* 银行邮件标记重要
* 招聘邮件自动忽略

---

### 2. 历史决策复用

例如：

用户过去如何处理类似邮件。

Agent 能参考历史决策。

---

### 3. 相似邮件召回

例如：

收到新邮件时：

```text
GitHub Actions Changelog
```

Agent 能找到：

```text
用户曾连续 3 次归档 GitHub 更新通知
```

从而辅助决策。

---

# 2. 总体架构

```text
MailTidy V2

┌────────────────────┐
│    Email Agent     │
└─────────┬──────────┘
          │
          ▼
┌────────────────────┐
│   Memory Engine    │
└──────┬───────┬─────┘
       │       │
       │       │
       ▼       ▼

Embedding    Vector Store

(BGE-M3)     (sqlite-vec)
```

Memory Engine 是唯一入口。

业务层永远不直接访问向量数据库。

---

# 3. 目录结构

```text
mailtidy/
├── src/
│   ├── agent/              # Email Agent 主循环
│   ├── memory/             # Memory Engine 模块
│   │   ├── index.ts        # 公共 API 导出
│   │   ├── memory_engine.ts # 核心引擎（唯一入口）
│   │   ├── memory_store.ts  # SQLite + sqlite-vec 存储
│   │   ├── embedding_provider.ts # Embedding 提供者
│   │   ├── schemas.ts       # 类型定义
│   │   └── prompts.ts       # 提示词模板
│   ├── storage/
│   │   └── mailtidy.db      # SQLite 数据库文件
│   └── config.ts            # 配置管理
```

---

# 4. Memory Type

V2 仅保留三类记忆。

```typescript
enum MemoryType {
  PREFERENCE = "preference",    // 用户偏好
  DECISION = "decision",        // 历史决策经验
  EMAIL_SUMMARY = "email_summary" // 邮件摘要
}
```

说明：

### preference

用户偏好。

示例：

```text
用户倾向归档 GitHub 通知邮件
```

---

### decision

历史决策经验。

示例：

```text
同类 AWS 账单邮件曾被标记重要
```

---

### email_summary

邮件摘要。

示例：

```text
GitHub 发布 Actions 更新通知
```

---

# 5. 数据结构

```typescript
interface MemoryItem {
  id: string;
  memoryType: MemoryType;
  text: string;
  metadata: Record<string, unknown>;
  importance: number;
  createdAt: Date;
}
```

---

metadata 示例：

```json
{
  "sender": "github.com",
  "subject": "GitHub Actions Update",
  "action": "archive"
}
```

---

# 6. 数据库存储

## memory_items

```sql
CREATE TABLE memory_items(
    id TEXT PRIMARY KEY,
    memory_type TEXT,
    text TEXT,
    metadata JSON,
    importance REAL,
    created_at DATETIME
);
```

---

## memory_vectors (sqlite-vec)

```sql
CREATE VIRTUAL TABLE memory_vectors
USING vec0(
    id TEXT PRIMARY KEY,
    embedding FLOAT[1024]
);
```

---

# 7. Embedding Provider

定义统一接口。

```typescript
interface EmbeddingProvider {
  provider: string;
  model: string;
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
```

---

默认实现：

```typescript
class BGEM3Embedding implements EmbeddingProvider {
  provider = "bge-m3";
  model = "BAAI/bge-m3";
  dimensions = 1024;
}
```

后续允许替换：

```typescript
OpenAIEmbedding()
QwenEmbedding()
JinaEmbedding()
```

无需修改业务代码。

---

# 8. Memory Engine

Memory Engine 是唯一对外入口。

```typescript
memoryEngine.addMemory()
memoryEngine.search()
memoryEngine.learn()
```

---

## addMemory

新增记忆。

```typescript
await memoryEngine.addMemory(
  "用户倾向归档 GitHub 通知邮件",
  MemoryType.PREFERENCE,
  { sender: "github.com", action: "archive" },
  0.8
);
```

---

## search

记忆召回。

```typescript
const results = await memoryEngine.search({
  query: "如何处理 GitHub 通知邮件",
  memoryTypes: [MemoryType.PREFERENCE, MemoryType.DECISION],
  topK: 5,
  minScore: 0.5
});
```

---

## learn

用户行为学习。

```typescript
await memoryEngine.learn({
  sender: "notifications@github.com",
  subject: "GitHub Actions Update",
  content: "GitHub Actions has been updated..."
}, "archive");
```

内部流程：

```text
用户行为
    │
    ▼
生成经验总结
    │
    ▼
生成 Embedding
    │
    ▼
存储到 memory_items + memory_vectors
```

---

# 9. 学习策略

不要直接存储用户点击行为。

错误：

```text
用户点击了 Archive
```

没有价值。

---

正确：

```text
用户倾向归档 GitHub 更新通知邮件
```

或者：

```text
用户认为 GitHub Changelog 邮件优先级较低
```

存储的是经验。

不是操作日志。

---

# 10. 邮件处理流程

```text
收到邮件
    │
    ▼
邮件分析
    │
    ▼
生成检索Query
    │
    ▼
Memory Recall
    │
    ▼
获得历史经验
    │
    ▼
Agent决策
    │
    ▼
用户确认
    │
    ▼
Memory Learn
```

---

# 11. V2 默认技术选型

Embedding：

```text
BAAI/bge-m3 (1024维)
```

Vector Store：

```text
sqlite-vec (vec0 虚拟表)
```

Metadata：

```text
SQLite
```

原因：

* 本地部署
* 无服务依赖
* 简单稳定
* 单用户场景足够
* 后续迁移成本低

---

# 12. 未来扩展（预留）

仅预留接口。

V2 不实现。

## 可替换 Embedding

```typescript
new BGEM3Embedding()
new OpenAIEmbedding()
new QwenEmbedding()
new JinaEmbedding()
```

---

## 可替换 Vector Store

```typescript
new SQLiteVecStore()
new QdrantStore()
new MilvusStore()
new LanceDBStore()
```

---

业务层永远只调用：

```typescript
memoryEngine.search()
memoryEngine.learn()
memoryEngine.addMemory()
```

无需感知底层变化。

---

# 13. 代码实现

## 13.1 schemas.ts - 类型定义

```typescript
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

export interface SearchOptions {
  query: string;
  memoryTypes?: MemoryType[];
  topK?: number;
  minScore?: number;
}
```

## 13.2 embedding_provider.ts - Embedding 提供者

```typescript
export class BGEM3Embedding implements EmbeddingProvider {
  readonly provider = "bge-m3";
  readonly model = "BAAI/bge-m3";
  readonly dimensions = 1024;

  async embed(texts: string[]): Promise<number[][]> {
    // 调用 BGE-M3 模型生成向量
  }
}
```

## 13.3 memory_store.ts - 向量存储

```typescript
export class MemoryStore {
  async addMemory(item: MemoryItem): Promise<string> {
    // 1. 插入 memory_items 表
    // 2. 生成 embedding
    // 3. 插入 memory_vectors 表
  }

  async search(query: string, options: SearchOptions): Promise<MemorySearchResult[]> {
    // 1. 生成查询向量
    // 2. 使用 sqlite-vec 查询
    // 3. 返回匹配结果
  }
}
```

## 13.4 memory_engine.ts - 核心引擎

```typescript
export class MemoryEngine {
  async addMemory(text: string, memoryType: MemoryType, metadata: Record<string, unknown>, importance: number): Promise<string> {
    // 调用 store 添加记忆
  }

  async search(options: SearchOptions): Promise<MemorySearchResult[]> {
    // 调用 store 搜索
  }

  async learn(email: EmailContext, userAction: string): Promise<string> {
    // 1. 生成经验总结
    // 2. 调用 addMemory 存储
  }
}
```

---

# 14. 部署与使用

## 安装依赖

```bash
npm install
npm install better-sqlite3
```

## 初始化

```typescript
import { MemoryEngine, MemoryType } from "./memory";

const memoryEngine = new MemoryEngine("./storage/mailtidy.db");
```

## 添加记忆

```typescript
await memoryEngine.addMemory(
  "用户倾向归档 GitHub 通知邮件",
  MemoryType.PREFERENCE,
  { sender: "github.com", action: "archive" }
);
```

## 搜索记忆

```typescript
const results = await memoryEngine.search({
  query: "GitHub 通知邮件",
  memoryTypes: [MemoryType.PREFERENCE],
  topK: 3
});
```

## 用户行为学习

```typescript
await memoryEngine.learn({
  sender: "notifications@github.com",
  subject: "GitHub Actions Update"
}, "archive");
```

---

# 15. 升级路径

## 从 V1 JSON 迁移

```bash
# 运行迁移命令
npm run migrate:v1-to-v2
```

迁移流程：
1. 读取 V1 memory.json
2. 转换为 V2 MemoryItem 格式
3. 生成 embedding
4. 存储到 SQLite + sqlite-vec

## 未来升级到外部向量数据库

只需替换 MemoryStore 实现：

```typescript
// 当前实现
const memoryEngine = new MemoryEngine("./storage/mailtidy.db");

// 升级到 Qdrant
const memoryEngine = new MemoryEngine(new QdrantStore({ url: "http://localhost:6333" }));
```

业务代码无需修改。