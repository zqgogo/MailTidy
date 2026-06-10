# MailTidy Agent Design V2

> V2 的核心变化：把 V1 的 JSON 文件记忆升级为本地 SQLite 权威数据层，并引入向量索引和 RAG 作为语义记忆系统。
> SQLite 保存事实、状态、审计和回滚；向量索引保存可重建的语义召回；JSON 只保留轻量配置。

## 目录

- 一、V2 目标
- 二、V1 到 V2 的核心变化
- 三、存储架构
- 四、SQLite 数据模型
- 五、RAG 记忆系统
- 六、持续学习流程
- 七、Agent 查询路径
- 八、配置文件
- 九、代码改造计划
- 十、迁移方案
- 十一、验收标准
- 十二、本次修改总结

---

## 一、V2 目标

V1 已经具备 Agent 主循环、工具注册、任务恢复、学习提议、偏好回滚和本地 JSON 记忆。V2 不推翻这些能力，而是把记忆系统升级为更适合长期使用的形态：

1. **本地轻量数据库**：使用 SQLite 保存任务、决策日志、偏好、学习历史、报告索引、pending 队列等权威状态。
2. **RAG 语义记忆**：使用 embedding 模型把历史决策、邮件摘要、偏好说明、写作样例向量化，支持“找类似经验”。
3. **JSON 只做配置**：模型选择、预算、自动化模式、邮箱连接器参数等继续放 JSON，方便用户手动编辑。
4. **可审计、可回滚**：所有会影响未来行为的学习结果必须有来源、时间、历史版本和回滚路径。
5. **向量索引可重建**：向量库不是事实来源，删除或损坏后可以从 SQLite 的 `memory_items` 重建。

一句话：**V2 的记忆系统是 SQLite structured memory + vector semantic memory + JSON runtime config。**

---

## 二、V1 到 V2 的核心变化

| 模块 | V1 | V2 |
| --- | --- | --- |
| Agent Memory | `.mailtidy/memory.json` 保存 `AgentMemory` | SQLite `preferences` / `preference_history` / `memory_items` 保存权威记忆 |
| 决策日志 | JSONL `decision-logs` | SQLite `decision_logs`，保留查询索引 |
| 任务记录 | `.mailtidy/tasks/<taskId>.json` | SQLite `tasks`，checkpoint 可逐步迁入 |
| 报告 | Markdown 文件为主 | Markdown 文件继续保留，SQLite 存 report index / summary |
| 学习 | `LearningEngine` 输出更新，部分路径直接写 memory | 所有学习先写 `decision_logs`，再写 `preferences` 和 `preference_history` |
| 语义召回 | 无，主要精确查 sender/action | 新增 `semantic_recall_memory`，用向量模型查类似历史 |
| 配置 | `.mailtidy/config.json` 已有 LLM provider/model | 扩展 embedding provider/model、vector backend、召回阈值 |
| 回滚 | `preferenceHistory` 数组 | `preference_history` 表，支持偏好、学习提议和向量条目同步失效 |
| 删除权 | 删除 JSON 中 sender 偏好 | 删除/归档 SQLite 偏好，同时 tombstone 相关 `memory_items` / vectors |

V2 要保留 V1 的工程优点：本地优先、无网络也能跑 demo、启发式兜底、所有高风险动作仍需确认。

---

## 三、存储架构

推荐的 V2 本地目录：

```text
.mailtidy/
  mailtidy.sqlite       # 权威数据：任务、偏好、日志、学习、memory item、向量元数据
  config.json           # 用户配置、模型配置、预算、connector 设置
  rules.json            # 可选，用户可手动编辑的轻量规则
  prompts.json          # 可选，提示词覆盖
  reports/              # Markdown 报告正文，可继续保留为文件
    <taskId>.md
```

如果使用 `sqlite-vec`，向量也存进 `mailtidy.sqlite`：

```text
.mailtidy/
  mailtidy.sqlite       # 普通表 + vec0 虚拟表
```

如果后续改用 LanceDB / Chroma：

```text
.mailtidy/
  mailtidy.sqlite       # 权威数据 + vector metadata
  vector-index/         # 外部向量索引，可重建
```

MVP 推荐：**SQLite + sqlite-vec**。理由：

- 本地轻量，部署简单。
- 单文件易备份。
- 与结构化数据事务边界更清晰。
- 对 MailTidy 初期数据量足够。

后续如果邮件量和向量量明显变大，再把 vector backend 抽换成 LanceDB。

---

## 四、SQLite 数据模型

### 4.1 preferences

保存稳定、可执行的偏好。它是 Agent 长期行为的权威来源。

```sql
CREATE TABLE preferences (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,              -- sender | domain | category | action | style | global
  key TEXT NOT NULL,                -- ceo@example.com / github.com / newsletter / archive:Newsletters
  value_json TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', -- active | archived | rejected
  learned_from TEXT,
  learned_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope, key)
);
```

示例：

```json
{
  "category": "important",
  "importanceDelta": 2,
  "preferredAction": "star",
  "ignoredCount": 0
}
```

### 4.2 preference_history

保存偏好变更历史，是 rollback 的依据。

```sql
CREATE TABLE preference_history (
  id TEXT PRIMARY KEY,
  preference_id TEXT NOT NULL,
  action TEXT NOT NULL,             -- create | update | delete | rollback
  previous_json TEXT,
  next_json TEXT,
  reason TEXT,
  task_id TEXT,
  email_id TEXT,
  created_at TEXT NOT NULL
);
```

要求：

- 所有 `preferences` 写入必须同时写 `preference_history`。
- 回滚本身也要写一条 `rollback` 历史。
- 自动学习、用户确认、CLI 手动修改都不能绕过 history。

### 4.3 decision_logs

保存每次判断、执行和用户反馈。

```sql
CREATE TABLE decision_logs (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  email_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  subject TEXT,
  original_category TEXT,
  suggested_action TEXT,
  final_action TEXT,
  user_response TEXT,               -- confirmed | rejected | corrected | skipped
  confidence REAL,
  reason TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);
```

用途：

- 学习提议器扫描近期日志。
- RAG 生成 `decision` 类型 memory item。
- 自我意识统计准确率、拒绝率和偏好老化。

### 4.4 memory_items

保存可被语义召回的记忆条目。它是向量索引的源数据。

```sql
CREATE TABLE memory_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,               -- decision | preference_note | email_summary | style_sample | subscription
  source_table TEXT,
  source_id TEXT,
  title TEXT,
  content TEXT NOT NULL,
  metadata_json TEXT,
  importance REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'active', -- active | tombstoned
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
```

`content` 是给 embedding 的文本，不应该直接塞完整邮件正文。优先使用摘要、决策理由和必要的上下文片段。

### 4.5 embeddings

保存 embedding 元数据。向量本体可存在 sqlite-vec 虚拟表里。

```sql
CREATE TABLE embeddings (
  id TEXT PRIMARY KEY,
  memory_item_id TEXT NOT NULL,
  model TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);
```

如果使用 sqlite-vec，可另建：

```sql
CREATE VIRTUAL TABLE memory_vectors USING vec0(
  embedding FLOAT[1536]
);
```

实现时需要把 `embeddings.id` 和 vector rowid 建立稳定映射。具体 schema 可按选定库调整，但必须满足：

- 能按 `memory_item_id` 删除或失效。
- 能按 `model` 找出需要重建的向量。
- 能按 `content_hash` 跳过重复 embedding。

### 4.6 tasks / checkpoints / reports

V2 可以逐步把任务类 JSON 迁入 SQLite。

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  sop TEXT NOT NULL,
  status TEXT NOT NULL,
  invocation_json TEXT NOT NULL,
  progress_json TEXT,
  exit_reason TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT
);
```

```sql
CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  phase TEXT,
  budget_json TEXT,
  state_json TEXT,
  digest TEXT,
  created_at TEXT NOT NULL
);
```

```sql
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  path TEXT,
  title TEXT,
  summary TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

报告正文可以继续用 Markdown 文件，SQLite 只存索引、摘要和路径。

---

## 五、RAG 记忆系统

### 5.1 记忆对象类型

V2 不把所有原始邮件都向量化。默认向量化这些对象：

| 类型 | 来源 | 内容 | 用途 |
| --- | --- | --- | --- |
| `decision` | `decision_logs` | 邮件摘要 + 分类 + 建议动作 + 用户反馈 + 理由 | 找类似历史决策 |
| `preference_note` | `preferences` / 用户反馈 | 自然语言偏好说明 | 找模糊偏好 |
| `email_summary` | thread / 邮件摘要 | 事实摘要 + evidence refs | 跨邮件上下文 |
| `style_sample` | 用户确认过的草稿/回复 | 写作风格样例和修改说明 | 生成回复草稿 |
| `subscription` | 订阅扫描 | 服务、金额、周期、历史变化 | 找类似账单和扣费 |

禁止默认向量化：

- 完整邮件正文。
- OAuth token、API key、验证码。
- 明显的敏感字段，如身份证号、银行卡号、完整地址。
- 用户明确要求忘记的 sender/domain/thread。

### 5.2 EmbeddingProvider

新增抽象：

```typescript
interface EmbeddingProvider {
  readonly provider: "openai" | "local" | "heuristic";
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
```

推荐实现顺序：

1. `HeuristicEmbeddingProvider`：测试用，不追求语义效果，只保证无网络可跑。
2. `OpenAIEmbeddingProvider`：使用 `text-embedding-3-small` 或配置指定模型。
3. `LocalEmbeddingProvider`：后续接 Ollama / sentence-transformers。

数据库必须记录 `model` 和 `dimensions`。当配置换 embedding 模型时，旧向量不能混用，必须重建或按模型过滤。

### 5.3 MemoryIndex

新增向量索引接口：

```typescript
interface MemoryIndex {
  upsert(items: MemoryItem[]): Promise<void>;
  search(query: SemanticMemoryQuery): Promise<SemanticMemoryMatch[]>;
  deleteBySource(source: { table: string; id: string }): Promise<void>;
  tombstoneByScope(scope: string, key: string): Promise<void>;
  rebuild(options?: { model?: string; batchSize?: number }): Promise<void>;
}
```

`search()` 入参：

```typescript
interface SemanticMemoryQuery {
  query: string;
  types?: MemoryItemType[];
  limit?: number;
  minScore?: number;
  sender?: string;
  domain?: string;
  since?: string;
}
```

返回：

```typescript
interface SemanticMemoryMatch {
  memoryItemId: string;
  type: MemoryItemType;
  score: number;
  title?: string;
  summary: string;
  sourceTable?: string;
  sourceId?: string;
  metadata: Record<string, unknown>;
}
```

### 5.4 新工具：semantic_recall_memory

V2 保留 V1 的 `recall_memory`，新增语义召回工具：

```text
recall_memory
```

精确查：

- sender preference
- action preference
- style profile
- subscription history

```text
semantic_recall_memory
```

语义查：

- 类似邮件历史上怎么处理。
- 类似用户反馈曾经怎么纠正。
- 类似回复草稿用户喜欢什么语气。
- 类似订阅/账单是否出现过。

工具输出必须包含 source id，不能只返回一句结论。

---

## 六、持续学习流程

V2 的学习链路：

```text
用户确认 / 拒绝 / 修改 / 执行动作
      ↓
写 decision_logs
      ↓
LearningEngine 生成 PreferenceUpdate 或 LearningProposal
      ↓
安全检查：危险偏好必须停在 proposal
      ↓
写 preferences + preference_history
      ↓
生成 memory_items
      ↓
EmbeddingProvider 生成向量
      ↓
写 embeddings / memory_vectors
```

### 6.1 同步学习

适合立即处理的场景：

- 用户确认某个动作。
- 用户拒绝某个动作。
- 用户纠正分类。
- 用户修改草稿后确认发送。

同步学习只允许写低风险事实和候选记录。影响自动化行为的偏好必须满足阈值或用户明确确认。

### 6.2 异步学习

适合后台扫描的场景：

- 连续 N 次确认同一 sender 的同一动作。
- 某类邮件近期拒绝率升高。
- 某个偏好超过 90 天没被使用。
- 同一项目/客户邮件出现跨线程上下文。

异步学习输出 `LearningProposal`，进入主动告知或开场提问，不应直接执行高风险写入。

### 6.3 写入纪律

V2 必须修正 V1 的两类风险：

1. 不允许直接改 `memory.senderPreferences[...]` 这类绕过 history 的写法。
2. 不允许 `write_memory` 收了 `learnedFrom` 但没有写入偏好元数据。

所有偏好写入统一走 repository 方法：

```typescript
PreferenceRepository.upsertPreference({
  scope,
  key,
  value,
  confidence,
  learnedFrom,
  learnedAt,
  reason,
  taskId,
  emailId,
});
```

这个方法必须在一个事务里完成：

1. 写 `preferences`。
2. 写 `preference_history`。
3. 写或更新 `memory_items`。
4. 标记旧 embedding 失效，排队重建。

---

## 七、Agent 查询路径

V2 决策时的查询顺序：

```text
当前邮件 / 当前任务
      ↓
1. 精确查 preferences：sender/domain/action/category
      ↓
2. 规则匹配：用户规则、系统安全规则
      ↓
3. LLM/heuristic 初判
      ↓
4. 触发条件命中时做 semantic recall
      ↓
5. deepThink 整合：当前邮件事实 + 规则 + 精确偏好 + 语义历史
      ↓
6. 输出计划 / ask user / 执行动作
      ↓
7. 写 decision log 和学习信号
```

### 7.1 semantic recall 触发条件

不是每封邮件都查向量库。命中以下条件才查：

| 触发条件 | 例子 |
| --- | --- |
| 低置信度 | `confidence < 0.7` |
| 偏好冲突 | sender preference 要归档，但当前判断重要 |
| 陌生但高价值 sender | 新客户、新招聘、新付款、新安全事件 |
| 跨邮件依赖 | “见上次附件”“继续之前讨论” |
| 草稿生成 | 需要找用户类似写作风格 |
| 订阅识别 | 账单内容不标准，需要找类似历史 |

默认限制：

- `limit <= 8`
- `minScore >= 0.72`
- 单任务 semantic recall 不超过 5 次
- 召回结果只进 L2 evidence summary，不直接进入最终动作

### 7.2 RAG 上下文格式

RAG 结果进入 LLM 前必须压缩成 evidence：

```text
Relevant semantic memory:
- [decision:dec_123 score=0.84] Similar GitHub changelog emails were labeled Dev Updates and archived after user confirmation.
- [preference:pref_456 score=0.79] User prefers security alerts from known vendors to stay unread until reviewed.
```

要求：

- 写明 `sourceType/sourceId/score`。
- 区分历史事实和当前推断。
- 不把历史经验说成当前邮件事实。

---

## 八、配置文件

V2 继续使用 `.mailtidy/config.json` 做轻量配置。

示例：

```json
{
  "models": {
    "llmProvider": "openai",
    "llmModel": "gpt-4.1-mini",
    "embeddingProvider": "openai",
    "embeddingModel": "text-embedding-3-small"
  },
  "agent": {
    "automationMode": "balanced",
    "maxSteps": 12,
    "maxSemanticRecall": 5,
    "semanticRecallLimit": 8,
    "semanticRecallThreshold": 0.72
  },
  "storage": {
    "databasePath": ".mailtidy/mailtidy.sqlite",
    "vectorBackend": "sqlite-vec"
  },
  "privacy": {
    "persistEmailBodies": false,
    "redactBeforeEmbedding": true,
    "allowCloudEmbeddings": false
  }
}
```

配置原则：

- JSON 只放用户可理解、可手动编辑的配置。
- 不放长期学习结果。
- 不放 token 和敏感认证信息。
- `allowCloudEmbeddings` 默认建议为 `false`，用户明确开启后才把摘要发给云端 embedding 模型。

---

## 九、代码改造计划

### 9.1 新增模块

建议新增：

```text
src/data/database.ts          # SQLite connection, migrations, transaction helper
src/data/schema.ts            # SQL schema / migration list
src/data/preferences.ts       # PreferenceRepository
src/data/memory-items.ts      # MemoryItemRepository
src/data/vector-index.ts      # MemoryIndex interface + sqlite-vec implementation
src/integrations/embedding/
  base.ts                     # EmbeddingProvider interface
  heuristic.ts                # test/local fallback
  openai.ts                   # OpenAI embedding adapter
  local.ts                    # future local embedding adapter
src/tools/semantic-memory.ts  # semantic_recall_memory tool
```

### 9.2 改造现有模块

| 文件 | V2 改造 |
| --- | --- |
| `src/data/memory.ts` | 保留类型兼容，新增从 SQLite hydrate `AgentMemory` 的 adapter；逐步废弃 `JsonMemoryStore` |
| `src/data/learning.ts` | `applyUpdate()` 不再直接改对象，改调用 `PreferenceRepository` |
| `src/data/learning-proposer.ts` | `applyProposals()` 通过 repository 写入 history 和 memory item |
| `src/data/decision-logs.ts` | 从 JSONL store 迁移到 SQLite store，保留接口 |
| `src/tools/memory.ts` | `recall_memory` 从 repository 查；`write_memory` 写入 learned metadata |
| `src/tools/registry.ts` | 注册 `semantic_recall_memory` |
| `src/agent/deepThink.ts` | 低置信度/冲突时生成 semantic recall suggestion |
| `src/agent/loop.ts` | 在 plan 后执行受限 semantic recall，并写入 evidence |
| `src/ops/config.ts` | 增加 embedding 和 vector 配置 |
| `src/interfaces/cli.ts` | 增加 `memory rebuild-index`、`memory forget`、`db migrate` 等命令 |

### 9.3 新增 CLI

```text
mailtidy db migrate
mailtidy db status
mailtidy memory rebuild-index
mailtidy memory search "<query>"
mailtidy memory forget <sender>
mailtidy memory rollback <historyId>
mailtidy memory export
```

### 9.4 测试计划

新增测试：

| 测试 | 覆盖 |
| --- | --- |
| `database.test.ts` | migration、事务、schema version |
| `preferences-repository.test.ts` | upsert、history、rollback |
| `memory-index.test.ts` | upsert/search/tombstone/rebuild |
| `semantic-memory-tool.test.ts` | `semantic_recall_memory` schema 和返回 source refs |
| `learning-sqlite.test.ts` | 学习写入不绕过 history |
| `memory-migration.test.ts` | 从 `memory.json` 迁移到 SQLite |
| `privacy.test.ts` | embedding 前 redact，forget 后 vector tombstone |

---

## 十、迁移方案

### 10.1 阶段 A：并行引入 SQLite

目标：不破坏 V1。

步骤：

1. 新增 SQLite schema 和 migration。
2. 新增 repositories，但原 CLI 仍可走 JSON。
3. 写 `memory.json -> SQLite` 迁移器。
4. 测试迁移后 `recall_memory` 结果与 V1 一致。

### 10.2 阶段 B：切换权威 memory

目标：SQLite 成为权威状态。

步骤：

1. CLI 启动时优先加载 SQLite。
2. 若只有 `memory.json`，提示或自动迁移。
3. `LearningEngine.applyUpdate()` 改成 repository 写入。
4. `write_memory` 改成 repository 写入。
5. `JsonMemoryStore` 标记 deprecated。

### 10.3 阶段 C：引入 memory_items

目标：为 RAG 准备源数据。

步骤：

1. 每条 decision log 生成一条 `memory_items(type=decision)`。
2. 每条 active preference 生成一条 `memory_items(type=preference_note)`。
3. 草稿确认后生成 `style_sample`。
4. 订阅扫描后生成 `subscription`。

### 10.4 阶段 D：引入 embedding 和向量索引

目标：让 `semantic_recall_memory` 可用。

步骤：

1. 实现 `EmbeddingProvider`。
2. 实现 `MemoryIndex`。
3. 增加 `memory rebuild-index`。
4. 在低置信度/冲突场景调用 semantic recall。

### 10.5 阶段 E：RAG 进入主循环

目标：Agent 决策真正利用语义记忆。

步骤：

1. `deepThink` 输出 semantic recall 建议。
2. `loop` 执行建议并写 `investigationResults`。
3. `WorkingContextManager` 把结果压缩成 evidence。
4. 报告显示“使用了哪些历史记忆”。

---

## 十一、验收标准

V2 必须通过这些验收：

1. **SQLite 权威状态**  
   删除 `.mailtidy/memory.json` 后，Agent 仍能从 SQLite 读取偏好。

2. **学习可审计**  
   用户确认某动作后，能在 `preferences`、`preference_history`、`decision_logs` 中找到来源链。

3. **回滚完整**  
   `mailtidy memory rollback <id>` 后，偏好状态恢复，回滚动作本身写入 history，相关 memory item/vector 被更新或 tombstone。

4. **语义召回有效**  
   给一封类似历史 newsletter 的邮件，`semantic_recall_memory` 能返回相似历史决策，并带 `sourceId`。

5. **RAG 不越权**  
   召回“历史上常归档”不能让 high-risk 当前邮件自动归档；高风险动作仍需确认。

6. **忘记权有效**  
   `memory forget <sender>` 后，精确偏好查不到，语义搜索也不再返回该 sender 的 active memory item。

7. **向量可重建**  
   删除 vector index 后运行 `memory rebuild-index`，semantic recall 恢复可用。

8. **无网络可测试**  
   heuristic embedding provider 能让测试在 CI 离线通过。

9. **隐私默认保守**  
   默认不持久化完整邮件正文，默认不把摘要发给云端 embedding，除非用户配置允许。

---

## 十二、本次修改总结

这份 V2 文档把 MailTidy 的记忆系统从 V1 的 `memory.json` 方案升级为数据库 + RAG 方案：

- 新增 SQLite 作为本地权威数据层。
- 明确 JSON 只负责配置，不再保存长期学习结果。
- 新增 `memory_items` 和 `embeddings` 作为语义记忆源数据与索引。
- 新增 `EmbeddingProvider`、`MemoryIndex`、`semantic_recall_memory` 的接口设计。
- 给出持续学习、RAG 查询路径、隐私边界和回滚纪律。
- 给出从 V1 到 V2 的分阶段迁移方案。
- 给出需要修改的现有模块和新增测试计划。

V2 的关键不是“把 memory 改成向量库”，而是把 memory 拆成两层：

```text
SQLite = 权威事实、状态、审计、回滚
Vector Index = 可重建的相似经验召回
```

这样既能保留 V1 已经做好的透明度和控制感，也能让 Agent 真正拥有长期语义记忆。
