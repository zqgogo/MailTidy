# MailTidy 邮件 Agent 设计文档

> MailTidy 是一个会主动思考、主动调查、主动告知的邮件 Agent。
> 它不是又一个"自动化 + AI"工具——它是一个有意识的助手。

## 目录

- 一、产品
  - 1.1 一句话产品
  - 1.2 核心原则
  - 1.3 目标用户
  - 1.4 内置 SOP 概览
- 二、Agent 核心
  - 2.1 Agent 运行模型
    - 2.1.2 深度思考与上下文压缩
  - 2.2 主动性与意识
  - 2.3 LLM 与工具调用
  - 2.4 决策、确认与规则
  - 2.5 透明度与掌控感
- 三、Skills（SOP 详细）
  - 3.1 收件箱清理
  - 3.2 智能回复草拟
  - 3.3 订阅费扫描器
  - 3.4 邮件摘要日报
- 四、Data（数据与持久化）
  - 4.1 邮件分类与判断维度
  - 4.2 记忆层
  - 4.3 学习层
  - 4.4 任务记录与生命周期
  - 4.5 存储与安全
- 五、工程进度与路线图
  - 5.1 目录结构改动
  - 5.2 当前已实现功能
  - 5.3 路线图（Phase 1-5）
  - 5.4 MVP 里程碑

---

## 一、产品

### 1.1 一句话产品

MailTidy 是一个会阅读收件箱、判断邮件意图和优先级、生成处理计划，并在关键动作前征求确认的邮件 Agent。它能清理收件箱、整理标签、生成摘要、扫描订阅费、为需要回复的邮件生成草稿，并在用户没问的时候**主动告知值得注意的事**。

### 1.2 核心原则

MailTidy 必须是一个 **Agent**，不是更花哨的自动化脚本。两者的差别决定了 LLM 是否值得引入：

| 维度 | 自动化脚本 | Agent |
| --- | --- | --- |
| 决策来源 | 写死的 if/else 与正则 | LLM 在每一步选择动作 |
| 工具使用 | 调用顺序写死在代码里 | LLM 自己决定调用哪个工具 |
| 不确定性 | 走 default 分支 | 触发再思考、拉更多上下文 |
| 反馈 | 不学习，只存日志 | 用户每一次确认 / 拒绝 / 修改都改写偏好 |
| 跨 SOP | 各 SOP 互不感知 | Agent 主动串联多个 SOP |

如果代码还是"关键词分类 + 写死的归档动作"，那 LLM 只能算"更贵的正则"，不值得引入。**MailTidy 的工程目标就是把 LLM 放到决策中枢的位置**，并满足三件事：

1. **是 Agent**：通过主循环 + 工具调用 + 多轮思考完成任务，而不是单次流水线（详见 §2.1）。
2. **有主动性**：会主动多查、主动核实、主动告知用户没问但值得知道的事（详见 §2.2）。
3. **会学习**：用户每次反馈都让 Agent 下一次表现不同，不是只存日志（详见 §4.3）。
4. **对用户透明**：用户始终知道 Agent 在干什么、花了多少 token、为什么这么做、随时可以叫停（详见 §2.5）。**永远让用户感觉"尽在掌握"，而不是"黑箱在跑"。**

真正的价值不是"帮你点按钮"，而是减少用户每天面对邮件时的认知负担：哪些要处理、哪些可以忽略、哪些只是信息、哪些正在悄悄花钱、哪些可能正在骗你。

### 1.3 目标用户

- 所有被邮件淹没的人。
- 每天需要处理大量内外部沟通的职场人。
- 管理者、CEO、创业者等需要早晨快速掌握局面的用户。
- 经常忘记订阅扣费、想看清固定支出的人。

### 1.4 内置 SOP 概览

| SOP | 目标 | 默认频率 | 当前状态 |
| --- | --- | --- | --- |
| 收件箱清理 | 分类近期邮件，归档促销 / 垃圾，保留重要邮件 | 每天 9:00 + 手动 | demo 骨架 |
| 智能回复草拟 | 学习写作风格，为 actionable 邮件生成草稿 | 清理后触发 + 手动 | demo 骨架 |
| 订阅费扫描器 | 从邮箱中找出付费订阅和月度支出 | 每月 + 手动 | demo 骨架 |
| 邮件摘要日报 | 生成 2 分钟可读的早晨 briefing | 每天 7:30 | demo 骨架 |

详细见 §三 Skills。SOP 不再是孤立命令，而是 Agent 主循环里**可被组合的子任务**——清理时可以自动触发 daily-brief、订阅扫描发现新订阅可以挂起问用户、自然语言指令可以串联研究 + 规则 + 邮件动作。

---

## 二、Agent 核心

### 2.1 Agent 运行模型

#### 2.1.1 主循环

每次用户触发任务，Agent 都进入下面的循环：

```text
┌─────────────────────────────────────────────────────────────┐
│ State：当前任务、已知判断、用户偏好、规则匹配、待办问题、剩余预算   │
└──────┬──────────────────────────────────────────────────────┘
       ▼
   Reason  ──►  Plan next step  ──►  call tool | ask user | finish
       ▲                                  │
       │                                  ▼
       │                              Observe
       │                                  │
       │                                  ▼
       │                         check exit conditions
       │                                  │
       └─────── 未触发任何退出条件 ◄────────┘
                                          │
                       触发任一退出条件 ──► 强制 finish + 写报告
```

每一步 LLM 都看到完整 State 与可用工具列表，自己决定下一步做什么；任何一步的产出都会被合并回 State，作为下一轮思考的输入。

**关键纪律：每一步 Observe 之后必须强制检查退出条件——退出条件由主循环代码强制执行，永远优先于 LLM 的下一步决策。**

#### 2.1.2 深度思考与上下文压缩

Agent 需要能“深度思考”，但不能把所有历史邮件、所有 trace、所有记忆一股脑塞进超长上下文。当前超长上下文模型仍然会丢重点、混淆来源、在后半段遗忘前半段，所以 MailTidy 的原则是：**先压缩，再推理；先摘要，再回查；只在必要时读取原记录。**

##### 深度思考的触发条件

深度思考不是每封邮件都跑。只有命中以下情况时才进入 `deep_think` 流程：

| 触发条件 | 例子 | 默认动作 |
| --- | --- | --- |
| 高风险 | 钓鱼、转账、账号验证、法律、金融、医疗 | 先压缩上下文，再多轮推理，必要时回查原文 |
| 低置信度 | `confidence < 0.7`，或规则 / LLM 判断冲突 | 生成不确定点清单，补拉最小必要上下文 |
| 跨邮件依赖 | “我之前发的文档”、长 thread、连续催办 | 先生成 thread 摘要，再选择性读原邮件 |
| 用户长期偏好冲突 | 规则说归档，但近期用户多次加星 | 回查最近决策摘要和少量原始记录 |
| 重操作候选 | 需要联网、多实体、多封邮件综合 | 先产出研究计划，超过预算则放入重操作清单 |

##### 上下文分层

Agent State 里不允许无限增长原文。上下文必须分成 5 层，越往上越短，越往下越接近原始数据：

| 层 | 内容 | 是否默认进入 LLM 上下文 | 最大长度 |
| --- | --- | --- | --- |
| L0 任务目标 | 用户原始请求、当前 task goal、预算、退出条件 | 是 | < 1K token |
| L1 工作摘要 | 当前已处理什么、剩什么、关键判断、未解决问题 | 是 | < 2K token |
| L2 证据摘要 | 邮件摘要、thread 摘要、记忆摘要、规则命中摘要 | 是 | < 4K token |
| L3 可回查索引 | email_id、message_id、trace_step_id、memory_key、report_path | 是，只放索引不放全文 | < 1K token |
| L4 原始记录 | 邮件正文、完整 trace、完整历史决策、原始搜索结果 | 否，只有工具按需读取 | 单次读取受限 |

LLM 每轮主要看 L0-L3。L4 原始记录只能通过工具按需读取，例如 `read_email(id, max_chars)`、`read_trace_slice(step_id, window)`、`recall_memory(query, max_items)`。这样能让 Agent 既有“深度”，又不会被超长上下文拖乱。

##### 压缩记忆与摘要策略

每次 Observe 后，Agent 都要把新增信息写入 `working_summary`，而不是把原始 observation 直接长期塞进 State。

```json
{
  "working_summary": {
    "goal": "清理最近 24 小时未读邮件",
    "decisions_so_far": [
      "18/30 封已完成轻分类",
      "3 封低置信度需要读全文",
      "1 封 FTX 相关邮件需要风险核实"
    ],
    "open_questions": [
      "FTX 邮件域名是否可信",
      "boss@company.com 的催办是否已过期"
    ],
    "evidence_index": [
      {"type": "email", "id": "m19", "summary": "FTX claim reminder, contains external verification link"},
      {"type": "memory", "key": "entity:FTX", "summary": "用户倾向加星、保持未读、谨慎核验链接"}
    ],
    "budget_left": {"steps": 4, "tokens": 12000}
  }
}
```

摘要必须遵守三条规则：

1. **事实与推断分离**：摘要里要标明哪些是邮件原文事实，哪些是 Agent 推断，哪些是外部来源。
2. **保留引用索引**：任何摘要结论都必须能回到 `email_id` / `trace_step_id` / `memory_key`，不能只剩一句没出处的话。
3. **持续压缩**：当 `working_summary` 超过阈值（默认 6K token）时，先压缩成阶段摘要，再继续执行；压缩前后的摘要都写入 trace，便于审计。

##### 回查原记录的限制

“必要时查看原记录”是为了纠错，不是把上下文重新塞爆。回查必须受这些限制：

| 限制 | 默认值 | 原因 |
| --- | --- | --- |
| 单次邮件正文读取 | `max_chars=6000` | 先读关键片段，不读整箱 |
| 单次历史记忆返回 | `max_items=8` | 防止旧偏好淹没当前任务 |
| 单次 trace 回查窗口 | 前后各 3 步 | 只看相关上下文 |
| 单轮回查次数 | ≤ 3 次 | 防止“越查越散” |
| 原文进入最终报告 | 默认不进入，只引用摘要和证据索引 | 降低隐私风险 |

如果三次回查仍无法解决不确定性，Agent 必须停止深挖，改为输出 `If unsure`，或者通过 `ask_user` 挂起任务。

##### 深度思考输出

深度思考结束后不直接动邮箱，而是产出结构化结果：

```json
{
  "deep_think_result": {
    "conclusion": "这封 FTX 邮件疑似高风险，暂不点击链接",
    "confidence": 0.74,
    "used_summaries": ["working_summary:cleanup-2026-05-11-001:round_2"],
    "checked_originals": [
      {"type": "email", "id": "m19", "range": "first_6000_chars"},
      {"type": "memory", "key": "entity:FTX"}
    ],
    "remaining_uncertainty": "无法确认该域名是否为官方授权第三方",
    "next_action": "ask_user_or_add_to_heavy_ops"
  }
}
```

##### 必须新增的工程模块

这部分能力对应到代码目录中：

- `agent/context.py`：维护 `working_summary`、上下文窗口、证据索引。
- `agent/compression.py`：阶段摘要、摘要再压缩、事实 / 推断 / 来源分离。
- `agent/deep_think.py`：深度思考触发、回查计划、最终结构化结果。
- `tools/history.py`：`read_trace_slice`、`read_report_summary`、`read_original_record` 等受限回查工具。
- `data/summaries.py`：摘要对象、摘要版本、引用索引 schema。

这些模块与 §4.4 的任务记录联动：每个 checkpoint 都要保存当前摘要和 evidence index，恢复任务时优先加载摘要，再按需回查原记录。

#### 2.1.3 退出条件

主循环代码必须在每次 Observe 后强制检查以下 9 种条件，命中任一立即停下来：

| 条件 | 触发 | 收尾方式 |
| --- | --- | --- |
| 任务完成 | LLM 显式输出 `finish` | 正常结束，写完成报告 |
| 步数耗尽 | 已执行步数 ≥ N（默认 12） | 强制结束，未完成项进 pending 队列 |
| Token 预算耗尽 | 累计 prompt + completion token 超过 T（默认 50K） | 同上 |
| Wall time 超时 | 任务总耗时超过 S 秒（默认 120s） | 同上 |
| 同类工具反复失败 | 同一工具连续失败 ≥ 3 次 | 标记"卡住"，跳过继续后面的步骤 |
| LLM 重复同一动作 | 检测到连续 3 步相同 `(tool, args)` | 强制结束并写 trace 错误，进入降级模式 |
| 用户中断 | 用户取消任务 | 立即停下，已完成的安全动作保留，未确认动作不补做 |
| 致命错误 | LLM 调用失败 / 连接器异常 / 致命解析错误 | 进入降级模式（见 §2.1.5），不抛断点 |
| `ask_user` 触发 | LLM 决定问用户 | 任务挂起，等用户回复后从断点续跑 |

退出条件命中时必须按顺序保证四件事：

1. **更新任务记录**：把 `status` 置为对应终态，写 `exit_reason`、最终 `progress`，**先落盘，再做后续动作**。
2. **写报告**：正常完成写完成报告（`<task_id>.md`），异常退出写半成品报告（`<task_id>-partial.md`）。
3. **未完成项进队列**：通过持久化的 `pending_tasks` 让下次启动时优先处理。
4. **触发主动告知**：把"我这次没做完 X"作为一条主动告知浮到下一份日报里。

详细的任务记录字段、生命周期、恢复语义见 §4.4。

#### 2.1.4 执行节奏：轻先重后

任务里不是所有步骤都一样贵。Agent 必须显式区分"轻 / 中 / 重"三类操作：

| 类别 | 典型工具 | 成本 | 处理策略 |
| --- | --- | --- | --- |
| 轻 | `list_emails` / `recall_memory` / `match_rules` / `classify_email`（短文本） | 低 token、< 1s | 同步执行 |
| 中 | `read_email`（全文）/ `search_email` / `classify_email`（长上下文） | 中等 token、几秒 | 先估规模，超阈值则分批 + 限频 |
| 重 | `web_search` / 多封邮件批量深读 / 跨实体研究型分析 | 高 token、可能 10s+ | **不在主循环里直接执行**，生成"重操作建议"由用户决定 |

主循环按四轮顺序执行；每轮结束都走一次退出条件检查，且每轮都有自己的预算上限：

1. **第一轮 · 轻操作扫一遍**：用便宜工具完成所有"显然要做"的事——拉邮件元信息、规则匹配、记忆查询、明显安全的分类。**绝大多数邮件应在这一轮分完类。**
2. **第二轮 · 必要的中操作**：对置信度低 / 命中主动调查触发器的邮件，调用 `read_email` 拉全文重判。**这一轮必须先估规模**，超过预算就只挑最重要的处理。
3. **第三轮 · 主动巡检**：对照 §2.2.2 触发条件和 §2.2.3 告知时机再过一遍，看还有没有漏的查、应告知的事。**这是 Agent 主动多想一步的核心位置。**
4. **第四轮 · 重操作清单**：所有"很贵 / 很慢 / 不是非现在做不可"的事不在本次任务里执行，而是生成结构化建议附在报告里：

   ```json
   {
     "id": "deep-research-ftx-001",
     "type": "web_search_research",
     "subject": "FTX 索赔邮件背景核实",
     "estimated_cost": "约 8K token, ~10 秒",
     "estimated_value": "high",
     "why_not_now": "本次任务预算已用 70%，且这条建议非阻塞性",
     "user_choice": ["立即执行", "下次清理一起跑", "永远不需要"]
   }
   ```

   用户同意"立即执行"则下次跑独立的"深研究任务"专门处理它，独立预算、独立 trace。

**重操作判定阈值**——任何工具调用前先估成本，超过任一阈值就归到"重操作"延后：

- 单次工具调用预计 token > 4K。
- 单次工具调用预计耗时 > 5s（联网类阈值更低）。
- 跨度 > 20 封邮件的批量深读。
- `web_search` 调用 > 1 次（除非用户显式要求）。
- 任何会让本次任务总预算超过 80% 的操作。

#### 2.1.5 兜底与降级策略

最坏情况下体验可以差，但**绝对不能让用户跑不动 Agent**。所有外部依赖都必须有降级路径：

| 故障 | 默认行为 | 降级行为 | 最终兜底 |
| --- | --- | --- | --- |
| LLM API 不可用 | OpenAI / Anthropic | 切换到备用模型路由 | 切回 `HeuristicLLMClient` 跑流水线模式 |
| LLM 调用超时 / 错误 | 重试 1 次 | 切到便宜模型重试 1 次 | 跳过该步骤，记入 trace，继续主循环 |
| `web_search` 不可用 | 联网搜索 | 跳过本次研究 | 把建议标记"未联网验证" |
| 邮件 connector 拉取失败 | Gmail / Outlook API | 用本地缓存邮件 | 友好错误，提示检查授权，**不丢失记忆** |
| Token / 步数预算耗尽 | 正常执行 | 立即收尾，写半成品报告 | 报告中明确"剩 N 件事待下次" |
| 单封邮件分类失败 | LLM 分类 | 退化到 heuristic | 归入"未分类"，仅出现在报告，**不动邮箱** |
| Memory 文件读写失败 | 加密本地数据库 | 切换到 JSON 备份 | 用临时内存 memory 跑完，结束时再尝试写入 |
| 重操作预算耗尽 | 正常执行 | 自动归入"待执行清单" | 报告中提示"已收集 N 条重操作，等你确认" |
| Agent 自检发现准确率太低 | 正常工作 | 主动降低自动化倾向，更多 `ask_user` | 暂时退到 dry-run 模式 |

**降级 4 原则**：

1. **不静默失败**：每次降级都写到 trace **并**通过主动告知告诉用户。
2. **逐步降级**：能用便宜模型就别关掉；能用本地启发式就别报错；能拉缓存就别放弃。
3. **永远保底有 `HeuristicLLMClient`**：即使所有外部依赖都挂了，跑 `python -m mailtidy.interfaces.cli run-cleanup` 仍然能得到一份基础清理报告。**这是 MailTidy 的最低可用线。**
4. **降级不能偷偷变默认**：连续多次降级要主动告知"我已连续 3 天用回启发式，可能你的 OpenAI 配置有问题"。

#### 2.1.6 综合 14 条硬约束

主循环代码（`mailtidy/agent_loop.py`）必须自带以下硬约束。**这 14 条是单测必检项，缺一不可。**

| # | 约束 | 默认值 / 说明 |
| --- | --- | --- |
| 1 | 步数预算 | 单次任务最多 N 步（默认 12） |
| 2 | Token 预算 | 单次任务最多 T token（默认 50K） |
| 3 | Wall time 预算 | 单次任务最多 S 秒（默认 120s） |
| 4 | 工具预算 | `web_search ≤ 3` / 任务、`apply_action` 高风险动作必须先 `ask_user` |
| 5 | 重操作不直接执行 | 超阈值生成"重操作建议"交给用户 |
| 6 | 退出条件强制检查 | 每次 Observe 后必检 9 种退出条件 |
| 7 | 死循环检测 | 连续 3 步相同 `(tool, args)` 立即终止 |
| 8 | 可观察性 | 每一步 `(thought, tool, args, observation, exit_check)` 落 trace |
| 9 | 可中断 | 用户随时取消，已执行的安全动作保留 |
| 10 | 可恢复 | 被 `ask_user` 挂起的任务等用户回复后从断点续跑 |
| 11 | 沙箱模式 | 写动作可走 dry-run，trace 显示"如果不是 dry-run 会做什么" |
| 12 | 降级路径 | 所有外部依赖都有明确降级方案 |
| 13 | 上下文压缩 | LLM 默认只看摘要和证据索引；原始记录必须通过受限工具按需回查 |
| 14 | 用户透明 | 实时暴露阶段 / 预算 / 已执行动作；任何不可逆动作 / 联网 / 偏好写入都可被用户事前感知与事后回查（详见 §2.5） |

#### 2.1.7 跨 SOP 联动

四条 SOP 不再是孤立 CLI 命令，而是 Agent 主循环里**可被组合的子任务**：

- 清理时如果发现今天有 5 封紧急邮件，Agent 可以自动触发一次 daily-brief 推送。
- 订阅扫描发现一个新订阅，Agent 可以挂起并问用户是否打 `Subscriptions` 标签。
- 用户用自然语言说"以后 FTX 的邮件都加星"时，Agent 可以**先**触发研究型分析评估风险，**再**生成规则草稿，**最后**问用户确认并执行邮件动作——这是三条 SOP 在一次对话里串起来。

### 2.2 主动性与意识

如果 MailTidy 只是"接到指令就执行循环"，它仍然只是一个**工具**——再花哨也只是"自动化 + AI"，没有真正的助手价值。**真正的助手是主动的**：看到一封邮件不止于分类，要去想"这背后还需要查什么"；看到一种模式不等用户问，主动告诉用户。

#### 2.2.1 三个意识层次

| 层次 | 行为 | 说明 |
| --- | --- | --- |
| L1 被动响应 | 用户问什么答什么 | 普通自动化工具止步于此 |
| L2 主动调查 | 执行任务时**自发**判断"这件事还要不要再查"，并去查 | MailTidy 必须做到的底线 |
| L3 主动告知 | 用户没问的时候，识别出值得注意的模式或风险，主动浮出 | MailTidy 真正的目标 |

L1 → L2 的差别：L1 把分类置信度低的邮件直接降级 REPORT_ONLY；L2 会**自己决定**去 `read_email` / `recall_memory` / `web_search`，然后重新分类。

L2 → L3 的差别：L2 是用户触发任务时被动深挖；L3 是 Agent **自己识别**有什么值得告诉用户的事。

#### 2.2.2 主动调查触发条件

Agent 在执行任何任务时，遇到下列情况之一**必须自动触发额外调查**（在工具预算内消耗）。这些触发**不需要用户开启**——它们是 Agent 的**默认本能**，由 policy 层强制激发：

| 触发条件 | 自动做的事 | 输出形式 |
| --- | --- | --- |
| 邮件提到用户关心的实体（FTX、特定客户、家人、项目） | `recall_memory` 历史 + `web_search` 近期事件 | 风险 / 背景说明 |
| 邮件包含链接，且涉及金钱 / 账户 / 验证 | 检查域名是否与官方一致，比对历史合法发件人 | 防钓鱼提示 + 风险评级 |
| 邮件要求在某时间前完成动作 | 看用户日历是否冲突；recall 历史承诺 | 日程提醒 / 兑现度提示 |
| 邮件涉及一笔扣费 | 查是否在已知订阅列表，与上月金额对比 | 异常费用提示 |
| 邮件提到"我之前发的那份文档"等模糊指代 | 搜索最近往来邮件确认是否真有此事 | 上下文补全 / 钓鱼判断 |
| 分类置信度 < 0.7 | `read_email` 全文 + `recall_memory` 历史 | 重新分类 |
| 同一发件人短时间内多封邮件 | 串成 thread 一起判断意图 | 聚合摘要 |
| 邮件意图不明显但用词紧急 | 拉对话上下文重新评估 | 修正 urgency |
| 用户显式开启某实体关注 | 该实体相关邮件**默认**触发研究型分析 | 持续背景报告 |

#### 2.2.3 主动告知时机

每次任务结束时，Agent 应额外检查"有没有用户没问但值得告诉的事"，归到报告"主动告知"小节：

- **被忽视的重要邮件**：CEO 这周给你发了 3 封都没回。
- **异常账单**：Notion 这个月扣了两次，金额对不上。
- **可疑钓鱼**：今天有 2 封邮件域名和官方相似但不一致。
- **过期承诺**：你 5 天前答应回复某客户但还没回。
- **长期闲置**：deals@shop.example 你 90 天没看过，要不要批量退订。
- **行为模式**：这周你把 4 封 GitHub 通知都加星了，要不要把这类默认设为 important。
- **Agent 自我反思**：上周我给你的分类有 3 次你后来改了，规则我已经调整。
- **上下文断层**：有人提到"我们昨天的会议"，但我看不到日历记录或确认邮件。

主动告知必须遵守 **"少即是多"**：

1. 一次最多浮出 3 条，按重要性排序。
2. 同一条建议在用户拒绝后 30 天内不再浮出。
3. 用户可以一句"少打扰我"切换到只在高风险时才提醒。
4. 主动告知本身不能触发邮件动作，只能给出建议；执行还是要走主循环 + `ask_user`。

#### 2.2.4 建议的丰富度

每个建议都至少包含 6 个字段。**这是 LLM 真正发挥价值的地方**——普通工具会输出"已加星"，MailTidy 必须输出有上下文、有证据、有风险评估、有替代方案的内容：

| 字段 | 内容 | 为什么必须 |
| --- | --- | --- |
| What | 我建议你做什么 | 用户决策的本体 |
| Why | 我为什么这么建议 | 用户不会信任不解释的 Agent |
| Evidence | 我看到了哪些证据（含来源） | 用户能验证 Agent 没胡说 |
| Risk | 如果做错了会怎样 | 高风险动作必须明示 |
| Alternatives | 还有哪些可选方案 | 避免给用户单一选项 |
| If unsure | 我不确定的地方在哪 | 诚实是 Agent 可信的根基 |

示例（一封 FTX 索赔邮件的完整建议）：

> **What**：建议把这封 FTX 邮件加星、保留未读，并打 `FTX` 标签。暂时不要点邮件里的链接。
>
> **Why**：你过去 4 次都是这样处理 FTX 邮件，且我查到本周确实有合法的 FTX 索赔进展。
>
> **Evidence**：发件人域名 `ftx-claims.com` 与官方 `ftx.com` 不一致；正文指向 BSL 法院公告（已与公开法院文书核对，时间线吻合）；但邮件里"立即认证"的链接指向第三方域名 `verify-ftx-claim.io`。
>
> **Risk**：如果是钓鱼，点击链接可能泄露身份信息或私钥。如果是合法通知，错过可能影响索赔时效。
>
> **Alternatives**：(a) 仅加星不打标签；(b) 直接归档等月度复盘再看；(c) 我替你起草一封"请提供官方验证渠道"的回复草稿。
>
> **If unsure**：我无法 100% 确认这是合法通知还是钓鱼变种。建议你不要直接点链接，从官方 `ftx.com` 入口重新验证；要不要我帮你查官方索赔门户的当前 URL？

#### 2.2.5 主动性的边界

主动不等于失控。三条不能越过的红线：

1. **永远不替用户做不可逆的事**：删除邮件、发邮件、解绑订阅必须经过 `ask_user`。
2. **永远不擅自联网**：`web_search` 调用前必须在 trace 写明"为什么这次需要联网"，受工具预算约束。
3. **永远不假装确定**：不知道就说不知道，"If unsure" 字段不能省略。

#### 2.2.6 Agent 的自我意识

更高一档的主动性是 Agent **意识到自己**的状态：

- 注意到自己最近对某类邮件判断频繁出错，主动提出复盘。
- 注意到自己对某发件人的偏好基于很久之前的反馈，主动问"现在还这么处理吗？"。
- 注意到自己一次任务里调了很多 `web_search` 都没找到有用信息，主动收敛预算。
- 注意到自己被某条用户偏好"锁死"得太严，可能在错过重要邮件，主动提醒用户审视。

这些不是炫技，而是建立用户长期信任的关键：用户会感觉到 Agent 是和自己一起成长的。

### 2.3 LLM 与工具调用

Agent 的智能不来自"我们写的 if-else"，而来自 **LLM 在合适的时机调用合适的工具**。所有工具都通过统一的 `Tool` 接口暴露，LLM 看到的是工具列表、自然语言描述、入参 schema。

#### 2.3.1 初始工具集（v1）

| 工具 | 作用 | 风险等级 | 备注 |
| --- | --- | --- | --- |
| `list_emails(hours, query)` | 拉最近邮件元信息（不含正文） | 低 | 默认入口工具 |
| `read_email(id)` | 读一封邮件的完整正文 | 低 | 懒加载，节省 token |
| `search_email(query, months)` | 全文搜索历史邮件 | 低 | 订阅扫描 / 上下文回溯共用 |
| `classify_email(id, dimensions?)` | 调用分类 LLM 给邮件打 `EmailJudgment` | 低 | 可重复调用做"再分类" |
| `match_rules(id)` | 调用规则引擎尝试匹配并返回结果 | 低 | 规则引擎成果 |
| `web_search(query)` | 联网搜索，用于研究型分析 | 中 | 严格限频，结果落 trace |
| `recall_memory(query)` | 检索发件人偏好、实体记忆、历史决策 | 低 | |
| `update_memory(key, value, reason)` | 写入 / 修改长期偏好 | 中 | 受学习层校验 |
| `save_draft(id, body)` | 保存草稿 | 低 | **永远不发送** |
| `apply_action(id, action, args)` | 邮件动作（archive / label / star / mark_read） | 高 | 高风险动作前必须 `ask_user` |
| `ask_user(question, options?)` | 把任务挂起，向用户提问 | 高 | 用户回答会触发学习信号 |

#### 2.3.2 专用 LLM 层

MailTidy 必须有独立的 `mailtidy/llm/` 层，不能把模型能力散落在 `agent/`、`tools/` 或具体 API adapter 里。它的职责是：**统一抽象、灵活替换、模型路由、调用统计、成本归因、展示数据源**。

目录职责：

| 模块 | 负责什么 |
| --- | --- |
| `llm/base.py` | `LLMClient` 稳定接口、`ModelProfile` 模型画像（provider / context window / 是否本地 / 单价） |
| `llm/router.py` | `LLMRouter` / `ModelRoute`，按 purpose 选择模型：分类可用便宜模型，深度思考用强模型，断网降级到本地 / heuristic |
| `llm/usage.py` | `LLMUsage` / `LLMCallRecord` / `LLMUsageTracker`，记录 input token、output token、预估成本、task_id、step_id、fallback_from |
| `integrations/llm/heuristic.py` | 本地启发式兜底，成本 0，CI / 断网可跑 |
| `integrations/llm/local.py` | 本地模型适配占位：Ollama / LM Studio / llama.cpp server 等 |
| `integrations/llm/openai.py` | OpenAI API adapter |
| `integrations/llm/anthropic.py` | Anthropic API adapter |

替换模型只允许发生在两处：

1. **配置层**：用户选择 `default_model`、不同 purpose 的 route、预算上限，例如 `classify=local-qwen`、`deep_think=gpt-4.1`、`fallback=heuristic`。
2. **adapter 层**：新增一个实现 `LLMClient` 的 client，例如 `LocalLLMClient` / `OpenAILLMClient` / `AnthropicLLMClient`。

Agent 主循环、tools、skills 不能直接 import OpenAI / Anthropic SDK；只能依赖 `mailtidy.llm.LLMClient` 或 `LLMRouter`。这样才能做到：

- 从 OpenAI 切到 Anthropic / 本地模型，不改业务逻辑。
- 同一个任务里混用多个模型，例如"便宜模型粗分 + 强模型复核高风险 + 本地模型兜底"。
- 每次调用都能统一记录 token、耗时、模型、供应商、预估成本，并进入 §2.5 的成本卡。
- 本地模型成本显示为 `$0.00`，但仍显示 token / 耗时 / 模型名，避免"免费但不可观测"。

成本与展示必须使用 `LLMCallRecord` 作为原始数据，不能靠报告字符串临时拼：

```json
{
  "task_id": "cleanup-2026-05-11-001",
  "step_id": "step-004",
  "purpose": "classify_email",
  "model": "local-qwen3-8b",
  "provider": "local",
  "input_tokens": 1200,
  "output_tokens": 180,
  "estimated_cost": 0,
  "fallback_from": "openai-default"
}
```

#### 2.3.3 LLM 角色边界

**LLM 真正负责的事**（决策中枢）：

1. **决定下一个工具**：`confidence < 0.7` 时主动 `read_email` 拉全文重判，而不是降级 REPORT_ONLY。
2. **理解模糊语言**：用户说"放好"，LLM 推断为加星 + 保留未读 + 打标签 + 询问确认。
3. **做研究综合**：把 `web_search` 多个结果与邮件正文对比，给出风险评级和"为什么"。
4. **生成自然语言反馈**：动作背后的"为什么"讲给用户听。
5. **决定何时停**：任务完成、不确定到必须问用户、或预算耗尽时主动收尾。

**LLM 不该做的事**（受限）：

- 直接产出最终归档列表，必须经过 policy / 规则 / 用户确认三道闸门。
- 调用 `apply_action` 而绕过 `ask_user`（高风险动作）。
- 自己决定要不要联网，必须经过 policy 判断"这封邮件需要研究"。
- 直接修改用户长期偏好，必须经过学习层校验（详见 §4.3）。

### 2.4 决策、确认与规则

#### 2.4.1 决策模型

每封邮件先得到一个判断结果 `EmailJudgment`：

```json
{
  "category": "actionable",
  "confidence": 0.91,
  "urgency": 4,
  "reason": "对方要求今天完成审批",
  "action_suggestion": "star_and_keep_unread",
  "requires_confirmation": false,
  "custom_dimensions": {
    "project": "Hiring",
    "needs_reply": true
  },
  "suggestion": {
    "what": "加星并保留未读，今晚下班前必须回复",
    "why": "...",
    "evidence": ["..."],
    "risk": "...",
    "alternatives": ["..."],
    "if_unsure": "..."
  }
}
```

`suggestion` 是 Phase 1 之后的必填富建议结构，6 字段定义见 §2.2.4。

Agent 把多封邮件合并成一个执行计划 `AgentPlan`：

```json
{
  "intent": "inbox_cleanup",
  "steps": [
    {"action": "label", "email_ids": ["1", "2"], "label": "Newsletters"},
    {"action": "archive", "email_ids": ["3"], "requires_confirmation": true}
  ],
  "human_prompts": [
    "发现 1 封高置信度促销/垃圾邮件，是否归档？"
  ]
}
```

这个设计让 MailTidy 先"想清楚要做什么"，再执行动作。

#### 2.4.2 确认策略

默认策略偏保守：

- 垃圾 / 促销邮件只有在置信度高于 `0.85` 时才进入归档计划。
- 默认归档前需要用户确认，除非用户开启自动归档偏好。
- 默认永不删除邮件。
- 默认永不自动发送回复，只保存草稿。
- `important` 和 `actionable` 邮件加星标，并保持未读。
- 低优先级系统通知只有在高置信度时才标记已读。
- 不确定的邮件只进入报告，不激进处理。

#### 2.4.3 自定义规则引擎

用户应该可以直接用自然语言告诉 Agent 自己的偏好。规则引擎独立于主流程（`mailtidy/rules/`），Agent 在分类后、生成执行计划前调用 `match_rules` 工具进行覆盖、补充或降级。

##### 自然语言加规则

例如用户说：

```text
ftx 的邮件都放好。
```

Agent 推断：

- **规则对象**：发件人、域名、主题或正文中包含 `ftx` 的邮件。
- **用户意图**："放好"通常表示不要丢、不要归档到看不见的位置。
- **默认动作**：打标签 `FTX`，保留未读或不自动归档。
- **风险判断**：`FTX` 涉及交易所、资产、法律风险，应提高重要性。
- **不确定点**：是否加星、是否保持未读、是否进入财务标签。

Agent 生成一个待确认规则：

```json
{
  "source_text": "ftx 的邮件都放好",
  "name": "ftx_mail_keep_organized",
  "conditions": {
    "sender_or_domain_contains": "ftx",
    "subject_or_body_contains": "ftx"
  },
  "classification_override": "important",
  "actions": [
    {"type": "label", "label": "FTX"},
    {"type": "star"},
    {"type": "keep_unread"}
  ],
  "risk_level": "medium",
  "requires_confirmation_before_create": true,
  "clarifying_question": "我理解为：以后和 FTX 相关的邮件都加星、保持未读，并打上 FTX 标签。这样可以吗？"
}
```

如果用户表达更明确（"以后 boss@company.com 的邮件都加星并保持未读"），Agent 可以直接创建规则，并在创建后告知用户。

##### 规则类型

- **发件人规则**：来自某人、某域名、某组织的邮件。
- **主题/正文规则**：包含某些关键词、项目名、订单号、客户名。
- **语义规则**：例如"像客户投诉的邮件"、"和融资相关的邮件"。
- **动作规则**：加星、保持未读、归档、打标签、转入摘要。
- **提醒规则**：当天提醒、日报置顶、需要确认。
- **禁止规则**：永不删除、永不自动归档、永不标记已读。
- **研究规则**：遇到某类邮件时需要联网搜索和分析。

##### 规则冲突处理

规则可能冲突（例如"GitHub 通知都标记已读" vs "GitHub CI failed 算重要"）。处理原则：

1. 更具体的规则优先于更宽泛的规则。
2. 用户新规则优先于旧规则，但要保留历史。
3. 安全 / 财务 / 法务相关规则优先级更高。
4. 不确定时进入报告或请求确认，不静默执行高影响动作。

#### 2.4.4 研究型分析

某些邮件需要外部信息、时效性判断或背景分析。Agent 应能识别并触发研究，而不是只输出"重要"。

##### 何时触发研究

- 金融、交易所、订阅、价格、退款、账单异常。
- 安全告警、数据泄露、账号风险、可疑登录。
- 法务、政策、合规、税务、签证、保险等高风险邮件。
- 新闻事件相关邮件（公司公告、裁员、产品关停）。
- 邮件中提到用户不熟悉的公司、产品、域名、活动。
- 邮件要求用户点击链接、转账、验证身份或提供敏感信息。
- 邮件内容依赖当前事实（"服务将在某日期关闭" / "价格即将上涨"）。

##### 研究计划与邮件动作分离

Agent 必须把研究和邮件动作分两个 plan，避免"研究失败就什么都不做"或"还没研究就动了邮箱"：

```json
{
  "research_plan": [
    {"query": "FTX creditor claim distribution official 2026"},
    {"query": "sender domain legitimacy check"}
  ],
  "email_action_plan": [
    {"action": "label", "label": "FTX"},
    {"action": "star"},
    {"action": "keep_unread"}
  ]
}
```

研究完成后，再更新解释、风险等级和建议动作。

##### 研究输出的格式

研究输出**复用 §2.2.4 的 6 字段富建议格式**（What / Why / Evidence / Risk / Alternatives / If unsure）。**Evidence 字段必须列出来源**，让用户能自己核对。

##### 防钓鱼专项

钓鱼邮件是研究型分析的最高优先级使用场景。示例：FTX 仿冒邮件，发件人域名 `ftx-claims.com` 与官方 `ftx.com` 不一致，链接指向 `verify-ftx-claim.io`。这种邮件必须：

1. 联网搜索确认官方渠道与近期事件。
2. 对比邮件域名与官方域名。
3. 输出风险评级（高 / 中 / 低）。
4. **高风险必须用户确认，亲自处理**，Agent 不擅自动手。

### 2.5 透明度与掌控感

让用户始终感觉**"尽在掌握"**，而不是**"黑箱在跑"**。这一节是产品层面对 Agent 的硬要求：哪怕功能再强、判断再准，只要用户不知道 Agent 此刻在做什么、花了多少钱、为什么这么做，信任就会崩。MailTidy 的设计原则是 **"宁可信息过载也不静默"**——用户可以选择"少看"，但 Agent 不能选择"少说"。

#### 2.5.1 透明的 5 个核心维度

| 维度 | 用户应该随时能回答 | 反面案例 |
| --- | --- | --- |
| 进度透明 | "Agent 现在跑到哪一步了？" | "我点了 cleanup，半天没动静" |
| 成本透明 | "本次任务花了多少 token / 多长时间？还剩多少预算？" | "怎么这个月账单这么多" |
| 思考透明 | "Agent 为什么做这个决定？" | "它把我邮件归档了，我都不知道为什么" |
| 动作透明 | "Agent 已经动了什么、还要动什么？" | "我邮箱里多了一堆标签，谁干的？" |
| 控制透明 | "我现在能干预吗？怎么干预？" | "想停下来不知道按什么键" |

#### 2.5.2 默认必须显示的信息（用户不开任何选项就能看到）

任务运行期间（CLI 进度行或 UI 状态卡）必须实时显示：

```text
[cleanup-2026-05-11-001] round 2/4 · 18/30 emails · 12K/50K token · 42s/120s · 4 actions queued · q=cancel
```

每个字段都对应一项透明度：

| 字段 | 含义 |
| --- | --- |
| `task_id` | 任务唯一标识，可在 `.mailtidy/tasks/` 找到原始记录 |
| `round X/Y` | 当前在执行节奏（§2.1.4）的第几轮 |
| `processed/total` | 已处理 / 总待处理邮件数 |
| `tokens used/budget` | 累计 LLM token 消耗 / 本次任务上限 |
| `wall time used/budget` | 已耗时 / 本次任务上限 |
| `actions queued` | 待用户确认的高影响动作数 |
| `q=cancel` 提示 | 随时可中断 |

任务结束后的报告默认必含的"成本卡"（见 §4.4.5 报告 schema 的扩展）：

```text
本次任务用了 14,320 token / 50,000 上限（28.6%）
LLM 调用 6 次（OpenAI gpt-4o-mini × 5 + heuristic × 1 兜底）
工具调用 11 次（list_emails ×1 / classify_email ×8 / read_email ×2）
耗时 38 秒 / 120 秒上限
预估成本：约 $0.018（按当前模型公开价）
本月累计：$0.42 / 168K token / 31 个任务
```

#### 2.5.3 可选展开的信息（用户主动打开才看）

| 层 | CLI 标志 / UI 操作 | 内容 |
| --- | --- | --- |
| L0 摘要 | 默认 | 报告里的数字统计 + 富建议明细 |
| L1 思考流 | `--show-thinking` / UI "查看思考" | 每一步 `thought` 摘要、调用了哪个工具、为什么 |
| L2 工具调用细节 | `--show-tools` | 每次工具的 `args` 与 `observation` 摘要 |
| L3 摘要演变 | `--show-compression` | 每轮 `working_summary` 的版本、压缩前后字符数、丢弃了什么 |
| L4 原始记录回查 | `--show-source-reads` | 哪些原始邮件 / trace 步 / 历史决策被回查、读了多长片段 |
| L5 全 trace | `--trace-full` 或读 `.mailtidy/traces/<task_id>.jsonl` | 每一步的完整 thought / args / observation / exit_check |

设计要点：

- **默认值偏静**：日常使用不会被刷屏；用户不需要"配置才能用得舒服"。
- **逐层加深**：用户只为感兴趣的部分付出认知成本，不存在"要么全黑要么全开"。
- **永不藏 L0 / 成本卡**：哪怕用户开了 `--quiet`，任务结束的成本卡和已执行动作清单也必须显示。

#### 2.5.4 思考流的格式

`--show-thinking` 打开时，每一步以一行结构化摘要呈现：

```text
[02] thought: 这封 FTX 邮件域名可疑，需要核对官方域名
     tool:    domain_check(sender="ftx-claims.com", official="ftx.com")
     obs:     mismatch=true, similarity=0.78
     budget:  tokens 9.2K/50K, steps 2/12
     exit:    none
```

要求：

1. **思考摘要 ≤ 200 字**：避免出现整段未压缩 prompt；超长由 `agent/compression.py` 截断 + 省略号。
2. **必带 `budget` 行**：让用户实时看到这一步花了多少。
3. **必带 `exit` 行**：让用户看到主循环退出条件检查的结果（`none` / `step_budget_warn` / `tool_failure` 等）。
4. **思考流 ≠ 原始 prompt**：默认不暴露 system prompt 与原始邮件正文，避免泄露隐私；`--trace-full` 才能看到带脱敏的完整版本。

#### 2.5.5 Token 与成本透明度

成本透明分四层：

| 层 | 触发时机 | 内容 |
| --- | --- | --- |
| 实时 | 任务运行中 | 进度行里的 `tokens used/budget` 刷新（每步更新） |
| 任务级 | 任务结束的报告 | 本次成本卡（token / 调用次数 / 耗时 / 预估金额 / 降级了几次） |
| 历史 | `mailtidy cost --since 2026-05-01` | 每天 / 每周 / 每月累计 token、按任务 / 按模型 / 按 SOP 拆分 |
| 预警 | 触发阈值时 | "本月已用 80% 预算" / "本次任务预计将超过 token 预算"——通过主动告知通道推送 |

**重操作必须先估再做**：任何 `web_search`、跨实体研究、批量深读，调用前都要通过 `estimate_cost(tool, args)` 估出 token / 耗时 / 预估金额，并在思考流里明示，超过阈值就归到"重操作清单"等用户拍板（见 §2.1.4 第四轮）。

**成本归因必须完整**：每次 LLM 调用、每次工具调用都要附 `task_id` + `step_id`，让用户在历史视图能点到"这 4K token 是哪一步花的"——不能出现"这个月 $5 不知道花在哪"。

#### 2.5.6 用户的掌控权（控制面）

用户可以在三个时间点干预：

| 时间点 | 能力 | 实现 |
| --- | --- | --- |
| 任务开始前 | 预览计划、调整本次预算、选择模型、强制 dry-run、加 `--quiet` / `--verbose` / `--paranoid` | CLI flag + UI 任务对话框 |
| 任务运行中 | 随时取消（已执行的安全动作保留）、随时切到 dry-run、随时降级到 heuristic | `q` 键 / `mailtidy task cancel <task_id>` / 信号处理 |
| 任务结束后 | 撤销刚才的动作、回滚学习偏好、删除某条决策日志、把建议标记"以后别再提" | `mailtidy memory rollback <id>` / 报告里的"撤销"链接 |

三个全局态度开关：

| 开关 | 含义 |
| --- | --- |
| `--paranoid` | 凡是高 / 中风险动作都问，不信任记忆里的"用户已确认过"，适合刚接入真实邮箱时 |
| `--quiet` | 主动告知最多 1 条 / 任务，且只在高风险时浮出 |
| `--verbose` | 默认就开思考流 + 工具细节，适合 debug |

**每个开关都必须可在任务级覆盖全局**——比如全局 `--quiet` 但本次想看全过程，可以单次 `mailtidy run-cleanup --verbose`。

#### 2.5.7 反黑箱的 7 条硬约束

下面 7 条是 **§2.1.6 第 14 条"用户透明"的展开**，必须在 `agent/loop.py` 里强制：

1. **任何动作都必须有 `why`**：`apply_action` / `update_memory` / `web_search` 调用记录都必须带一个 ≤ 200 字的人类可读理由。无理由的动作直接拒绝执行。
2. **任何降级都必须明示**：见 §2.1.5；降级写入 trace 同时通过主动告知告诉用户。
3. **任何不可逆动作前必须 `ask_user`**：archive / 偏好写入 / 联网搜索的首次使用都属于此类。
4. **任何回查原始记录都必须留痕**：见 §2.1.2 上下文压缩，回查记录进入报告的"L4 原始记录回查"段。
5. **任何 token 消耗都必须可追溯到 `(task_id, step_id, tool_name)`**：未归因的消耗视为 bug。
6. **后台任务的所有自动决策都必须在下次报告里复述**：cron 跑了什么、自动续了什么、自动降级了什么。
7. **静默 ≠ 透明**：Agent 不允许"做得对就不解释"。即使本次完全顺利，也要在报告里写"本次未触发任何降级 / 未联网 / 未读取邮件正文"，让用户看到 Agent 也愿意承担"无事发生"的解释成本。

#### 2.5.8 工程落点

这一节直接对应到代码：

- `llm/usage.py`：LLM 调用记录、token 统计、按模型 / provider 聚合，作为成本卡的数据源。
- `llm/router.py`：按任务 purpose 选择模型、记录 fallback_from，支撑"本地 / API 灵活替换"。
- `agent/state.py`：实时进度、预算消耗字段，必须能被 UI / CLI 轮询读取。
- `agent/trace.py`：每一步思考流落盘格式，对应 `--show-thinking` 输出。
- `ops/cost.py`（待新增）：`estimate_cost`、按 `(task_id, step_id, tool_name)` 累计 token、月度汇总、预警。
- `interfaces/cli.py`：进度行渲染、`--show-thinking` / `--show-tools` / `--quiet` / `--verbose` / `--paranoid` 等 flag 处理。
- `interfaces/prompts.py`：`mailtidy task cancel` / `mailtidy memory rollback` 等控制面命令。
- `data/reports.py`：扩展报告 schema，新增"成本卡"、"思考流摘要"、"撤销链接"段（详见 §4.4.5）。

---

## 三、Skills（SOP 详细）

四条 SOP 是 Agent 主循环中可以被组合调用的高层任务。它们在 Phase 1 之前是独立 CLI 命令，Phase 1 之后会被改造成 agent_loop 的 entry-points，并支持互相调用。

### 3.1 SOP 1：收件箱清理

**输入**：

- 最近 24 小时邮件或最近 N 封未读邮件。
- 用户记忆。
- 用户自定义维度。

**流程**：

1. 获取候选邮件。
2. LLM / 启发式分类。
3. 应用用户记忆和置信度阈值。
4. 生成执行计划（按 §2.4.1 决策模型）。
5. 对批量归档等动作请求确认。
6. 执行安全动作。
7. 生成清理报告（按 §4.4.5 完成报告 schema）。
8. 根据用户反馈更新记忆（按 §4.3 学习层）。

**输出**：

- 总处理数量、各类动作数。
- 需要用户处理的邮件列表。
- 今日 newsletter 摘要。
- token 和成本估算。

### 3.2 SOP 2：智能回复草拟

**输入**：

- 被标记为 `actionable` 的邮件。
- 邮件完整正文和对话上下文。
- 用户写作风格画像（`StyleProfile`）。

**规则**：

- 匹配用户语气和语言习惯。
- 不编造事实。
- 不确定的地方用 `[需要你补充]` 标记。
- 可以建议 reply / reply-all / forward，但**不自动发送**。
- 只保存到草稿箱。

### 3.3 SOP 3：订阅费扫描器

**输入**：

- 最近 6 个月内与扣费、账单、订阅、续费有关的邮件。

**流程**：

1. 提取服务名、金额、币种、扣费周期、扣费日期、套餐、类别、退订链接。
2. 按服务去重，保留最新记录。
3. 计算月度和年度总支出。
4. 标记长期没有交互的疑似闲置订阅。
5. 导出 Markdown 和 CSV 报告。

**产品冲击点**：第一次运行要让用户直接看到隐藏成本，例如："你每月有 12 个订阅，共支出 $87。"

### 3.4 SOP 4：邮件摘要日报

**输入**：

- 昨晚到今天早晨的未读邮件。

**流程**：

1. 为每封邮件打 1-5 分紧急度。
2. 分为"今天要处理" / "本周内重要" / "知悉即可"。
3. 输出发件人、主题、一句话摘要和建议动作。
4. 推送到 Telegram / Slack / 桌面通知 / 邮件。

---

## 四、Data（数据与持久化）

整个 MailTidy 的数据可以分成 5 类，每类有自己的存储位置、读写时机和清理策略：

| 类别 | 内容 | 节 |
| --- | --- | --- |
| 邮件分类与判断维度 | 默认 7 类、用户自定义维度、`EmailJudgment` schema | §4.1 |
| 记忆层 | 偏好 / 规则 / 实体 / 决策日志 / 任务记录 / 订阅历史 / Trace | §4.2 |
| 学习层 | 信号 → 偏好更新、安全边界、产出形式 | §4.3 |
| 任务记录 | 每次 Agent 执行的生命周期与报告 | §4.4 |
| 存储与安全 | 物理布局、OAuth、隐私、用户的"忘记"权 | §4.5 |

### 4.1 邮件分类与判断维度

#### 4.1.1 默认 7 类分类

- `important`：需要用户亲自关注的重要邮件。
- `actionable`：需要回复、审批、注册、安排时间或执行某个动作。
- `newsletter`：订阅内容、资讯推送。
- `promotion`：营销、促销、折扣。
- `notification`：系统通知（GitHub、Slack、银行、安全提醒）。
- `spam`：垃圾邮件。
- `transactional`：订单确认、物流、收据、账单、发票。

#### 4.1.2 用户自定义维度

除了默认分类，用户可以增加自己的判断维度：

- 发件人重要性
- 项目或客户
- 是否需要回复
- 是否涉及费用、账单或报销
- 是否与家庭、私人事项有关
- 是否在等待对方
- 是否涉及法务、财务、安全风险

这些维度不是简单映射到文件夹，而是作为 Agent 决策时的上下文。例如同样是 GitHub 通知，有的用户认为是低优先级，有的用户认为 CI 失败必须当天处理。

### 4.2 记忆层

记忆是"存"，不是"学"。它的责任只有一个：把过去发生过的事忠实记录下来，让上层的学习层、规则引擎、Agent 主循环都能查到。**不要在记忆层里塞决策逻辑。**

#### 4.2.1 内容分层

| 层 | 内容 | 何时写 | 何时读 |
| --- | --- | --- | --- |
| 偏好层 | 发件人偏好、动作偏好、写作风格 | 学习层主动写入 | 每次 Agent 运行 |
| 规则层 | 用户自定义规则（结构化 + 原始自然语言） | 用户加规则 / 学习层提议 | 每次 Agent 决策 |
| 实体层 | 用户关心的实体（FTX、某客户、某项目）及其默认处理方式 | 研究型分析 / 用户高频交互 | 研究型分析 / 风险评级 |
| 决策日志 | 每个 `EmailJudgment` + 最终动作 + 用户反馈 | Agent 每次 act 后 | 学习层、单测、用户复盘 |
| 任务记录 | 每次 Agent 执行的 goal / progress / checkpoints / status / 报告路径 | 任务创建、checkpoint、退出 | 启动恢复检查、完成报告、跨任务关联 |
| 订阅历史 | 历次订阅扫描结果 | 订阅扫描结束后 | 月度对比 |
| Trace | Agent 主循环的完整 thought / tool / observation | 主循环每一步 | 调试、回放、安全审计 |

实体层示例：

```json
{
  "entity": "FTX",
  "entity_type": "company_or_case",
  "user_interest": "high",
  "default_actions": ["label:FTX", "star", "keep_unread"],
  "research_required": true,
  "trusted_sources": ["official claims portal", "court docket", "major financial news"],
  "last_user_feedback": "wants careful verification before clicking links"
}
```

### 4.3 学习层

学习层的核心是 **"用户的一次行为 → 长期偏好的一次小幅更新"**。它独立于 Agent 主循环存在，运行时机有两类：

- **同步学习**：用户在主循环里给出明确反馈（确认 / 拒绝 / 修改草稿）时立即生效。
- **异步学习**：每天 / 每周扫一次决策日志，统计模式，主动**提议**新规则或偏好（不擅自写入）。

#### 4.3.1 学习信号清单

| 信号 | 来源 | 默认更新 | 安全约束 |
| --- | --- | --- | --- |
| 用户连续确认归档某发件人 | `ask_user` | 该发件人 archive 偏好 +0.05，下次少问 | 至少 3 次且都在 14 天内 |
| 用户拒绝归档某发件人 | `ask_user` | 该发件人 archive 倾向 -0.1，永久例外 | 立即生效 |
| 用户修改草稿后实际发送 | `save_draft` 后用户外部发送 | 微调 `StyleProfile`（语气、长度、签名、开头、结尾） | 仅在用户**真的发送**后才学 |
| 用户长期不打开某发件人 | 决策日志统计 | `importance_delta -1` | 至少 30 天连续未打开 |
| 用户经常给某发件人加星 / 回复 | 决策日志统计 | `importance_delta +1`，并提议归类为 ACTIONABLE | 至少 5 次在 14 天内 |
| 用户对研究分析采纳建议 | `ask_user` | 实体的 `trusted_sources` 加权 | 仅采纳过的来源加权 |
| 用户对研究分析提出反例 | `ask_user` | 同实体相似邮件下次必须人工确认 | 立即生效 |
| 用户用自然语言加规则 | CLI / UI | 解析为结构化规则；模糊处生成澄清问题 | 高风险规则必须确认才入库 |
| 用户连续 N 次给某发件人邮件打同一标签 | 决策日志 | 提议创建结构化规则 | N ≥ 3 |

#### 4.3.2 学习的安全边界

学习层最大的风险是"学错了"——一次误操作就把某发件人永久打入冷宫。为此设三道闸门：

1. **冷却期 + 单次上限**：每次反馈对偏好的影响有上限（`importance_delta` 单次最多 ±1），需要多次同向反馈才会累积。
2. **可解释 + 可撤销**：每条偏好都附带 `learned_from` / `learned_at` 元数据，记录"基于哪几次反馈、什么时候学的"，用户可以一键回滚到学习之前。
3. **危险偏好需要二次确认**：例如"自动删除某发件人的所有邮件"绝对不能学出来，只能用户显式开启。所有"破坏性"偏好都属于这一档。

#### 4.3.3 学习的产出形式

学习不是默默改字段，而是**在合适时机告诉用户**：

- "我注意到最近 4 次你都把 FTX 邮件保留未读 + 加星，要不要让我以后默认这样处理？"
- "你已经连续 30 天没打开 deals@shop.example，要不要把它们自动归档？"
- "你修改了 5 封草稿都加上了 'Cheers,'，要不要把签名改成这个？"

只有用户答 yes 才真正写入偏好。这样学习是**透明的**——用户对 Agent 的信任来自可解释，而不是黑盒猜对。

### 4.4 任务记录与生命周期

每一次 Agent 执行，都是一个**有名字、有目标、有进度、有最终产出**的"任务"。任务记录系统让 Agent 具备三件事：

1. **目标可追溯**：任何时刻都能回答"我现在到底在干什么、为什么干"。
2. **中断可恢复**：进程崩溃 / 用户取消 / 预算耗尽，下次启动时能精确接着干。
3. **完成可复盘**：每个任务都产出一份和它一一对应的报告，事后能回查。

**Agent 永远不允许处于"内存里在跑、磁盘里没记录"的状态。**

#### 4.4.1 生命周期

```text
created
  │
  ▼
running ──── checkpoint ──── checkpoint ──── checkpoint ────┐
                                                            │
            ┌──────────┬──────────────┬─────────┬───────────┤
            ▼          ▼              ▼         ▼           ▼
        finished   waiting_user   exhausted   failed   interrupted
        (写完成报告) (挂起等回复)   (预算耗尽)  (致命错误) (崩溃/取消)
                                  └────── 写半成品报告 ────────┘
```

#### 4.4.2 任务记录字段

每条任务记录是一个 JSON 文件，存放在 `.mailtidy/tasks/<task_id>.json`：

```json
{
  "task_id": "cleanup-2026-05-11-001",
  "kind": "inbox_cleanup",
  "created_at": "2026-05-11T08:00:00Z",
  "started_at": "2026-05-11T08:00:01Z",
  "updated_at": "2026-05-11T08:00:45Z",
  "status": "running",

  "goal": {
    "description": "清理最近 24 小时未读邮件",
    "scope": { "hours": 24, "limit": 200, "unread_only": true },
    "user_request": null,
    "parent_task_id": null
  },

  "progress": {
    "phase": "round_2_medium",
    "total_emails": 30,
    "processed_emails": 18,
    "pending_emails": ["m19", "m20", "m21"],
    "pending_heavy_ops": ["deep-research-ftx-001"],
    "completed_actions": [
      { "action": "label", "ids": ["m2", "m7"], "label": "Newsletters" },
      { "action": "star", "ids": ["m1", "m4"] }
    ],
    "remaining_budget": { "steps": 4, "tokens": 12000, "wall_seconds": 60 }
  },

  "context_snapshot": {
    "judgments_so_far": [],
    "memory_snapshot": ".mailtidy/snapshots/memory-2026-05-11-08-00.json"
  },

  "checkpoints": [
    { "at": "2026-05-11T08:00:15Z", "phase": "round_1_done",   "elapsed_ms": 14000 },
    { "at": "2026-05-11T08:00:35Z", "phase": "round_2_started" }
  ],

  "exit_reason": null,
  "report_path": null,
  "trace_path": ".mailtidy/traces/cleanup-2026-05-11-001.jsonl"
}
```

四个关键字段：

- **goal**：任务的"初心"——描述、参数、用户原始指令、父任务 ID。即使中断后也能完整复述"我本来要做什么、为什么发起"。
- **progress**：执行到哪一阶段、还剩什么没做、还有多少预算。这是恢复的依据。
- **context_snapshot**：开始时的记忆快照路径，确保恢复时按原始上下文继续，避免"中途学到的东西回头改写了上半场判断"。
- **checkpoints**：每个关键阶段写一次时间戳，让恢复时能精确定位。

#### 4.4.3 写入时机

| 时机 | 写什么 |
| --- | --- |
| 任务创建（用户敲 CLI / 定时器触发 / UI 点击） | `created` 状态、goal、空 progress |
| 任务正式开始 | `started_at`、`running` 状态、记忆快照 |
| 每轮节奏切换（round_1_done / round_2_started 等） | 一个 checkpoint |
| **每次工具调用前** | 当前要做什么写到 progress.phase，避免崩溃后不知道上次卡在哪 |
| 每次完成一封邮件的处理 | 把 ID 从 `pending_emails` 移到 `processed_emails` |
| 触发任一退出条件 | 终态、`exit_reason`、`report_path` |
| `ask_user` 挂起 | `waiting_user` 状态 + 待回答的问题 |
| 进程异常退出（atexit hook 或外部监控） | 至少把 `status: interrupted` 和最后时间写进去 |

写入采用 **"写整个新文件 + 原子 rename"**（不就地修改），保证文件破损时可以回退到上一个版本。每个任务保留最近 N 个版本（默认 3 个）。

#### 4.4.4 启动恢复检查

每次 Agent 启动（CLI 跑命令、定时任务触发、用户打开 UI）都必须先做一次"恢复检查"，把它作为主循环的第 0 步：

```text
1. 扫 .mailtidy/tasks/ 下所有 status ∉ {finished, failed, interrupted_acknowledged} 的记录。
2. 按状态分类：
   - running：上次崩溃了，没正常收尾  → 标记为 interrupted。
   - exhausted：上次用完预算停了      → pending 里有未完成项。
   - waiting_user：上次问了用户没回答 → 等用户答。
3. 给用户展示一个简短列表（按更新时间倒序）：
      [resumable] cleanup-2026-05-11-001 (中断于 round_2_medium，处理了 18/30 封)
      [waiting]   cleanup-2026-05-10-002 (等你回答："要不要把 FTX 邮件加星？")
4. 让用户选择每条：
      [r] 恢复跑完 / [c] 继续从断点 / [s] 跳过本次 / [d] 丢弃这条记录
5. 选 [r] 或 [c] 时按 context_snapshot 重建状态、跳过 completed_actions、从 progress.phase 接着跑。
```

**[r] 恢复 vs [c] 继续**：

- **恢复 (resume)**：完全重放剩余步骤，包括重判已经判过但用户中断时还没确认的邮件——适合"上次中断时间太久，世界变了"。
- **继续 (continue)**：信任上次的所有判断，直接从下一步开始，跳过重判——适合"刚刚崩了，立刻接着跑"。

主循环代码必须区分这两个语义，让用户明确选择，不能默默挑一个。

**非交互场景的默认行为**（cron / 后台任务用）：

- `running` 状态 + `updated_at` 超过 N 分钟（默认 10）：标记为 `interrupted`，挂到 `pending_tasks` 等用户下次手动恢复。
- `exhausted` 状态：自动续跑（仅当新任务参数兼容、未超出新一轮预算）。
- `waiting_user`：**永远不自动续跑**，必须用户回答。

非交互场景的所有自动决策都要写进下一份报告的"主动告知"小节，让用户知道"我后台帮你做了什么决定"。

#### 4.4.5 完成报告 / 半成品报告

任务正常 finished 时，写一份**完成报告**到 `.mailtidy/reports/<task_id>.md`，与任务记录通过 `task_id` 1:1 关联：

| 段落 | 内容 |
| --- | --- |
| 任务摘要 | goal 复述：我本来要做什么 |
| 数字统计 | processed / archived / labeled / starred / drafts ... |
| 需要你关注 | IMPORTANT / ACTIONABLE 的邮件清单 |
| 主动告知 | 被忽视的重要邮件、异常账单、可疑钓鱼、过期承诺等（最多 3 条） |
| 富建议明细 | 每个建议的 6 字段：What / Why / Evidence / Risk / Alternatives / If unsure |
| 重操作清单 | 待用户决定的深研究任务（含 estimated_cost / user_choice） |
| 学习提议 | "我注意到 ... 要不要 ...？" |
| 降级说明 | 本次是否走了降级、为什么、用了什么替代方案 |
| **成本卡** | token 用量 / 限额、LLM 调用次数（按模型拆分）、工具调用次数（按工具拆分）、耗时 / 限额、预估金额、本月累计（详见 §2.5.5） |
| **思考流摘要** | 默认 5–10 行关键决策点；完整 trace 在 `.mailtidy/traces/<task_id>.jsonl`（见 §2.5.4） |
| **回查记录** | 哪些原始邮件 / 历史 trace / 历史决策被读取过、读了多长片段（见 §2.1.2 L4 限制） |
| **已执行动作 + 撤销入口** | 列出每个 `apply_action` 的 `(action, ids, why)`，并附"撤销"链接 / CLI 命令 |
| **未执行动作** | 因风险 / 预算 / 用户拒绝而**没**做的事，明示原因 |
| 任务关联 | parent_task_id / 衍生出的 child_task_ids |

后五段（成本卡 / 思考流 / 回查 / 已执行 / 未执行）是 §2.5 透明度要求的强制段落，**不能因为本次"没什么可说"就省略**——即使为空也要明示"本次未联网 / 未读取邮件正文 / 未发生降级"，让用户看到 Agent 愿意承担"无事发生"的解释成本。

报告写成功后才会把任务状态置为 `finished`，并把 `report_path` 字段填上——保证"任务标记为完成 ⇔ 报告确实存在"。

任务因为预算耗尽 / 致命错误 / 用户中断收尾时，写一份**半成品报告**到同样目录但文件名加 `-partial` 后缀（`<task_id>-partial.md`），UI / CLI 渲染时也要明显区分。半成品报告比完成报告**多两段**：

- **为什么停了**：`exit_reason` 详细说明（"达到 12 步上限" / "OpenAI API 持续超时" / "用户在 round_2 取消"）。
- **下一步建议**：明确告诉用户"剩下的 N 件事是 ... 会在下次任务里优先处理"。

半成品报告**绝对不能冒充完成报告**——文件名后缀 + UI 标签 + 任务状态三处都要区分。

#### 4.4.6 清理策略

- finished 任务：默认保留 30 天，过期归档到 `.mailtidy/archive/`。
- failed / exhausted 任务：默认保留 90 天，方便用户复盘。
- waiting_user 任务：永不自动清理，但 7 天后开始在主动告知里提醒"还有 N 个任务在等你回答"。
- interrupted 任务：用户在恢复检查里点 [d] 丢弃后才删除；否则永久保留。

用户可以一键 `mailtidy task purge --before 2025-01-01 --status finished` 批量清理。

#### 4.4.7 跨任务关联

同一类任务的多次执行应该能互相引用：

- **决策追溯**：上一次 cleanup 把"FTX 邮件加星"作为依据，下次类似邮件可以引用 `cited_task_ids` 说明"这是参照 cleanup-2026-05-09-001 的判断"。
- **重操作的因果链**：重操作清单里的子任务必须记录 `parent_task_id`。
- **学习偏好的来源**：学习层每次写偏好都带 `source_task_id`。
- **失败诊断**：用户可以查"过去 7 天我所有 cleanup 是不是某条规则导致老失败"。

跨任务关联让 Agent 不再是"每次跑一次都从零开始"——它有连续的、可追溯的工作历史。

### 4.5 存储与安全

#### 4.5.1 物理布局

所有持久化数据集中在 `.mailtidy/` 下，与代码仓库解耦（已 `.gitignore`）：

```text
.mailtidy/
  memory.db            加密 SQLite：偏好 + 规则 + 实体
  memory.json          降级时的备份
  tasks/               任务记录 JSON 文件，按 task_id 命名
  reports/             完成 / 半成品报告 Markdown
  traces/              主循环的逐步 trace（jsonl）
  snapshots/           记忆快照（开始任务时写）
  archive/             过期任务归档
  pending_tasks.json   待恢复 / 待续跑队列
```

#### 4.5.2 OAuth / Token / 隐私

- OAuth scopes 按 SOP 最小化申请，先只读后写，分阶段开放。
- token 存 OS keychain 或 secrets manager，**不明文保存**。
- 邮件正文默认**只在主循环内存中使用**，不落盘到 trace / 决策日志 / 报告。
- Trace 与决策日志只存元数据和摘要，便于事后审计但不泄露隐私。
- 所有破坏性动作默认关闭，必须用户在配置里显式开启。
- 支持 allowlist / blocklist / 按发件人覆盖策略。
- 所有工作流支持 dry-run。

#### 4.5.3 用户的"忘记"权

用户随时可以：

- 导出指定发件人 / 实体 / 任务 / 时间段的全部数据为 JSON。
- 删除指定发件人 / 实体 / 任务的全部记录（含决策日志、trace、偏好）。
- "忘记最近 N 天"：清空近 N 天的决策日志和 trace，但保留偏好与规则。
- 完全清空 `.mailtidy/`，回到初次安装状态。

这些动作必须在 CLI 和 UI 里都直接可达，不能藏在三层菜单里。

---

## 五、工程进度与路线图

### 5.1 目录结构改动

旧版根目录所有职责都堆在 7 个顶层 .py 里：`agent.py` 同时承担 SOP 编排、业务流程入口和部分决策；`memory.py` 同时放偏好、日志、存储；`connectors.py` 把 Mock 与未来真实邮箱混在同一层；`reports.py` 服务多个 SOP 却没有和任务记录打通。本次重构已经按 8 层拆开，**根目录的旧 .py 全部物理删除**，所有调用方（测试、CLI、文档示例）都迁到新路径。

#### 5.1.1 当前结构（搬迁已完成，根目录无遗留）

```text
mailtidy/
  __init__.py             仅 re-export MailTidyAgent
  agent/                  Agent 内核 + legacy.MailTidyAgent + policies.DecisionPolicy
  data/                   核心数据模型、记忆、报告、任务、摘要、数据库
  skills/                 高层 SOP（清理 / 日报 / 订阅扫描 / 草稿）
  tools/                  LLM 可调用工具（命名空间已就位，待 Phase 1 填充）
  rules/                  自定义规则引擎
  research/               研究型分析与防钓鱼
  integrations/           email / llm / notification 适配
  interfaces/             CLI / Web / Desktop（CLI 已实迁）
  ops/                    config / logging / scheduler / audit
tests/
  test_agent.py           5 条测试全部通过，使用新路径导入
.mailtidy/
  memory.json             本地 demo 记忆文件（已 .gitignore）
```

每个旧顶层文件的最终归宿：

| 旧路径 | 新归宿 | 状态 |
| --- | --- | --- |
| `mailtidy/agent.py` | `mailtidy/agent/legacy.py`（`mailtidy.agent` 包 re-export `MailTidyAgent`） | 已删除 |
| `mailtidy/cli.py` | `mailtidy/interfaces/cli.py`（`python -m mailtidy.interfaces.cli`） | 已删除 |
| `mailtidy/connectors.py` | `mailtidy/integrations/email/base.py` + `mock.py` | 已删除 |
| `mailtidy/llm.py` | `mailtidy/llm/` 专用层 + `mailtidy/integrations/llm/` 具体 adapter | 已删除单文件，已升级为包目录 |
| `mailtidy/memory.py` | `mailtidy/data/memory.py` | 已删除 |
| `mailtidy/models.py` | `mailtidy/data/models.py` | 已删除 |
| `mailtidy/policies.py` | `mailtidy/agent/policies.py`（决策属于 Agent 内核） | 已删除 |
| `mailtidy/reports.py` | `mailtidy/data/reports.py` | 已删除 |

> 之前的迁移过程中曾保留过一轮 ≤ 25 行的兼容 shim；由于尚未有外部用户依赖旧路径，本次直接清空 shim，避免日后两套入口分歧。如果未来要为下游再开兼容入口，可在根目录加新的 shim，但**默认主路径只剩包目录分层**。

#### 5.1.2 目标结构（Agent 化后的清晰分层）

目标不是简单多建几个文件夹，而是把职责拆成 8 层：`agent` 负责运行循环，`skills` 负责业务 SOP，`tools` 负责 LLM 可调用能力，`llm` 负责模型抽象 / 路由 / 统计 / 成本归因，`data` 负责模型和持久化，`integrations` 负责外部系统，`interfaces` 负责 CLI/UI/通知，`ops` 负责运行可观测性。

```text
mailtidy/
  __init__.py

  agent/                         Agent 内核：思考、循环、状态、预算、恢复
    __init__.py
    loop.py                      Reason-Act-Observe 主循环（原 agent_loop.py）
    state.py                     AgentState / budget / pending questions
    context.py                   working_summary / evidence_index / 上下文窗口
    compression.py               阶段摘要、摘要再压缩、事实/推断/来源分离
    deep_think.py                深度思考触发、回查计划、结构化结论
    planner.py                   将 LLM 输出解析为下一步 action
    executor.py                  执行 tool call、合并 observation
    exits.py                     9 种退出条件 + 死循环检测
    recovery.py                  启动恢复检查、resume / continue 语义
    trace.py                     thought / tool / observation / exit_check 逐步落盘

  skills/                        业务能力：可被 Agent 调度的 SOP
    __init__.py
    inbox_cleanup.py             收件箱清理
    daily_brief.py               邮件摘要日报
    subscription_scan.py         订阅费扫描
    draft_replies.py             智能回复草拟
    base.py                      Skill 抽象、输入输出 schema、默认预算

  tools/                         LLM 可调用工具：小、稳定、可限频
    __init__.py
    base.py                      Tool 抽象、入参 schema、风险等级、限频策略
    email.py                     list_emails / read_email / search_email / save_draft
    classify.py                  classify_email / reclassify_email
    rules.py                     match_rules
    research.py                  web_search / domain_check
    memory.py                    recall_memory / update_memory
    history.py                   受限回查：read_trace_slice / read_report_summary / read_original_record
    user.py                      ask_user
    actions.py                   apply_action（archive / label / star / mark_read）

  llm/                           专用 LLM 层：模型抽象、路由、统计、成本
    __init__.py
    base.py                      LLMClient / ModelProfile
    router.py                    ModelRoute / LLMRouter（按 purpose 选模型 + fallback）
    usage.py                     LLMUsage / LLMCallRecord / LLMUsageTracker

  data/                          数据模型、数据库、任务记录、记忆与学习
    __init__.py
    models.py                    EmailMessage / EmailJudgment / AgentPlan 等核心模型
    categories.py                邮件分类、风险等级、动作枚举
    memory.py                    记忆层领域对象（偏好 / 实体 / 决策日志）
    learning.py                  学习层：信号 → 偏好更新 + 提议生成器
    tasks.py                     任务记录 JSON schema、状态机、读写
    reports.py                   完成报告 / 半成品报告的数据结构
    summaries.py                 工作摘要、阶段摘要、证据索引、摘要版本
    database.py                  SQLite / SQLCipher 连接、迁移、事务
    repositories.py              PreferenceRepo / TaskRepo / TraceRepo 等数据访问

  rules/                         自定义规则引擎
    __init__.py
    models.py                    规则数据结构
    parser.py                    自然语言规则解析与澄清问题生成
    matcher.py                   匹配 + 优先级 + 冲突处理
    store.py                     规则持久化（后续可并入 data/repositories.py）

  research/                      研究型分析，不直接动邮箱
    __init__.py
    planner.py                   research_plan / email_action_plan 分离
    risk.py                      风险评级（低 / 中 / 高）
    sources.py                   来源可信度、引用整理
    phishing.py                  域名比对、防钓鱼专项逻辑

  integrations/                  外部系统适配
    __init__.py
    email/
      __init__.py
      base.py                    EmailConnector 抽象
      mock.py                    MockEmailConnector
      gmail.py                   GmailConnector（先只读）
      outlook.py                 OutlookConnector
    llm/
      __init__.py
      heuristic.py               HeuristicLLMClient（CI 和降级保底）
      local.py                   LocalLLMClient（Ollama / LM Studio / llama.cpp server）
      openai.py                  OpenAI tool-use 实现
      anthropic.py               Anthropic tool-use 实现
    notification/
      __init__.py
      base.py                    Notifier 抽象
      slack.py
      telegram.py
      desktop.py

  interfaces/                    用户入口
    __init__.py
    cli.py                       CLI 实现，`python -m mailtidy.interfaces.cli` 入口
    prompts.py                   交互式确认、resume / continue 选择
    web/                         未来 Web UI
    desktop/                     未来桌面 UI

  ops/                           运行、观测、配置
    __init__.py
    config.py                    配置加载、预算默认值、路径
    logging.py                   日志格式
    scheduler.py                 cron / launchd 任务调度
    audit.py                     审计日志

  （旧顶层 cli.py / connectors.py / llm.py / memory.py / models.py / policies.py / reports.py / agent.py 已全部物理删除，无 shim）
```

用户数据目录仍然放在 `.mailtidy/`，不进包目录：

```text
.mailtidy/
  memory.db                      加密 SQLite：偏好 + 规则 + 实体
  memory.json                    降级时的备份
  tasks/                         任务记录 JSON 文件
  reports/                       完成 / 半成品报告 Markdown
  traces/                        主循环 trace（jsonl）
  snapshots/                     记忆快照
  archive/                       过期任务归档
  pending_tasks.json             待恢复 / 待续跑队列
```

#### 5.1.3 模块边界

| 层 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| `agent/` | 主循环、预算、退出、恢复、trace、状态推进、深度思考、上下文压缩 | 具体邮箱 API、具体 SOP 业务细节 |
| `skills/` | 收件箱清理、日报、订阅扫描、回复草稿等高层任务 | 直接调用 LLM、直接写数据库、直接动邮箱 |
| `tools/` | 给 LLM 调用的小工具，带 schema、风险等级、限频 | 自己决定业务目标或长期偏好 |
| `llm/` | LLM 抽象、模型路由、token / 成本统计、调用记录、fallback 归因 | 具体供应商 SDK、邮件业务规则 |
| `data/` | 数据模型、任务记录、数据库、记忆、学习、报告 schema、摘要与证据索引 | 直接访问 Gmail / Outlook / Slack |
| `rules/` | 自定义规则解析、匹配、冲突处理 | 执行邮箱动作 |
| `research/` | 外部事实核查、风险评级、防钓鱼 | 直接归档 / 删除 / 发送邮件 |
| `integrations/` | Gmail、Outlook、OpenAI、Anthropic、通知通道适配 | 业务决策 |
| `interfaces/` | CLI、Web、Desktop 的用户交互 | Agent 内核逻辑 |
| `ops/` | 配置、调度、审计、运行日志 | 邮件分类和用户偏好学习 |

#### 5.1.4 迁移顺序

目录迁移不能一次性大搬家，否则测试会断。按下面顺序做，每一步都保持旧入口兼容。✅ 表示已完成，⏳ 表示已建好骨架与占位、待 Phase 1-2 填充实际逻辑：

| 顺序 | 改动 | 状态 | 备注 |
| --- | --- | --- | --- |
| 1 | 新建 `integrations/email/`，迁移 `connectors.py`；新建 `integrations/llm/` 放供应商 / 本地模型 adapter | ✅ | 真实实现已在新位置，旧顶层文件已删除 |
| 2 | 新建 `data/`，迁移 `models.py`、`memory.py`、`reports.py` | ✅ | 真实实现已在新位置，旧顶层文件已删除 |
| 3 | 新建 `skills/`，把 SOP 从 `agent.py` 拆出 | ⏳ | `skills/{inbox_cleanup,daily_brief,subscription_scan,draft_replies}.py` 当前是对 `agent.legacy.MailTidyAgent` 的薄 wrapper；Phase 1 替换成独立实现 |
| 4 | 新建 `tools/`，把 connector / memory / rule / research / action 包成 LLM 可调用工具 | ⏳ | 命名空间已建好，`Tool` schema 与限频是 Phase 1 |
| 5 | 新建 `agent/{loop,state,context,compression,deep_think,exits,recovery,trace}.py` | ⏳ | 文件已建为占位 dataclass / enum；填充逻辑是 Phase 1 主体 |
| 6 | 新建 `rules/`、`research/`，接入 `match_rules` 和 `web_search` 工具 | ⏳ | 模块已建好骨架；逻辑是 Phase 3 |
| 7 | 新建 `interfaces/`、`ops/`，迁移 CLI、配置、调度、审计 | ✅ | `mailtidy.interfaces.cli` 是真实实现，`python -m mailtidy.interfaces.cli` 是新入口 |
| 8 | 把 `policies.py` 归入 `agent/`（决策属于内核） | ✅ | `mailtidy.agent.policies.DecisionPolicy` 是真实实现，旧 `policies.py` 已删除 |
| 9 | 删除根目录所有兼容 shim，把测试 / README / docs 全部切到新路径 | ✅ | 根目录只剩 `__init__.py` 一个文件 |
| 10 | 新建专用 `llm/` 层，承接模型抽象、路由、token / 成本统计 | ✅ | `LLMClient` 已从 `integrations/llm/base.py` 上移到 `llm/base.py`，`integrations/llm/base.py` 已删除 |

旧的顶层 `agent.py` / `cli.py` / `connectors.py` / `llm.py` / `memory.py` / `models.py` / `policies.py` / `reports.py` 全部物理删除，根目录只保留 `__init__.py`。`mailtidy.agent` 是包目录而不是单文件模块，`from mailtidy.agent import MailTidyAgent` 通过 `agent/__init__.py` re-export 自 `agent/legacy.py`。

### 5.2 当前已实现功能

**当前代码是一条流水线 MVP，不是 Agent。** 它验证的是产品形态、模块边界和决策框架，但 LLM 还没有进入决策循环，学习信号也还没接入。

**已完成（流水线层）**：

- `EmailConnector` / `LLMClient` 抽象接口。
- 专用 `llm/` 层：`ModelProfile`、`LLMRouter`、`LLMUsageTracker`、`LLMCallRecord`，为灵活换模型和成本展示打底。
- `MockEmailConnector` 本地模拟邮箱；`HeuristicLLMClient` 关键词回退分类器。
- 邮件分类的 7 类枚举。
- 基于置信度阈值的决策策略（archive ≥ 0.85，mark_read ≥ 0.82）。
- 促销 / 垃圾归档前的批量确认机制（不是逐条问，是整批跳过 / 整批确认）。
- newsletter / actionable / important / transactional 自动打标签 / 加星。
- 清理报告 / 日报 / 订阅 Markdown + CSV 导出。
- 草稿生成 demo（永不发送）。
- 本地 JSON 记忆结构（**只能读写，不会自己学**）。
- CLI demo 与 5 个单元测试。

**未完成**：

- **Agent 主循环**：当前是单次流水线，没有 reason-act-observe 循环；LLM 不能调用工具。
- **工具调用**：connector 的方法不是 Tool 接口，LLM 看不到也调不到。
- **不确定时的再思考**：低置信度邮件直接降级 `REPORT_ONLY`，不会拉全文重判。
- **跨 SOP 联动**：每条 SOP 是独立 CLI 命令，互相不感知。
- **学习层**：所有学习信号都没接入。
- **任务记录与生命周期**：没有任务记录文件、没有恢复检查、没有完成 / 半成品报告区分。
- **自定义规则引擎、研究型分析**：仅在文档里设计，未实现。
- **真实 Gmail / Outlook / OpenAI / Anthropic 接入**。
- **可逐条交互的确认**：`--auto-confirm` 是全局开关，不是每条都问。
- **定时任务、Telegram / Slack / 桌面通知、Web / 桌面 UI**。

**当前能证明 vs 不能证明**：

| 已证明 | 未证明 |
| --- | --- |
| 邮件 → 判断 → 计划 → 执行 → 报告 → 持久化记忆，整条链路通 | LLM 在循环里能稳定地调用工具完成任务 |
| 高影响动作能被确认机制拦下 | 学习信号能让 Agent 越来越贴近用户判断 |
| 抽象接口设计能让 Mock 与真实实现完全对调 | 自定义规则与 Agent 决策能良好协作而不冲突 |
| | 研究型分析能在真实钓鱼邮件场景下不漏报、不误报 |

**可运行命令（仅 demo 模式）**：

```bash
python -m mailtidy.interfaces.cli run-cleanup --demo --dimension needs_reply --dimension project
python -m mailtidy.interfaces.cli daily-brief --demo
python -m mailtidy.interfaces.cli subscription-scan --demo
python -m mailtidy.interfaces.cli draft-replies --demo
python -m unittest discover
```

### 5.3 路线图（Phase 1-5）

**核心顺序**：先 Agent 化、再学习化、再接真实邮箱、最后做 UI。**不能为了快接 Gmail 而跳过 Agent 化**，否则项目沦为"更花哨的 if-else"。

#### Phase 1：Agent 化 + 主动调查 + 退出 + 兜底 + 任务记录（核心，2-3 周）

| # | 工作项 |
| --- | --- |
| 1.1 | 新增 `mailtidy/tools/`，把 connector / 规则 / 记忆 / 研究 / 用户问答全部包成 `Tool` 接口（带描述、schema、风险等级、限频） |
| 1.2 | 新增 `mailtidy/agent/loop.py`，实现 §2.1.6 的 13 条硬约束 |
| 1.3 | 新增 `mailtidy/tasks.py`，实现任务记录读写、生命周期、恢复检查 |
| 1.4 | 把现有 SOP 重写成 agent_loop 的 entry-point，**保持 CLI 兼容** |
| 1.5 | 接入真实 LLM 的 tool-use（OpenAI / Anthropic），保留 `HeuristicLLMClient` 给 CI 用（CI 走假工具 + 固定回放） |
| 1.6 | 实现"主动调查触发器"：把 §2.2.2 的触发条件接入 policy 层，命中时把"建议你接下来调查 X"作为 system 提示注入 State |
| 1.7 | 实现"建议丰富度"输出格式：给 `EmailJudgment` 增加 `Suggestion` 子结构（6 字段） |
| 1.8 | 加 trace / context 单测：低置信度邮件必须触发 `read_email`，含可疑链接的邮件必须触发域名核对；超长 thread 必须先摘要压缩，再按需回查原记录 |

**Phase 1 验收标准（必过）**：

- a. 跑一封 confidence=0.6 的邮件，agent 自发拉全文重判，trace 里能看到完整的"想 → 查 → 再想"过程；输出含 6 字段富建议。
- b. 跑一封伪造域名的邮件，agent 自发触发域名核对，输出含 `Risk` 字段的富建议，**不直接归档**。
- c. **退出条件可验证**：故意制造死循环 / 预算耗尽 / API 失效 / `kill -9` 场景，agent 都能强制收尾、写任务记录终态、写半成品报告，永远不抛异常给用户。
- d. **断点续跑可验证**：跑到一半 `kill -9` 主进程，下次启动时恢复检查必须发现这条 `interrupted` 任务并提示用户 [r]/[c]/[s]/[d]；选 [c] 继续后必须从 `progress.phase` 接着跑，已 completed 的动作不会重复。
- e. **轻先重后可验证**：30 封邮件清理任务的 trace 必须能看到"第一轮分类轻操作 → 第二轮挑出 N 封拉全文 → 第三轮主动巡检 → 第四轮生成重操作清单"的完整四轮节奏；任何超过判定阈值的操作必须出现在"重操作清单"而不是直接执行。
- f. **兜底可验证**：把 OpenAI key 设成无效值跑一次，agent 必须降级到 `HeuristicLLMClient` 跑完，并在报告"主动告知"小节明确写出"本次降级了，原因是 LLM 调用失败"。

#### Phase 2：学习化 + 主动告知 + pending 队列（核心，1-2 周）

| # | 工作项 |
| --- | --- |
| 2.1 | 新增 `mailtidy/learning.py`：纯函数，输入"信号"输出"偏好更新"；不直接写盘，由 agent_loop 在 act 后调用 |
| 2.2 | 实现"学习信号清单"中所有同步信号：`ask_user` 回调挂学习钩子，`apply_action` 后写决策日志 |
| 2.3 | 实现异步学习提议器：每次 Agent 启动时先扫近 N 天决策日志，候选偏好作为开场提问 |
| 2.4 | 实现"主动告知"通道：每次任务结束扫描 §2.2.3 场景，最多浮出 3 条按重要性排序的建议 |
| 2.5 | 实现"少即是多"约束：拒绝过的建议 30 天内不重复浮出；提供 `--quiet` 开关只在高风险时提醒 |
| 2.6 | 给所有偏好加 `learned_from` / `learned_at` 元数据，提供 `mailtidy memory rollback <id>` 一键回滚 |
| 2.7 | 写"学习的安全边界"测试：单次反馈影响有上限；危险偏好必须 raise 而不是写入 |
| 2.8 | 实现 pending 队列与重操作执行机制 |

**Phase 2 验收标准**：

- 连续 3 次确认归档某发件人后，第 4 次 Agent 直接执行而不是问。
- 用户没主动问任何问题，Agent 在日报里浮出"CEO 这周给你发了 3 封都没回"等告知。
- 单次主动告知不超过 3 条；同一条被拒后 30 天内不再出现。
- **重操作可恢复**：上一轮停下的"重操作建议"，用户点"立即执行"后能作为独立任务跑完。
- **半成品任务可恢复**：因预算耗尽收尾的任务，未完成项进入 `pending_tasks`，下一次 Agent 启动时自动接着做并明确告知"上次没做完的 X 件事，已为你接着做了"。

#### Phase 3：自定义规则 + 研究型分析 + 自我意识（差异化，1-2 周）

| # | 工作项 |
| --- | --- |
| 3.1 | 新增 `mailtidy/rules/`：规则模型 / 自然语言解析 / 匹配 / 冲突处理 / 持久化 |
| 3.2 | 把规则引擎做成 `match_rules` 工具供 Agent 主循环调用；冲突处理写在 `policies.py` |
| 3.3 | 新增 `mailtidy/research.py`：研究计划与邮件动作计划分离；`web_search` 工具；风险评级（低 / 中 / 高，高风险必须用户确认） |
| 3.4 | 把研究反馈接入学习层：trusted_sources 加权、对实体的处理偏好沉淀 |
| 3.5 | 加防钓鱼专项 case：FTX 类邮件、伪造域名、伪造账户验证邮件，写成回归测试集 |
| 3.6 | 实现 §2.2.6 Agent 自我意识：定期统计自己的判断准确率、偏好年龄、单次任务工具消耗，主动浮出自检建议 |

**Phase 3 验收标准**：

- 一封钓鱼邮件提到"FTX 索赔"且链接域名仿冒，Agent 自发触发研究、给出含 6 字段的富建议、风险评级为高、要求用户确认。
- 用户改了 Agent 3 次某类邮件的分类后，Agent 主动告知"我最近这类判断准确率 60%，规则我已调整"。
- Agent 不会在 trace 里出现连续 5 次相同失败的工具调用而不收敛。

#### Phase 4：接真实邮箱（落地，1-2 周）

| # | 工作项 |
| --- | --- |
| 4.1 | 实现 `GmailConnector`，**第一阶段只申请只读 scope**，写动作全部抛 NotImplementedError |
| 4.2 | 用真实邮件跑一个月，每天对比 LLM 决策和你自己的判断，调阈值 / 调 prompt / 加 few-shot 示例 |
| 4.3 | 逐步开放写权限：`label` → `star` → `mark_read` → `archive` → `save_draft`，每开放一个先在 dry-run 模式运行一周验证 |
| 4.4 | 同步实现 `OutlookConnector`，复用 agent_loop 与所有工具 |

**Phase 4 验收标准**：真实邮箱跑一周，trace 可回放，用户标注分类正确率 ≥ 85%；至少能跑通 5 条主动告知场景。

#### Phase 5：交付与运维（持续）

| # | 工作项 |
| --- | --- |
| 5.1 | 定时任务（cron / launchd / GitHub Actions schedule） |
| 5.2 | Telegram / Slack / 桌面通知（主动告知支持推送到这些通道） |
| 5.3 | Web 或桌面 UI：计划展示 → 用户确认 → 执行的可视化；trace 回看；偏好管理 + 一键回滚；主动告知 inbox |
| 5.4 | 审计日志、用户偏好导出 / 删除接口、加密备份 |

#### 核心顺序的理由

- **必须先做 Phase 1**：如果直接进 Phase 4 接 Gmail，项目就永远是流水线，LLM 沦为更贵的正则；接入越深、改成 Agent 越难。
- **必须先做 Phase 2**：Agent 没有学习就是"高级 chat 工具"，跑两周用户就发现它不会变聪明，留不住人。
- Phase 3 / 4 / 5 内部可以并行或调换顺序，但 Phase 1 / 2 必须先做。

### 5.4 MVP 里程碑

按"必须先做"的顺序排列，每个里程碑都有可验证的产出：

| # | 里程碑 | 对应 Phase 验收点 |
| --- | --- | --- |
| 1 | ✅ **流水线骨架**：mock connector、heuristic LLM、四条 SOP、报告、本地记忆、单测、CLI | （已完成） |
| 2 | **Agent 主循环 + 主动调查 + 退出条件 + 兜底 + 任务记录** | Phase 1 全部 a–f |
| 3 | **学习层 + 主动告知 + pending 队列** | Phase 2 全部 |
| 4 | **自定义规则引擎** | Phase 3.1 / 3.2 |
| 5 | **研究型分析 + 自我意识** | Phase 3.3 / 3.4 / 3.5 / 3.6 |
| 6 | **真实 LLM + Gmail 只读 dry-run** | Phase 4.1 / 4.2 |
| 7 | **Gmail 写权限分阶段开放 + 用户确认 UI** | Phase 4.3 |
| 8 | **订阅扫描增强**：闲置判断、月度对比、退订链接抽取，挂到 agent_loop 里成为可被主动触发的子任务 | （独立交付） |
| 9 | **定时任务 + 通知** | Phase 5.1 / 5.2 |
| 10 | **Outlook connector** | Phase 4.4 |
| 11 | **Web / 桌面 UI** | Phase 5.3 / 5.4 |

每一个里程碑都必须满足：**Agent 不只是执行了用户要求的事，还表现出"它在主动多想一步"**。如果某次升级后，Agent 行为相比上一版只是更快或更准，但没有更主动，这次升级就没达到 MailTidy 的产品定位。
