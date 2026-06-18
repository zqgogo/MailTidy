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
  model = "Xenova/bge-m3";  // 使用 Xenova 优化版本
  dimensions = 1024;
}
```

**特点**：
- ✅ 基于 Xenova/transformers（纯 JavaScript/TypeScript）
- ✅ 首次使用自动下载模型（约 1GB）
- ✅ 懒加载，按需初始化
- ✅ 支持进度回调

**模型加载流程**：
```text
首次调用 embed()
    │
    ▼
检查模型是否已加载
    │
    ▼
未加载 → 下载模型（./models 目录）→ 初始化 pipeline
    │
    ▼
生成向量嵌入
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

---

# 16. API 参考文档

## 16.1 MemoryEngine

### 构造函数

```typescript
new MemoryEngine(databasePath: string)
```

**参数**：
- `databasePath`: SQLite 数据库文件路径

**示例**：
```typescript
const memoryEngine = new MemoryEngine("./storage/mailtidy.db");
```

### addMemory

```typescript
async addMemory(
  text: string,
  memoryType: MemoryType,
  metadata?: Record<string, unknown>,
  importance?: number
): Promise<string>
```

**参数**：
- `text`: 记忆内容（经验总结）
- `memoryType`: 记忆类型（PREFERENCE / DECISION / EMAIL_SUMMARY）
- `metadata`: 元数据（发件人、主题、操作等）
- `importance`: 重要性分数（0-1，默认 0.5）

**返回**：记忆 ID

**示例**：
```typescript
const memoryId = await memoryEngine.addMemory(
  "用户倾向归档 GitHub 通知邮件",
  MemoryType.PREFERENCE,
  { sender: "github.com", action: "archive" },
  0.8
);
```

### search

```typescript
async search(options: SearchOptions): Promise<MemorySearchResult[]>
```

**参数**：
```typescript
interface SearchOptions {
  query: string;              // 搜索查询
  memoryTypes?: MemoryType[]; // 过滤记忆类型
  topK?: number;              // 返回数量（默认 5）
  minScore?: number;          // 最小相似度（默认 0.5）
}
```

**返回**：匹配的记忆数组

**示例**：
```typescript
const results = await memoryEngine.search({
  query: "GitHub 通知邮件",
  memoryTypes: [MemoryType.PREFERENCE, MemoryType.DECISION],
  topK: 3,
  minScore: 0.6
});

// 结果示例
[
  {
    id: "mem-123",
    memoryType: "preference",
    text: "用户倾向归档 GitHub 通知邮件",
    metadata: { sender: "github.com", action: "archive" },
    importance: 0.8,
    score: 0.92,
    createdAt: "2024-01-15T10:30:00Z"
  }
]
```

### learn

```typescript
async learn(email: EmailContext, userAction: string): Promise<string>
```

**参数**：
```typescript
interface EmailContext {
  sender?: string;   // 发件人
  subject?: string;  // 邮件主题
  content?: string;  // 邮件内容
}
```

**返回**：新创建的记忆 ID

**示例**：
```typescript
const memoryId = await memoryEngine.learn({
  sender: "notifications@github.com",
  subject: "GitHub Actions Update"
}, "archive");

// 内部生成的经验："用户倾向归档来自 github.com 的邮件"
```

---

# 17. 实际应用示例

## 17.1 邮件处理流程集成

```typescript
// 收到新邮件
const email = {
  sender: "notifications@github.com",
  subject: "GitHub Actions Changelog",
  content: "GitHub Actions has been updated..."
};

// 1. 生成检索查询
const query = `${email.sender} ${email.subject}`;

// 2. 检索历史经验
const experiences = await memoryEngine.search({
  query,
  memoryTypes: [MemoryType.PREFERENCE, MemoryType.DECISION],
  topK: 3
});

// 3. 根据经验决策
if (experiences.length > 0) {
  const bestMatch = experiences[0];
  console.log(`建议操作: ${bestMatch.metadata.action}`);
  console.log(`理由: ${bestMatch.text}`);
}

// 4. 用户确认后学习
await memoryEngine.learn(email, "archive");
```

## 17.2 偏好管理

```typescript
// 添加偏好
await memoryEngine.addMemory(
  "用户认为 AWS 账单邮件很重要",
  MemoryType.PREFERENCE,
  { sender: "aws.amazon.com", action: "mark_important" },
  0.9
);

// 查询所有偏好
const preferences = await memoryEngine.search({
  query: "偏好",
  memoryTypes: [MemoryType.PREFERENCE]
});
```

---

# 18. 配置与部署

## 18.1 数据库配置

```typescript
// 默认配置
const memoryEngine = new MemoryEngine("./storage/mailtidy.db");

// 自定义路径
const memoryEngine = new MemoryEngine("/data/mailtidy/mailtidy.db");
```

## 18.2 扩展配置

```typescript
// 未来扩展：自定义 Embedding Provider
const embeddingProvider = new OpenAIEmbedding();
const memoryStore = new MemoryStore("./storage/mailtidy.db", embeddingProvider);
const memoryEngine = new MemoryEngine(memoryStore);
```

## 18.3 内存管理

```typescript
// 使用完毕后关闭连接
memoryEngine.close();
```

---

# 19. 性能优化

## 19.1 批量操作

```typescript
// 批量添加记忆
const memories = [
  { text: "记忆1", type: MemoryType.DECISION },
  { text: "记忆2", type: MemoryType.PREFERENCE },
];

for (const mem of memories) {
  await memoryEngine.addMemory(mem.text, mem.type);
}
```

## 19.2 查询优化

- 使用 `memoryTypes` 过滤减少搜索范围
- 设置合理的 `minScore` 阈值
- 限制 `topK` 返回数量

---

# 20. 安全与隐私

## 20.1 数据存储

- 所有数据存储在本地 SQLite 数据库
- 向量数据加密存储（可选）
- 支持数据库加密扩展

## 20.2 权限管理

- 文件系统级别的访问控制
- 支持 SQLite 加密扩展

---

# 附录：术语表

| 术语 | 说明 |
|------|------|
| Memory Engine | 记忆引擎，对外唯一入口 |
| Memory Store | 向量存储实现 |
| Embedding | 文本向量化表示 |
| Vector Store | 向量数据库 |
| RAG | 检索增强生成 |
| BGE-M3 | 开源 Embedding 模型 |
| sqlite-vec | SQLite 向量扩展 |
| Preference | 用户偏好 |
| Decision | 历史决策经验 |
| Email Summary | 邮件摘要 |