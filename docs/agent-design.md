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
  - 2.1 主循环
  - 2.2 深度思考与上下文压缩
  - 2.3 退出条件
  - 2.4 执行节奏：轻先重后
  - 2.5 兜底与降级
  - 2.6 15 条硬约束
  - 2.7 跨 SOP 联动
  - 2.8 主动性与意识
  - 2.9 LLM 与工具
  - 2.10 pi-agent-core 集成与中断恢复
  - 2.11 决策、确认与规则
  - 2.12 透明度与掌控感
  - 2.13 用户执行与配置面
- 三、Agent Skills（工作流规则）
  - 3.1 收件箱清理
  - 3.2 智能回复草拟
  - 3.3 订阅费扫描
  - 3.4 邮件摘要日报
- 四、Data（数据与持久化）
  - 4.1 邮件分类与判断维度
  - 4.2 记忆层
  - 4.3 学习层
  - 4.4 任务记录与生命周期
  - 4.5 存储与安全
- 五、工程进度与路线图
  - 5.1 目录结构
  - 5.2 当前已实现功能
  - 5.3 路线图（Phase 1-5）
  - 5.4 MVP 里程碑

---

## 一、产品

### 1.1 一句话产品

MailTidy 是一个会阅读收件箱、判断邮件意图和优先级、生成处理计划，并在关键动作前征求确认的邮件 Agent。它能清理收件箱、整理标签、生成摘要、扫描订阅费、为需要回复的邮件生成草稿，并在用户没问的时候**主动告知值得注意的事**。

### 1.2 核心原则

MailTidy 必须是一个 **Agent**，不是更花哨的自动化脚本：

| 维度 | 自动化脚本 | Agent |
| --- | --- | --- |
| 决策来源 | 写死的 if/else 与正则 | LLM 在每一步选择动作 |
| 工具使用 | 调用顺序写死 | LLM 自己决定调用哪个工具 |
| 不确定性 | 走 default 分支 | 触发再思考、拉更多上下文 |
| 反馈 | 不学习，只存日志 | 用户每次确认 / 拒绝 / 修改都改写偏好 |
| 跨 SOP | 各 SOP 互不感知 | Agent 主动串联多个 SOP |

工程上必须同时满足 4 件事：

1. **是 Agent**：通过主循环 + 工具调用 + 多轮思考完成任务（§2.1）。
2. **有主动性**：主动多查、主动核实、主动告知用户没问但值得知道的事（§2.8）。
3. **会学习**：用户每次反馈都让 Agent 下次表现不同，不是只存日志（§4.3）。
4. **对用户透明**：始终知道 Agent 在干什么、花了多少 token、为什么这么做、随时可以叫停（§2.12）。

### 1.3 目标用户

- 被邮件淹没的人
- 每天需要处理大量内外部沟通的职场人
- 管理者 / CEO / 创业者，需要早晨快速掌握局面
- 经常忘记订阅扣费、想看清固定支出的人

### 1.4 内置 SOP 概览

| SOP | 目标 | 默认频率 | 当前状态 |
| --- | --- | --- | --- |
| 收件箱清理 | 分类近期邮件，归档促销 / 垃圾，保留重要邮件 | 每天 9:00 + 手动 | demo 骨架 ✅ |
| 智能回复草拟 | 学习写作风格，为 actionable 邮件生成草稿 | 清理后触发 + 手动 | demo 骨架 ✅ |
| 订阅费扫描器 | 从邮箱中找出付费订阅和月度支出 | 每月 + 手动 | demo 骨架 ✅ |
| 邮件摘要日报 | 生成 2 分钟可读的早晨 briefing | 每天 7:30 | demo 骨架 ✅ |

SOP 不是孤立 CLI 命令，而是 Agent 主循环里**可被组合的子任务**——清理时可以自动触发 daily-brief；订阅扫描发现新订阅可以挂起问用户；自然语言指令可以串联研究 + 规则 + 邮件动作。

---

## 二、Agent 核心

### 2.1 主循环

每次用户触发任务，Agent 进入下面的循环：

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

**关键纪律**：每一步 Observe 之后必须强制检查退出条件——退出条件由主循环代码强制执行，永远优先于 LLM 的下一步决策。

工程落点：[src/agent/loop.ts](src/agent/loop.ts)（Phase 1 落地，当前为 placeholder），包裹 `@earendil-works/pi-agent-core` 的 `Agent` + `agentLoop`，在 pi 的钩子上挂 MailTidy 的关注点。Phase 0 的兼容流水线仍在 [src/agent/legacy.ts](src/agent/legacy.ts)。

### 2.2 深度思考与上下文压缩

Agent 需要"深度思考"但不能把所有历史邮件、所有 trace、所有记忆塞进超长上下文。原则：**先压缩，再推理；先摘要，再回查；只在必要时读取原记录。**

#### 触发条件

只有命中以下情况才进入 `deepThink` 流程：

| 触发条件 | 例子 | 默认动作 |
| --- | --- | --- |
| 高风险 | 钓鱼、转账、账号验证、法律、金融、医疗 | 先压缩上下文，再多轮推理，必要时回查原文 |
| 低置信度 | `confidence < 0.7`，或规则 / LLM 判断冲突 | 生成不确定点清单，补拉最小必要上下文 |
| 跨邮件依赖 | "我之前发的文档"、长 thread、连续催办 | 先生成 thread 摘要，再选择性读原邮件 |
| 用户长期偏好冲突 | 规则说归档，但近期用户多次加星 | 回查最近决策摘要和少量原始记录 |
| 重操作候选 | 需要联网、多实体、多封邮件综合 | 先产出研究计划，超过预算则放入重操作清单 |

#### 上下文分层

Agent State 不允许无限增长原文。上下文必须分成 5 层：

| 层 | 内容 | 是否默认进入 LLM 上下文 | 最大长度 |
| --- | --- | --- | --- |
| L0 任务目标 | 用户原始请求、当前 task goal、预算、退出条件 | 是 | < 1K token |
| L1 工作摘要 | 当前已处理什么、剩什么、关键判断、未解决问题 | 是 | < 2K token |
| L2 证据摘要 | 邮件摘要、thread 摘要、记忆摘要、规则命中摘要 | 是 | < 4K token |
| L3 可回查索引 | emailId、messageId、traceStepId、memoryKey、reportPath | 是，只放索引不放全文 | < 1K token |
| L4 原始记录 | 邮件正文、完整 trace、完整历史决策、原始搜索结果 | 否，工具按需读取 | 单次读取受限 |

L4 原始记录只能通过工具按需读取（`readEmail(id, maxChars)`、`readTraceSlice(stepId, window)`、`recallMemory(query, maxItems)`）。

#### 压缩规则

每次 Observe 后，新增信息必须写入 `workingSummary`：

```typescript
interface WorkingSummary {
  goal: string;
  decisionsSoFar: string[];
  openQuestions: string[];
  evidenceIndex: EvidenceRef[];  // 见 src/agent/context.ts
  budgetLeft: { steps: number; tokens: number };
}
```

三条硬规则：

1. **事实与推断分离**：摘要里要标明哪些是邮件原文事实、哪些是 Agent 推断、哪些是外部来源。
2. **保留引用索引**：任何摘要结论都必须能回到 `emailId` / `traceStepId` / `memoryKey`，不能只剩一句没出处的话。
3. **持续压缩**：当 `workingSummary` 超过阈值（默认 6K token）时，先压缩成阶段摘要再继续；压缩前后的摘要都写入 trace 便于审计。

#### 回查限制

"必要时查看原记录"是为了纠错，不是把上下文塞爆。回查必须受这些限制：

| 限制 | 默认值 | 原因 |
| --- | --- | --- |
| 单次邮件正文读取 | `maxChars=6000` | 先读关键片段 |
| 单次历史记忆返回 | `maxItems=8` | 防止旧偏好淹没当前任务 |
| 单次 trace 回查窗口 | 前后各 3 步 | 只看相关上下文 |
| 单轮回查次数 | ≤ 3 次 | 防止"越查越散" |
| 原文进入最终报告 | 默认不进入，只引用摘要和证据索引 | 降低隐私风险 |

如果三次回查仍无法解决不确定性，Agent 必须停止深挖，改为输出 `If unsure`，或者通过 `askUser` 挂起任务。

#### 工程模块

- [src/agent/context.ts](src/agent/context.ts)：维护 `WorkingContext`、上下文窗口、`EvidenceRef`。
- [src/agent/compression.ts](src/agent/compression.ts)：阶段摘要、摘要再压缩、事实 / 推断 / 来源分离。
- [src/agent/deepThink.ts](src/agent/deepThink.ts)：深度思考触发、回查计划、最终结构化结果。
- [src/tools/history.ts](src/tools/history.ts)：`readTraceSlice` / `readReportSummary` / `readOriginalRecord` 等受限回查工具。
- [src/data/summaries.ts](src/data/summaries.ts)：摘要对象、摘要版本、引用索引 schema。

这些模块与 §4.4 的任务记录联动：每个 checkpoint 都保存当前摘要和 evidence index，恢复任务时优先加载摘要，再按需回查原记录。

### 2.3 退出条件

主循环代码必须在每次 Observe 后强制检查以下 9 种条件，命中任一立即停下：

| 条件 | 触发 | 收尾方式 |
| --- | --- | --- |
| 任务完成 | LLM 显式输出 `finish` | 正常结束，写完成报告 |
| 步数耗尽 | 已执行步数 ≥ N（默认 12） | 强制结束，未完成项进 pending 队列 |
| Token 预算耗尽 | 累计 token 超过 T（默认 50K） | 同上 |
| Wall time 超时 | 任务总耗时 > S 秒（默认 120s） | 同上 |
| 同类工具反复失败 | 同一工具连续失败 ≥ 3 次 | 标记"卡住"，跳过继续后面 |
| LLM 重复同一动作 | 检测到连续 3 步相同 `(tool, args)` | 强制结束并写 trace 错误，进入降级 |
| 用户中断（SIGINT） | 用户取消任务 | 立即停下，已完成的安全动作保留 |
| 致命错误 | LLM 调用失败 / 连接器异常 | 进入降级模式（§2.5），不抛异常给用户 |
| `askUser` 触发 | LLM 决定问用户 | 任务挂起，等用户回复后续跑 |

命中后必须按顺序保证四件事：

1. **更新任务记录**：把 `status` 置为对应终态，写 `exitReason`、最终 `progress`，**先落盘再做后续动作**。
2. **写报告**：正常完成写 `<taskId>.md`，异常退出写 `<taskId>-partial.md`。
3. **未完成项进队列**：通过持久化的 `pendingTasks` 让下次启动优先处理。
4. **触发主动告知**：把"我这次没做完 X"作为一条主动告知浮到下一份日报里。

工程落点：[src/agent/exits.ts](src/agent/exits.ts) 定义 `ExitReason` 枚举与 `ExitDecision` 结构；详细任务记录字段见 §4.4。

### 2.4 执行节奏：轻先重后

不是所有步骤都一样贵。Agent 必须显式区分**轻 / 中 / 重**三类操作：

| 类别 | 典型工具 | 成本 | 策略 |
| --- | --- | --- | --- |
| 轻 | `listEmails` / `recallMemory` / `matchRules` / `classifyEmail`（短文本） | 低 token、< 1s | 同步执行 |
| 中 | `readEmail`（全文）/ `searchEmail` / `classifyEmail`（长上下文） | 中等 token、几秒 | 先估规模，超阈值则分批 + 限频 |
| 重 | `webSearch` / 多封邮件批量深读 / 跨实体研究 | 高 token、可能 10s+ | **不在主循环里直接执行**，生成"重操作建议"由用户决定 |

主循环按四轮顺序执行；每轮结束都走一次退出条件检查：

1. **第一轮 · 轻操作扫一遍**：用便宜工具完成所有"显然要做"的事——拉邮件元信息、规则匹配、记忆查询、明显安全的分类。**绝大多数邮件应在这一轮分完类**。
2. **第二轮 · 必要的中操作**：对置信度低 / 命中主动调查触发器的邮件，调用 `readEmail` 拉全文重判。**这一轮先估规模**，超过预算就只挑最重要的处理。
3. **第三轮 · 主动巡检**：对照 §2.8 的触发条件再过一遍，看还有没有漏的查、应告知的事。**这是 Agent 主动多想一步的核心位置**。
4. **第四轮 · 重操作清单**：所有"很贵 / 很慢 / 不是非现在做不可"的事不直接执行，而是生成结构化建议附在报告里：

   ```typescript
   interface HeavyOperationSuggestion {
     id: string;
     type: "web_search_research" | "batch_deep_read" | "cross_entity_analysis";
     subject: string;
     estimatedCost: string;
     estimatedValue: "low" | "medium" | "high";
     whyNotNow: string;
     userChoice: ["立即执行", "下次清理一起跑", "永远不需要"];
   }
   ```

   用户同意"立即执行"则下次跑独立的"深研究任务"专门处理，独立预算、独立 trace。

**重操作判定阈值**——任何工具调用前先估成本，超过任一阈值就归到"重操作"延后：

- 单次工具调用预计 token > 4K
- 单次工具调用预计耗时 > 5s（联网类阈值更低）
- 跨度 > 20 封邮件的批量深读
- `webSearch` 调用 > 1 次（除非用户显式要求）
- 任何会让本次任务总预算超过 80% 的操作

### 2.5 兜底与降级

最坏情况下体验可以差，但**绝对不能让用户跑不动 Agent**。所有外部依赖都必须有降级路径：

| 故障 | 默认行为 | 降级行为 | 最终兜底 |
| --- | --- | --- | --- |
| LLM API 不可用 | OpenAI / Anthropic | 切换到备用模型路由 | 切回 `HeuristicLLMClient` 跑流水线模式 |
| LLM 调用超时 / 错误 | 重试 1 次 | 切到便宜模型重试 1 次 | 跳过该步骤，记入 trace |
| `webSearch` 不可用 | 联网搜索 | 跳过本次研究 | 把建议标记"未联网验证" |
| 邮件 connector 拉取失败 | Gmail / Outlook API | 用本地缓存邮件 | 友好错误，**不丢失记忆** |
| Token / 步数预算耗尽 | 正常执行 | 立即收尾，写半成品报告 | 报告中明确"剩 N 件事待下次" |
| 单封邮件分类失败 | LLM 分类 | 退化到 heuristic | 归入"未分类"，仅出现在报告，**不动邮箱** |
| Memory 文件读写失败 | 加密本地数据库 | 切换到 JSON 备份 | 用临时内存 memory 跑完，结束时再尝试写入 |
| 重操作预算耗尽 | 正常执行 | 自动归入"待执行清单" | 报告中提示"已收集 N 条重操作，等你确认" |
| Agent 自检发现准确率太低 | 正常工作 | 主动降低自动化倾向，更多 `askUser` | 暂时退到 dry-run 模式 |

**降级 4 原则**：

1. **不静默失败**：每次降级都写到 trace **并**通过主动告知告诉用户。
2. **逐步降级**：能用便宜模型就别关掉；能用本地启发式就别报错；能拉缓存就别放弃。
3. **永远保底有 `HeuristicLLMClient`**：即使所有外部依赖都挂了，跑 `npm run demo:cleanup` 仍然能得到基础清理报告。**这是 MailTidy 的最低可用线**，落点在 [src/integrations/llm/heuristic.ts](src/integrations/llm/heuristic.ts)。
4. **降级不能偷偷变默认**：连续多次降级要主动告知"我已连续 3 天用回启发式，可能你的 OpenAI 配置有问题"。

### 2.6 15 条硬约束

主循环代码（[src/agent/loop.ts](src/agent/loop.ts)）必须自带以下硬约束。**这 15 条是单测必检项，缺一不可。**

| # | 约束 | 默认值 / 说明 |
| --- | --- | --- |
| 1 | 步数预算 | 单次任务最多 N 步（默认 12） |
| 2 | Token 预算 | 单次任务最多 T token（默认 50K） |
| 3 | Wall time 预算 | 单次任务最多 S 秒（默认 120s） |
| 4 | 工具预算 | `webSearch ≤ 3` / 任务、`applyAction` 高风险必须先 `askUser` |
| 5 | 重操作不直接执行 | 超阈值生成"重操作建议"交给用户 |
| 6 | 退出条件强制检查 | 每次 Observe 后必检 9 种退出条件 |
| 7 | 死循环检测 | 连续 3 步相同 `(tool, args)` 立即终止 |
| 8 | 可观察性 | 每一步 `(thought, tool, args, observation, exitCheck)` 落 trace |
| 9 | 可中断 | 用户随时取消（SIGINT → `agent.abort()`），已执行的安全动作保留 |
| 10 | 可恢复 | 被 `askUser` 挂起 / SIGINT 中断的任务能从断点续跑（§2.10） |
| 11 | 沙箱模式 | 写动作可走 dry-run，trace 显示"如果不是 dry-run 会做什么" |
| 12 | 降级路径 | 所有外部依赖都有明确降级方案 |
| 13 | 上下文压缩 | LLM 默认只看摘要和证据索引；原始记录必须通过受限工具按需回查 |
| 14 | 用户透明 | 实时暴露阶段 / 预算 / 已执行动作；任何不可逆动作 / 联网 / 偏好写入都可被事前感知与事后回查（§2.12） |
| 15 | 无法兑现必须明示 | 用户提出当前能力 / 权限 / 配置无法完成的请求时，必须说明原因、给可行替代、写入报告的"未兑现请求"，不能假装成功（§2.13） |

### 2.7 跨 SOP 联动

四条 SOP 不是孤立 CLI 命令，而是 Agent 主循环里**可被组合的子任务**：

- 清理时如果发现今天有 5 封紧急邮件，Agent 可以自动触发一次 daily-brief 推送。
- 订阅扫描发现新订阅，Agent 可以挂起并问用户是否打 `Subscriptions` 标签。
- 用户用自然语言说"以后 FTX 的邮件都加星"时，Agent **先**触发研究型分析评估风险，**再**生成规则草稿，**最后**问用户确认并执行邮件动作——三条 SOP 在一次对话里串起来。

实现要求：所有 SOP 入口（`runCleanup` / `dailyBriefing` / `scanSubscriptions` / `draftReplies`）都应是同一个 `runAgentLoop()` 的薄包装，State 共用、tools 共用、recovery 共用。

### 2.8 主动性与意识

#### 三个意识层次

| 层次 | 描述 | 表现 |
| --- | --- | --- |
| L1 任务意识 | 知道当前在做什么、还剩什么 | 报告 / trace / progress |
| L2 局势意识 | 知道用户最近邮件局势、谁催过、什么钱花了 | 主动告知、日报里的"值得注意"小节 |
| L3 自我意识 | 知道自己的准确率、偏好年龄、token 消耗、近期降级次数 | 定期自检 + 浮出"我最近 X 类判断准确率 60%，规则我已调整" |

#### 主动调查触发条件

| 触发条件 | 例子 | 主动动作 |
| --- | --- | --- |
| 域名疑似仿冒 | `support@notion-help.com`、`amazon-billing.net` | 调用 `verifyDomain` / `whois`，对比已知域名 |
| 涉及金钱 / 法律 / 账号验证 | 索赔、退款、KYC、密码重置 | 主动核实链接归属，必要时 `webSearch` 背景 |
| 与历史决策矛盾 | 规则说归档，但发件人最近被加星过 3 次 | 回查决策日志，请求用户重新确认偏好 |
| 跨邮件证据 | "我上周说的那件事" | 触发 `searchEmail` + thread 摘要 |
| 低置信度 + 重要类别 | `confidence < 0.7` 且分类为 important / actionable | 拉全文重判，必要时 `askUser` |

#### 主动告知时机

每次任务结束扫描以下场景，按重要性排序，**单次告知不超过 3 条**：

| 场景 | 告知内容 |
| --- | --- |
| 重要联系人长期未回复 | "CEO 这周给你发了 3 封都没回" |
| 新订阅 | "上周开始多了一笔 $19.99 月费" |
| 异常账户活动 | "你的 GitHub 账号本周登录了 4 次失败" |
| Agent 自检结果 | "我最近 spam 分类准确率 78%，建议你审视下规则" |
| 因预算未完成的事 | "上次因预算未完成 12 件，已为你接着做了 8 件" |

#### 主动性的边界

- **拒绝过的建议 30 天内不重复浮出**（除非证据强度显著上升）
- **提供 `--quiet` 开关**：只在高风险时主动告知
- **被告知一次的同类事件**，第二次只计数不再单独浮出，第 N 次时合并成一句

#### Agent 自我意识

定期（每 7 天）统计：

- 各类邮件分类准确率（用户改过分类的比例）
- 偏好年龄分布（避免老偏好长期主导）
- 单次任务平均工具消耗与 token 成本
- 降级次数

异常时主动浮出自检建议，让用户决定调整阈值 / 清理偏好 / 重新培训。

### 2.9 LLM 与工具

#### 初始工具集（v1）

工具按风险等级分类，定义在 [src/tools/base.ts](src/tools/base.ts):

```typescript
type ToolRisk = "low" | "medium" | "high";

interface ToolDefinition<TArgs, TResult> {
  name: string;
  description: string;
  schema: Record<string, unknown>;  // JSON Schema
  risk: ToolRisk;
  rateLimit?: { perTask?: number; perMinute?: number };
  invoke(args: TArgs): Promise<TResult>;
}
```

| 工具 | 文件 | 风险 | 频率限制 |
| --- | --- | --- | --- |
| `listEmails` / `readEmail` / `searchEmail` | [src/tools/email.ts](src/tools/email.ts) | low | 无 |
| `classifyEmail` / `summarizeEmail` | [src/tools/classify.ts](src/tools/classify.ts) | low | 无 |
| `applyAction` (archive / label / star / markRead / saveDraft) | [src/tools/actions.ts](src/tools/actions.ts) | medium (写入) / high (批量归档) | 写动作必须经 DecisionPolicy 风险闸门 |
| `matchRules` | [src/tools/rules.ts](src/tools/rules.ts) | low | 无 |
| `recallMemory` / `writeMemory` | [src/tools/memory.ts](src/tools/memory.ts) | low / high (写入需用户确认) | writeMemory ≤ 5 / 任务 |
| `webSearch` / `verifyDomain` | [src/tools/research.ts](src/tools/research.ts) | high | webSearch ≤ 3 / 任务 |
| `askUser` | [src/tools/user.ts](src/tools/user.ts) | medium | ≤ 3 / 任务（避免轰炸） |
| `readTraceSlice` / `readReportSummary` | [src/tools/history.ts](src/tools/history.ts) | low | 单轮 ≤ 3 次 |

#### 专用 LLM 层

[src/llm/](src/llm/) 与 [src/integrations/llm/](src/integrations/llm/) 分工：

| 模块 | 职责 |
| --- | --- |
| [src/llm/client.ts](src/llm/client.ts) | `LLMClient` 接口 + `ModelProfile`（不绑定供应商） |
| [src/llm/router.ts](src/llm/router.ts) | `LLMRouter`：按 `purpose` 选 client、failover 到 fallback |
| [src/llm/usage.ts](src/llm/usage.ts) | `UsageLedger`：token / 成本累计、每个 turn 后落到任务记录 |
| [src/integrations/llm/openai.ts](src/integrations/llm/openai.ts) | OpenAI 适配器（内部用 `@earendil-works/pi-ai`） |
| [src/integrations/llm/anthropic.ts](src/integrations/llm/anthropic.ts) | Anthropic 适配器（内部用 `@earendil-works/pi-ai`） |
| [src/integrations/llm/local.ts](src/integrations/llm/local.ts) | 本地模型 / Ollama 适配器 |
| [src/integrations/llm/heuristic.ts](src/integrations/llm/heuristic.ts) | 启发式兜底，CI / 断网 / 没 API key 都能跑 |

**LLM 角色边界**（不能越权）：

- LLM 只负责"判断"和"提案"，不负责"执行"。
- 所有写动作（archive / saveDraft / 写记忆）都必须经过 [src/agent/policies.ts](src/agent/policies.ts) 的 `DecisionPolicy` 风险闸门。
- LLM 输出的 `actionSuggestion` 不等于执行——是否真做由 policy 决定。

### 2.10 pi-agent-core 集成与中断恢复

MailTidy 的 Agent 运行时建立在 [earendil-works/pi](https://github.com/earendil-works/pi) 之上：
- `@earendil-works/pi-agent-core` 提供 Agent runtime + tool calling + 钩子系统
- `@earendil-works/pi-ai` 提供多 provider LLM 抽象
- `@earendil-works/pi-tui`（Phase 5）提供 trace 展示
- `@earendil-works/pi-web-ui`（Phase 5）提供 Web UI

#### 关键 pi 接口

| pi API | MailTidy 用法 |
| --- | --- |
| `Agent` 构造 | 注入 `systemPrompt` / `model` / `tools` / 初始 `messages` |
| `agentLoop(...)` | 启动主循环，迭代 yield 事件 |
| `agentLoopContinue(context, config)` | **从已有 messages[] 续跑**——MailTidy 中断恢复的核心 |
| `beforeToolCall` 钩子 | 接入 `DecisionPolicy`：高风险动作阻断 + `askUser` 弹出 |
| `afterToolCall` 钩子 | 调 `CheckpointStore.persist` + `JsonTaskStore.update` + 学习信号写入 |
| `shouldStopAfterTurn` | 评估退出条件（§2.3）：返回 true 即触发 finish |
| `agent.abort()` | SIGINT handler 调用，取消 in-flight tool call |
| `agent.state.messages` | 可序列化的对话历史，checkpoint 写盘对象 |

#### 中断恢复机制

pi 本身**没有**自带 checkpoint / 持久化恢复。MailTidy 在 pi 的两个原语（可序列化的 `messages` + `agentLoopContinue`）上自己搭一层薄的恢复机制：

| 模块 | 职责 |
| --- | --- |
| [src/data/tasks.ts](src/data/tasks.ts) `JsonTaskStore` | 任务记录生命周期：running / completed / interrupted / failed / cancelled，一任务一 JSON 文件 |
| [src/agent/recovery.ts](src/agent/recovery.ts) `CheckpointStore` | pi `agent.state.messages` + 预算快照写盘，每条任务对应一个 checkpoint 文件 |
| [src/agent/exits.ts](src/agent/exits.ts) `ExitReason` | 9 种退出原因枚举，与 §2.3 表对齐 |
| [src/interfaces/cli.ts](src/interfaces/cli.ts) `withTaskLifecycle` | SOP 调用前 `create()`，结束 `markCompleted()`，异常 `markFailed()`，SIGINT `markInterrupted()` |
| [src/interfaces/prompts.ts](src/interfaces/prompts.ts) | 启动时 `scanInterrupted()` + `[r]/[c]/[s]/[d]` 交互提示 |

#### 钩点映射

| 时机 | pi 钩子 / 信号 | MailTidy 动作 |
| --- | --- | --- |
| 每个 tool call 之前 | `beforeToolCall` | `DecisionPolicy` 风险闸门；high-risk → 弹 `askUser` 或阻断 |
| 每个 tool call 之后 | `afterToolCall` | `CheckpointStore.persist(messages, budget)` + `JsonTaskStore.update(progress)` |
| 每个 turn 边界 | `shouldStopAfterTurn` | 评估退出条件，返回 true → 主循环 emit `agent_end` |
| 进程收到 SIGINT | Node `process.on("SIGINT")` | `agent.abort()` + `JsonTaskStore.markInterrupted()` |
| 进程启动 | CLI 入口 | `JsonTaskStore.scanInterrupted()` + 用户选 `[r]/[c]/[s]/[d]` |
| 用户选 [c] | — | `CheckpointStore.load()` → `agentLoopContinue(reconstructedContext)` |

#### 设计权衡

- **每个 tool call 和每个 turn 边界都写盘**：牺牲一点 IO，换"最多丢一个 turn 的进度"。`kill -9` 无法被进程 catch，但因每 turn 都写过盘，下次启动 `scanInterrupted` 依然能恢复。
- **一任务一文件**而非单 SQLite：写时不需要锁；`kill -9` 文件损坏只影响当条任务，不会拖垮整个恢复扫描。Phase 2 可以加 SQLite 加索引，但每任务一份的 JSON 仍是真源。
- **TaskRecord 与 Checkpoint 分离**：`TaskRecord` 是"任务身份和进度"（sop / status / phase / completedActionIds），`Checkpoint` 是"LLM 对话状态"（messages / budget）。两者解耦，让任务管理 CLI（`mailtidy task list/show/cancel/purge`）不需要加载 LLM 历史。

#### 15 条硬约束与 pi 的对应

| 约束 | 实现位置 |
| --- | --- |
| #1 步数预算、#2 token 预算、#3 wall time | `shouldStopAfterTurn` 内累计 + 退出 |
| #4 工具预算、#5 重操作不直接执行 | `beforeToolCall` 内查 `ToolDefinition.rateLimit` + risk |
| #6 退出条件强制检查 | `shouldStopAfterTurn` 调 `evaluateExits()` |
| #7 死循环检测 | `afterToolCall` 内比对最近 3 步 `(tool, args)` |
| #8 可观察性 | pi 原生 event stream → `src/agent/trace.ts` 转 `TraceEvent[]` |
| #9 可中断 | `agent.abort()` + SIGINT handler |
| #10 可恢复 | `CheckpointStore` + `agentLoopContinue` |
| #11 沙箱模式 | `beforeToolCall` 内 dry-run 标志拦截写动作，记入 trace |
| #12 降级路径 | `LLMRouter.fallbackFor()` + try/catch 切 `HeuristicLLMClient` |
| #13 上下文压缩 | `WorkingContext` + `compression.ts` 在每 turn 后压缩 messages |
| #14 用户透明 | `--show-thinking` / `--paranoid` 实时流式输出 `TraceEvent`，结束写 trace 文件 |
| #15 无法兑现必须明示 | `DecisionPolicy` 返回 `CapabilityGap`，写到报告"未兑现请求"小节 |

### 2.11 决策、确认与规则

#### 决策模型

[src/agent/policies.ts](src/agent/policies.ts) 的 `DecisionPolicy` 是 Agent 的"安全闸门"：

```typescript
class DecisionPolicy {
  applyMemory(judgment, sender, memory): EmailJudgment;  // 用户偏好叠加
  buildPlan(intent, judgments): AgentPlan;               // 按 (action, label, requiresConfirmation) 聚合
}
```

阈值默认偏保守（宁可多问一次也不要静默归档错邮件）：

| 阈值 | 默认 | 含义 |
| --- | --- | --- |
| `archiveThreshold` | 0.85 | spam / promotion 置信度低于此值只进报告，不进归档计划 |
| `markReadThreshold` | 0.82 | 仅在高置信度时才自动标记通知类邮件已读 |
| `autoArchivePromotions` | false | 默认归档前需要用户确认 |

#### 确认策略

产品默认是**分级自动化**：Agent 可以先读邮件、分类、生成计划；低风险动作默认直接做，中高风险动作列出来问。用户可以把某类动作改成 always ask / auto approve；学习层会把多次确认、拒绝、手工修改转成 `AgentMemory.actionPreferences`，但高风险动作不能被单次反馈放开。

自动化模式：

| 模式 | 行为 |
| --- | --- |
| `conservative` | 低风险自动；中高风险确认 |
| `balanced` | 默认模式：低风险自动；中高风险确认；可被已学习偏好收紧或放开中风险 |
| `aggressive` | 低中风险自动；高风险确认 |

| 操作 | 默认要求 | 可学习放开 |
| --- | --- | --- |
| `label` / `star` | 低风险，默认自动 | 可改为 always ask |
| `markRead` (notification, conf ≥ 0.82) | 中风险，默认确认 | 可按发件人 / 规则放开 |
| `archive` (spam / promotion, conf ≥ 0.85) | **需确认** | 同一发件人确认 3 次后可自动 |
| `saveDraft` | 先展示草稿预览，确认后保存（永不发送） | — |
| `writeMemory` (新偏好) | **需确认** | 不可学习放开 |

#### 自定义规则引擎（Phase 3）

[src/rules/](src/rules/) 提供：

```typescript
interface Rule {
  id: string;
  description: string;
  match: Record<string, unknown>;   // 例如 { sender: "boss@*", category: "actionable" }
  action: { kind: string; args?: Record<string, unknown> };
  priority: number;
  source: "user_nl" | "user_yaml" | "imported";
}
```

##### 自然语言加规则

用户说"以后 FTX 的邮件都加星"→ Agent：

1. 调 `parseRule(naturalLanguage)` 生成 Rule 草稿
2. 调 `verifyEntity("FTX")` 评估实体可信度（钓鱼防线，§2.8 防钓鱼）
3. 弹 `askUser` 让用户确认 Rule 草稿
4. 写入 `RuleStore` + 同步到 `AgentMemory`

##### 规则冲突处理

| 冲突 | 处理 |
| --- | --- |
| 多条 Rule 匹配同一封邮件 | 按 `priority` 高优先级胜出，记入 trace |
| Rule 与 LLM 判断矛盾 | 偏向 Rule（用户显式意图），但低置信度时弹 `askUser` |
| Rule 互相矛盾 | 启动时 `RuleStore.validate()` 检查，加载失败提示用户改规则 |

#### 研究型分析（Phase 3）

[src/research/](src/research/) 模块在 §2.8 主动调查触发时启动：

| 触发 | 工具 | 输出 |
| --- | --- | --- |
| 域名疑似仿冒 | `verifyDomain` / `whois` | `RiskAssessment { domain, riskLevel, reasons }` |
| FTX / 索赔 / KYC 类敏感词 | `webSearch` + 实体背景 | `EntityProfile { name, trusted, sources, lastVerified }` |
| 长 thread 跨邮件依赖 | `searchEmail` + `summarizeThread` | `ThreadDigest { keyDecisions, openQuestions }` |

**风险评级**：低 / 中 / 高。**高风险必须用户确认**，无论是否命中 Rule。

##### 防钓鱼专项

回归测试集应包括：

- FTX 类邮件（高 profile 实体仿冒）
- 伪造域名（`notion-help.com` vs `notion.so`）
- 伪造账户验证（"你的账号将被关闭"）
- AI 生成的钓鱼模板（语法完美但语境奇怪）

### 2.12 透明度与掌控感

#### 透明的 5 个核心维度

| 维度 | 用户应能看到 |
| --- | --- |
| 当前阶段 | "正在第二轮分类，还剩 8 封" |
| 累计成本 | "已用 12.3K token / $0.018" |
| 已执行的不可逆动作 | "已 archive m3, m7"（写动作前置告知） |
| 联网调用 | "正在访问 notion.so/help 核实域名" |
| 偏好写入 | "学到：CEO 邮件永远 star，已写入 memory（可一键回滚）" |

#### 默认显示信息（用户不开任何选项）

每次 SOP 执行结束的报告里默认包含：

- 处理摘要（处理了多少 / 归档多少 / 标签多少 / 加星多少 / 草稿多少）
- "需要你注意"小节（important / actionable 邮件清单）
- "需要你确认"小节（被风险闸门挡下的动作清单）
- "主动告知"小节（最多 3 条 §2.8 告知）
- 估算成本 + 任务耗时

#### 可选展开（用户主动打开）

| 开关 | 显示内容 |
| --- | --- |
| `--show-thinking` | 流式输出每一步 thought + tool call + observation |
| `--trace-full` | 跑完后把完整 trace 写到 `.mailtidy/traces/<taskId>.jsonl` |
| `--paranoid` | 所有动作（包括默认免确认的 label / star）都要确认 |
| `--dry-run` | 写动作只入 trace 不真做 |
| `--quiet` | 主动告知只在高风险时浮出 |

#### Token 与成本透明度

[src/llm/usage.ts](src/llm/usage.ts) `UsageLedger`：

```typescript
interface UsageRecord {
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  at: string;
}
```

每个 LLM 调用都落账，任务结束写到 `TaskRecord.notes`。`mailtidy usage` 命令可按天 / 按 SOP 汇总。

#### 反黑箱的 8 条硬约束

1. 任何写动作（邮箱 / 记忆）执行前必须能在 trace 中看到决策依据
2. 任何降级必须主动告知（§2.5 降级 4 原则之一）
3. 任何偏好写入必须可一键回滚（`mailtidy memory rollback <id>`）
4. 任何"自动放开的确认"必须有学习理由（`learnedFrom` / `learnedAt` 元数据）
5. 任何任务都可中断（SIGINT → 立即停 + 写盘）
6. 任何任务都可回看（trace 文件永久保留，除非用户显式 `purge`）
7. 任何任务都可恢复（§2.10）
8. 任何报告都标注"基于哪个版本的偏好"，让用户能区分"是 Agent 错了还是偏好旧了"

### 2.13 用户执行与配置面

#### 三种交互形态（按使用频率排序）

| 形态 | 何时用 | 落点 |
| --- | --- | --- |
| **对话**（默认） | 在任意 UI / CLI 输入框直接说话 | [src/interfaces/prompts.ts](src/interfaces/prompts.ts) + [src/agent/loop.ts](src/agent/loop.ts) 解析意图 |
| **"我的设置面板" CLI** | `mailtidy settings` 进入 TUI 表单 | [src/interfaces/cli.ts](src/interfaces/cli.ts) + [src/data/repositories.ts](src/data/repositories.ts) `SettingsRepo` |
| **"我的设置面板" Web** | 浏览器打开 `mailtidy ui` | [src/interfaces/web/](src/interfaces/web/)（Phase 5，用 `@earendil-works/pi-web-ui`） |

#### 高级入口

| 入口 | 用法 | 落点 |
| --- | --- | --- |
| **任务管理** | `mailtidy task list/show/cancel/resume/purge` | [src/interfaces/cli.ts](src/interfaces/cli.ts) |
| **恢复扫描** | `mailtidy recover`（启动时自动跑一次） | [src/interfaces/cli.ts](src/interfaces/cli.ts) |
| **配置文件直改** | 编辑 `~/.config/mailtidy/config.toml` 或 `.mailtidy/config.toml` | [src/ops/config.ts](src/ops/config.ts) |
| **定时调度** | 用户自己写 cron / launchd / systemd timer，调任意 CLI 命令 | [src/ops/scheduler.ts](src/ops/scheduler.ts) 提供模板，**不替你装** |
| **主动通知通道** | Slack / Telegram / 桌面通知接收主动告知 | [src/integrations/notification/](src/integrations/notification/)（Phase 2） |

#### 配置覆盖优先级

1. CLI 命令行参数（最高）
2. `.mailtidy/config.toml`（项目本地）
3. `~/.config/mailtidy/config.toml`（用户全局）
4. 内置默认值（最低）

#### 无法兑现的请求

用户请求当前能力 / 权限 / 配置无法完成时：

| 场景 | 例子 | 应有响应 |
| --- | --- | --- |
| **不可执行** | "帮我把所有 X 的邮件都删掉永不恢复" | 明确说"MailTidy 没有 delete 接口，只能 archive"；提供替代 |
| **未实现** | "帮我接 Outlook" | 明确说"现在只有 Gmail / mock 或 Outlook 在 Phase 4 落地"；可加入 roadmap |
| **风险阻断** | "把这封看起来像钓鱼的邮件标为已读" | 提示风险评级；建议用户先核实，再决定 |
| **权限不足** | OAuth scope 不包含写权限 | 引导用户开放对应 scope，给出"开放后能做什么"清单 |

四步处理流程：

1. **不假装成功**：明确说不能做
2. **给原因**：是没接口 / 没权限 / 风险高 / 还没实现
3. **给替代**：能做的最接近的事是什么
4. **能转待办就转待办**：未实现但合理的能力进入 `pendingCapabilities`，供路线图和用户设置页展示

```
你要的"自动删除 X 的所有邮件"目前我做不到。
原因：MailTidy 只暴露 archive，不暴露 delete（防止误删）。
替代方案：我可以批量 archive，并打 "ToDelete" 标签让你后续在 Gmail 手动批量删
是否执行？[y/n]
```

---

## 三、Agent Skills（工作流规则）

四条 SOP 的指令模板存放在 [src/agent/skills/](src/agent/skills/)，运行时由 skill loader 注入主循环作为 system prompt 段。用户可以在 `.mailtidy/skills/<sop-name>.md` 覆盖内置版本。

### 3.1 SOP 1：收件箱清理

入口：`runCleanup({ hours, limit, customDimensions, autoConfirm })`。

| 阶段 | 动作 |
| --- | --- |
| Fetch | `connector.fetchRecent({ hours: 24, unreadOnly: true, limit: 200 })` |
| Classify (轻) | 每封邮件调 `llm.classifyEmail`，应用 `DecisionPolicy.applyMemory` |
| Deep think (中) | 对低置信度 / 风险邮件触发 §2.2 流程 |
| Build plan | `DecisionPolicy.buildPlan` 聚合成批量动作 |
| Preview | 输出完整 cleanup plan，列出 proposed actions、依据和需用户关注的邮件 |
| Execute | 只有用户确认后才执行邮箱写动作；未确认时不改变邮箱状态 |
| Report | `cleanupReport(plan, result, messages, newsletterSummary)` |

预算：默认 12 步 / 50K token / 120s。

### 3.2 SOP 2：智能回复草拟

入口：`draftReplies(emailIds?)`。**永远只写到草稿箱，不会自动发送**——这是架构级承诺（[src/integrations/email/base.ts](src/integrations/email/base.ts) 不暴露 `send` 接口）。

| 阶段 | 动作 |
| --- | --- |
| 选邮件 | 默认从最近 cleanup 计划中挑出 `actionable` 邮件 |
| Style 加载 | `AgentMemory.styleProfile` 提供 opening / closing / signature |
| 草稿生成 | `llm.draftReply(message, style)`，故意留 `[需要你补充]` 让用户必看 |
| Preview | 默认只展示草稿计划和 proposed draft text |
| 写盘 | 用户确认后才调用 `connector.saveDraft(emailId, body)` |

### 3.3 SOP 3：订阅费扫描器

入口：`scanSubscriptions()`。

| 阶段 | 动作 |
| --- | --- |
| 多关键词搜索 | `["subscription confirmation", "payment receipt", "renewal notice", "monthly charge", "your plan", "billing statement"]` |
| 抽取 | 服务名（域名前缀）、金额（`$xx.xx`）、计划名（Premium / Plus / ...）、最近扣费日期 |
| 去重 | 同一服务保留 `lastChargeDate` 更新的一条 |
| 输出 | Markdown 表格 + CSV（导入 Excel / Google Sheets 二次分析） |
| 写历史 | 进 `AgentMemory.subscriptionHistory`，供"和上月对比"功能 |

增强（Phase 2-3）：闲置判断（90 天没用还在扣）、月度对比、自动抽取退订链接。

### 3.4 SOP 4：邮件摘要日报

入口：`dailyBriefing(customDimensions?)`。**只读**，不触发任何邮箱写动作。

| 分组 | 标准 |
| --- | --- |
| Urgent Today | `urgency >= 4` |
| Important This Week | `2 <= urgency < 4` |
| FYI | `urgency < 2` |

底部包含：未读总数、需要回复数、订阅 / 钓鱼 / 重要联系人未回复等主动告知（§2.8）。

---

## 四、Data（数据与持久化）

### 4.1 邮件分类与判断维度

#### 默认 7 类分类

定义在 [src/data/models.ts](src/data/models.ts):

```typescript
const Category = {
  IMPORTANT: "important",          // 需要用户亲自关注的重要邮件
  ACTIONABLE: "actionable",        // 需要回复 / 审批 / 安排时间等具体动作
  NEWSLETTER: "newsletter",        // 订阅资讯
  PROMOTION: "promotion",          // 营销 / 折扣
  NOTIFICATION: "notification",    // 系统通知，如 GitHub / Slack
  SPAM: "spam",                    // 垃圾邮件
  TRANSACTIONAL: "transactional",  // 订单 / 账单 / 收据
} as const;
```

新增分类时同步更新：

- [src/agent/policies.ts](src/agent/policies.ts) 的 `actionFor()`
- [src/integrations/llm/heuristic.ts](src/integrations/llm/heuristic.ts) 的 `classifyEmail()`
- 本文档 §4.1.1 表格

#### 用户自定义维度

用户可在 CLI 加 `--dimension needs_reply --dimension project` 让 LLM 给每封邮件额外打这些维度的值。LLM 输出写入 `EmailJudgment.customDimensions: Record<string, unknown>`。

未识别的维度 `HeuristicLLMClient` 统一返回 `"unknown"`，避免上层拿到 `KeyError`。

### 4.2 记忆层

[src/data/memory.ts](src/data/memory.ts) `AgentMemory`：

```typescript
interface AgentMemory {
  senderPreferences: Record<string, SenderPreference>;
  actionPreferences: Record<string, string>;
  styleProfile: StyleProfile;
  subscriptionHistory: SubscriptionScanSnapshot[];
}

interface SenderPreference {
  category?: string;
  importanceDelta: number;
  preferredAction?: string;
  ignoredCount: number;
}
```

#### 内容分层

| 层 | 内容 | 写入时机 |
| --- | --- | --- |
| Sender preferences | 单个发件人的长期偏好 | `applyMemory` 时读；学习层（Phase 2）写 |
| Action preferences | "归档促销邮件 → 自动" 这种放开 | 用户确认 N 次后学习写入 |
| Style profile | 写作风格画像 | 草稿生成器读；学习层观察用户改稿后写 |
| Subscription history | 历次订阅扫描快照 | 每次 `scanSubscriptions` 追加，用于月度对比 |

当前实现：本地 JSON。生产版应换成 SQLite + SQLCipher 加密（Phase 2，[src/data/database.ts](src/data/database.ts)），但 `AgentMemory` 数据结构无需改动。

`.mailtidy/memory.json` 已在 `.gitignore` 中排除。

### 4.3 学习层

[src/data/learning.ts](src/data/learning.ts)（Phase 2 落地）：纯函数，输入"信号"输出"偏好更新"；不直接写盘，由 agent loop 在 act 后调用。

#### 学习信号清单

| 信号 | 触发 | 更新 |
| --- | --- | --- |
| 用户确认某 high-risk 动作 | `askUser` 回调 yes | `actionPreferences[(sender, action)].confidence += 1` |
| 用户拒绝某 high-risk 动作 | `askUser` 回调 no | 同上 `-= 2`（拒绝权重高于确认） |
| 用户手动改分类 | 邮件被标为不同 category | `senderPreferences[sender].category` 写入用户选择 |
| 用户改草稿后发送 | 检测 draft → sent 的 diff | `styleProfile` 写入新模式 |
| 同一类降级连续 N 次 | LLM 多次降级到 heuristic | 主动告知 + 不更新偏好 |

#### 安全边界

- **单次反馈影响有上限**：单条信号最多让 `confidence` 变化 ±3。
- **危险偏好必须 raise 而不是写入**：例如"自动删除所有邮件"，直接拒绝。
- **学习需要 N 次累积才放开自动化**：连续 3 次确认归档某发件人 → 第 4 次自动；中间任意一次拒绝 → 计数清零。
- **所有偏好有 `learnedFrom` / `learnedAt` 元数据**，提供 `mailtidy memory rollback <id>` 一键回滚。

#### 学习 → 决策的闭环

每次 SOP 启动前，从 `AgentMemory` 加载相关偏好做 system prompt 前缀：

```typescript
const prefs = memory.getRelevantPreferences({ sender, category });
const promptPrefix = `
# Relevant preferences for this email
${prefs.map(p => `- ${p.note} (learned from ${p.learnedFrom}, age ${p.ageDays}d)`).join("\n")}
`;
```

LLM 看到偏好做参考，但仍可根据当前邮件覆盖（写入 trace 让用户回看时能解释）。

### 4.4 任务记录与生命周期

每次 SOP 执行都有一条 `TaskRecord`，存于 `.mailtidy/tasks/<taskId>.json`。这是 §2.10 中断恢复的基础。

#### 任务记录字段

[src/data/tasks.ts](src/data/tasks.ts):

```typescript
interface TaskRecord {
  taskId: string;                    // UUID
  sop: "inbox_cleanup" | "daily_brief" | "subscription_scan" | "draft_replies";
  status: "running" | "completed" | "interrupted" | "failed" | "cancelled";
  invocation: Record<string, unknown>; // 启动参数，恢复时复用
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  exitReason?: ExitReason;
  progress: {
    phase: string;                   // "fetch" / "classify" / "plan" / "execute" / "report"
    completed: number;
    total?: number;
    completedActionIds: string[];    // 恢复时不再重做
    partialArtifacts?: Record<string, unknown>;  // 半成品报告 / 计划
  };
  notes: string[];                   // 错误链、重试历史、降级日志
}
```

#### 生命周期

| 阶段 | API | 状态变化 |
| --- | --- | --- |
| SOP 启动 | `JsonTaskStore.create({ sop, invocation })` | → `running` |
| 每个 turn 结束 / tool 结束 | `JsonTaskStore.update(record)` | `progress.phase` / `completed` 更新 |
| 正常完成 | `markCompleted(record, "completed")` | → `completed` |
| 用户中断 (SIGINT) | `markInterrupted(record, "sigint")` | → `interrupted` |
| 预算耗尽 | `markInterrupted(record, "budget_exceeded")` | → `interrupted`（recoverable） |
| 致命错误 | `markFailed(record, "uncaught_error", note)` | → `failed` |
| 用户取消 | `markCompleted(record, "user_cancelled")` | → `cancelled` |

#### 写入时机

- 启动时**先写盘再开始执行**（保证 SIGINT 在第一步就能被恢复扫描看到）
- 每个 pi `afterToolCall` 钩子触发后更新一次
- 每个 `shouldStopAfterTurn` 触发后更新一次
- 任何 throw 都先 `markFailed` 再 rethrow

#### 启动恢复检查

[src/interfaces/cli.ts](src/interfaces/cli.ts) 启动时调 `scanInterrupted()`：

```text
Found 2 unfinished task(s) from a previous run:

Unfinished task 6f8a3e2c (inbox_cleanup)
  status=interrupted  phase=classify  turn=4
  last seen at 2026-05-17T09:23:01.443Z
  [r] rerun from scratch   [c] continue from checkpoint   [s] skip   [d] drop record
>
```

四种选择：

| 输入 | 行为 |
| --- | --- |
| `r` / `rerun` | 重跑相同 invocation，从头开始（Phase 1 落地） |
| `c` / `continue` | 加载 checkpoint，`agentLoopContinue` 续跑（Phase 1 落地） |
| `s` / `skip`（默认） | 跳过这条，保留记录 |
| `d` / `drop` | 删除 TaskRecord 和 Checkpoint 文件 |

不识别的输入回退到 `skip`（保守默认）。

#### 完成报告 / 半成品报告

| 状态 | 报告文件 | 内容 |
| --- | --- | --- |
| `completed` | `.mailtidy/reports/<taskId>.md` | 完整报告（§3 每条 SOP 的格式） |
| `interrupted` / `failed` | `.mailtidy/reports/<taskId>-partial.md` | 半成品：已完成项 + "未完成的 N 件事" + `pendingTasks` 写入提示 |

#### 清理策略

| 策略 | 默认 |
| --- | --- |
| `completed` 任务保留期 | 30 天，之后归档到 `.mailtidy/archive/<yyyymm>/` |
| `failed` / `interrupted` 保留期 | 永久，直到用户 `mailtidy task purge <taskId>` |
| Checkpoint 文件 | 任务完成时立刻删（已不再需要） |
| Trace 文件 | 跟报告同期限 |

#### 跨任务关联

`TaskRecord.notes` 支持 `relatedTaskId` 引用：例如重操作建议被用户点"立即执行"后，新任务的 notes 引用原任务的 `id`，让 trace 回看时能跳过去。

### 4.5 存储与安全

#### 物理布局

```
~/.mailtidy/           # 用户全局（设置 / OAuth token）
.mailtidy/             # 项目本地（每个工作目录独立）
  memory.json          # AgentMemory
  tasks/               # 每任务一个 JSON
    <taskId>.json
  checkpoints/         # 每任务一个 checkpoint
    <taskId>.json
  reports/             # Markdown 报告
    <taskId>.md
  traces/              # JSONL 事件流
    <taskId>.jsonl
  archive/             # 过期任务归档
    <yyyymm>/
```

#### OAuth / Token / 隐私

| 项 | 存储 | 加密 |
| --- | --- | --- |
| Gmail OAuth refresh token | `~/.mailtidy/oauth/<account>.json` | OS keychain（Phase 4） |
| OpenAI / Anthropic API key | 环境变量优先；config 文件次之 | config 文件需 600 权限 |
| 邮件正文 | **不持久化**，只在内存 + checkpoint 内的 messages[] 中 | checkpoint 自动 redact PII（Phase 2） |
| Agent Memory | `.mailtidy/memory.json` → Phase 2 加密 SQLite | SQLCipher |

#### 用户的"忘记"权

| 命令 | 行为 |
| --- | --- |
| `mailtidy memory forget <sender>` | 删除该发件人偏好 |
| `mailtidy memory rollback <id>` | 回滚某条学习偏好 |
| `mailtidy task purge <taskId>` | 删除任务记录 + checkpoint + 报告 + trace |
| `mailtidy purge --all` | 删除整个 `.mailtidy/` 目录（保留 config） |
| `mailtidy export` | 导出所有偏好 + 任务记录到 JSON（GDPR 友好） |

---

## 五、工程进度与路线图

### 5.1 目录结构

```
src/
  agent/
    legacy.ts          ✅ 流水线 SOP 编排（Phase 0 兼容层，Phase 1 完成后删除）
    loop.ts            ⏳ pi-agent-core 主循环入口（Phase 1）
    policies.ts        ✅ DecisionPolicy：阈值 / 动作映射 / requiresConfirmation
    state.ts           ⏳ Phase 1 占位（pi AgentState 之上的任务态封装）
    context.ts         ⏳ Phase 1 占位（WorkingContext / EvidenceRef）
    compression.ts     ⏳ Phase 1 占位（长上下文压缩）
    deepThink.ts       ⏳ Phase 1 占位（主动调查触发结果）
    exits.ts           ✅ ExitReason 枚举 + 退出助手
    recovery.ts        ✅ CheckpointStore + 恢复扫描原语
    planner.ts         ⏳ Phase 1 占位（tool-use 输出 → PlannedStep）
    executor.ts        ⏳ Phase 1 占位（PlannedStep → ToolObservation）
    trace.ts           ⏳ Phase 1 占位（事件流）
    skills/            ✅ 四条 SOP markdown（运行时 loader Phase 1 接入）
  data/
    models.ts          ✅ EmailMessage / EmailJudgment / AgentPlan / ExecutionResult / Category / ActionType / StyleProfile
    memory.ts          ✅ AgentMemory + JsonMemoryStore
    tasks.ts           ✅ TaskRecord + JsonTaskStore（恢复层基础）
    reports.ts         ✅ cleanupReport / dailyBrief / subscriptionsMarkdown / subscriptionsCsv
    categories.ts      ⏳ 占位
    summaries.ts       ⏳ 占位
    learning.ts        ⏳ Phase 2
    repositories.ts    ⏳ Phase 1-2
    database.ts        ⏳ Phase 2（SQLite + SQLCipher）
  llm/
    client.ts          ✅ LLMClient 接口 + ModelProfile
    router.ts          ✅ LLMRouter（按 purpose 选 client，支持 fallback）
    usage.ts           ✅ UsageLedger（token / 成本累计）
  integrations/
    email/
      base.ts          ✅ EmailConnector 接口（无 send，最小写动作集）
      mock.ts          ✅ MockEmailConnector（6 封样例 + 操作记录）
      gmail.ts         ⏳ Phase 4（先只读）
      outlook.ts       ⏳ Phase 4
    llm/
      heuristic.ts     ✅ HeuristicLLMClient（关键词兜底）
      openai.ts        ⏳ Phase 1（基于 @earendil-works/pi-ai）
      anthropic.ts     ⏳ Phase 1（基于 @earendil-works/pi-ai）
      local.ts         ⏳ Phase 1-3（本地模型 / Ollama）
    notification/
      base.ts          ⏳ Phase 2 接口
      slack.ts / telegram.ts / desktop.ts  ⏳ Phase 2
  tools/
    base.ts            ✅ ToolDefinition / ToolRisk（接口）
    email.ts / classify.ts / actions.ts / rules.ts / memory.ts / research.ts / user.ts / history.ts  ⏳ Phase 1
  interfaces/
    cli.ts             ✅ commander 入口 + 启动时 scanInterrupted + SIGINT
    prompts.ts         ✅ readline 提示器（pipe stdin 兼容）
    web/               ⏳ Phase 5（@earendil-works/pi-web-ui）
    desktop/           ⏳ Phase 5
  research/            ⏳ Phase 3 全部占位（planner / sources / phishing / risk）
  rules/               ⏳ Phase 3 全部占位（models / parser / matcher / store）
  ops/                 ⏳ Phase 1-2 全部占位（config / logging / scheduler / audit）
tests/                 ✅ vitest，含 recovery.test.ts + demo.test.ts
old/                   旧 Python 实现，DEPRECATED；不参与构建
```

顶层文件：

- `package.json` —— npm，Node 20+，依赖 `@earendil-works/pi-agent-core ^0.74.1` + `@earendil-works/pi-ai ^0.74.1` + `commander` + `vitest`
- `tsconfig.json` —— ES2022 + strict + `noUncheckedIndexedAccess` + `noImplicitOverride`
- `vitest.config.ts`
- `.nvmrc` —— `20`

### 5.2 当前已实现功能

Phase 0 流水线骨架已完整移植到 TypeScript：

- `MockEmailConnector`（6 封样例邮件覆盖所有分类）
- `HeuristicLLMClient`（关键词兜底，断网 / 没 API key / CI 都能跑）
- `DecisionPolicy`（阈值 + 动作映射 + 风险闸门）
- `LegacyMailTidyAgent`（四条 SOP 流水线编排）
- 报告生成器（Markdown + CSV）
- 本地 JSON 记忆（`JsonMemoryStore`）
- 4 条 demo (`npm run demo:{cleanup,brief,subscriptions,drafts}`) 全部端到端跑通

中断恢复层骨架：

- `JsonTaskStore` 任务记录生命周期（running / completed / interrupted / failed / cancelled）
- `CheckpointStore` 写盘原语（pi `agent.state.messages` + 预算快照）
- `ExitReason` 枚举（9 种退出原因）
- CLI 启动时 `scanInterrupted()` + 交互式 `[r]/[c]/[s]/[d]`
- SIGINT handler 框架（abort 钩子留给 Phase 1 接 pi）

测试与类型检查：

- vitest 7 个测试通过：`recovery.test.ts` 覆盖任务生命周期 / checkpoint 读写 / 用户输入解析；`demo.test.ts` 覆盖 cleanup + draft + subscription scan 端到端
- `tsc --noEmit` strict 模式 0 错
- Phase 1.1 工具集已**全部就位**：email (`fetch_recent_email` / `search_email`) / classify (`classify_email`) / actions (`apply_email_action`) / user (`ask_user`) / memory (`recall_memory` / `write_memory`) 是实功能；rules (`match_rules`) / research (`web_search` / `verify_domain`) / history (`read_trace_slice` / `read_report_summary` / `read_original_record`) 是 schema-defined stub，schema + 限频齐全，后端等 Phase 1.8 / Phase 3。`createMailTidyTools()` 聚合注册入口；`tests/tools.test.ts` 5 个用例覆盖 registry / dry-run / memory 读写 / stub 行为
- Phase 1.2 最小主循环已落地：[src/agent/loop.ts](src/agent/loop.ts) 不再 throw，入口会创建 `TaskRecord`，通过工具注册表执行 fetch → classify → plan → apply → report，并在每个 observe 后写 `CheckpointStore`。当前是 deterministic planner 版本，完整 pi `Agent` tool-use 推理在 1.3/1.4 替换内部实现
- Phase 1.3a pi 工具适配层已落地：[src/tools/pi.ts](src/tools/pi.ts) 将 MailTidy `ToolDefinition` 转成 pi `AgentTool`，复用现有 JSON schema（TypeBox `Type.Unsafe` 包装），高风险工具默认 sequential；`tests/pi-tools.test.ts` 覆盖形状转换、执行与结构化 details 保留
- Phase 1.3b pi lifecycle hook 层已落地：[src/agent/piHooks.ts](src/agent/piHooks.ts) 提供 `beforeToolCall` 风险闸门、`afterToolCall` checkpoint + task progress 写盘、`shouldStopAfterTurn` step budget 停止判断；`tests/pi-hooks.test.ts` 覆盖高风险阻断与 checkpoint/任务进度持久化
- Phase 1.3c pi Agent 工厂已落地：[src/agent/piAgent.ts](src/agent/piAgent.ts) 装配 system prompt、pi tools、checkpoint messages 与 lifecycle hooks；`tests/pi-agent.test.ts` 用 `registerFauxProvider()` 无网络实例化真实 pi `Agent`，覆盖 state 装配
- Phase 1.3d pi runner 已落地：[src/agent/piRunner.ts](src/agent/piRunner.ts) 直接使用 pi 低层 `runAgentLoop` / `runAgentLoopContinue`，真正接入 `shouldStopAfterTurn`；[src/agent/loop.ts](src/agent/loop.ts) 支持 `engine: "pi"` 路由，默认 deterministic fallback 保持不变；`tests/pi-runner.test.ts` 和 `tests/loop.test.ts` 覆盖 faux provider tool-use 端到端
- Phase 1.3e CLI recovery demo continue 已接通：[src/interfaces/cli.ts](src/interfaces/cli.ts) 的 `recover --demo` 在用户选择 `[c] continue` 时加载 checkpoint 并调用 `runMailTidyPiAgent({ checkpoint })`；非 demo 仍明确提示等待真实 pi model adapter
- Phase 1.3f recovery continuation helper 已落地：[src/agent/recoveryContinue.ts](src/agent/recoveryContinue.ts) 把 interrupted task + checkpoint + pi model + tools 续跑到 completed；`tests/recovery-continue.test.ts` 覆盖临时 state 下 checkpoint continue → completed
- Phase 1.4a cleanup CLI loop entry-point 已落地：`mailtidy run-cleanup --demo --agent` 走 [src/agent/loop.ts](src/agent/loop.ts) 的 `runAgentLoop()`，默认不带 `--agent` 仍走 legacy pipeline 保持兼容；已手动验证 `npm run dev -- run-cleanup --demo --agent --auto-confirm`
- Phase 1.4b 其余 SOP loop entry-point 已落地：`daily-brief --demo --agent` / `subscription-scan --demo --agent` / `draft-replies --demo --agent` 现在都走同一个 [src/agent/loop.ts](src/agent/loop.ts)，默认不带 `--agent` 仍走 [src/agent/legacy.ts](src/agent/legacy.ts)；`tests/loop.test.ts` 增加三条覆盖
- Phase 1.4c 方案先行约束开始落地：`draft-replies --demo --agent` 默认只输出 `# Draft Replies Plan` 和 proposed drafts，不保存草稿；只有显式 `--auto-confirm` 才调用写入工具保存草稿
- Phase 1.4d cleanup 改为分级自动化：`run-cleanup --demo --agent` 默认自动执行低风险 `label` / `star`，中高风险动作保留到 "Confirmation Needed"；`--auto-confirm` 可执行确认门控动作
- Phase 1.4e kill/restart/continue 端到端验收已自动化：[tests/recovery-kill-e2e.test.ts](tests/recovery-kill-e2e.test.ts) 启动真实 CLI，等 checkpoint 落盘后 `SIGKILL` 主进程，再运行 `recover --demo` 并选择 `[c]`，验证任务从 checkpoint 续跑到 completed
- Phase 1.5a 真实 LLM 窄接口 adapter 已落地：[src/integrations/llm/openai.ts](src/integrations/llm/openai.ts) / [src/integrations/llm/anthropic.ts](src/integrations/llm/anthropic.ts) 通过 [src/integrations/llm/piClient.ts](src/integrations/llm/piClient.ts) 包装 `@earendil-works/pi-ai` 的 `getModels()` + `completeSimple()`，实现 `classifyEmail` / `draftReply` / `summarizeNewsletters`；`tests/llm-adapters.test.ts` 用注入 completion 无网络覆盖
- Phase 1.5b 决策策略支持可调自动化：`DecisionPolicy({ automationMode })` 支持 conservative / balanced / aggressive；`AgentMemory.actionPreferences` 可把 `label:Newsletters` 等动作设为 `confirm` 或 `auto`，测试覆盖偏好收紧默认自动化
- Phase 1.5c history 产物闭环已落地：主循环可注入 [src/agent/trace.ts](src/agent/trace.ts) 的 `TraceStore` 与 [src/data/reports.ts](src/data/reports.ts) 的 `ReportStore`，每个 deterministic checkpoint 会追加 `.mailtidy/traces/<taskId>.jsonl`，正常结束写 `.mailtidy/reports/<taskId>.md`，预算 / 错误退出写 `<taskId>-partial.md`；pi runner 也会把 pi event stream 和最终文本写入同一套目录。CLI `--agent` 路径现在把 `--state-dir` 传给 history tools，因此 `read_trace_slice` / `read_report_summary` 不再只是 schema，已经能回查本地任务产物。`tests/loop.test.ts` 覆盖完成报告、半成品报告和 trace 落盘。
- Phase 1.5d trace / planner 基础工具已补齐：[src/agent/trace.ts](src/agent/trace.ts) 支持 trace event 创建、JSONL 编解码、按 `stepId` 窗口切片；[src/agent/planner.ts](src/agent/planner.ts) 支持把 LLM 输出归一成 `tool_call` / `finish`；[tests/trace-planner.test.ts](tests/trace-planner.test.ts) 覆盖边界行为。
- 测试 37/37 全绿，`npm test` 与 `npm run typecheck` 均通过

**尚未实现**（下一阶段重点）：

- CLI / config 层选择真实 OpenAI / Anthropic provider，并在失败时降级到 `HeuristicLLMClient`
- 学习层、自定义规则引擎、研究型分析、真实邮箱、Web UI

### 5.3 路线图（Phase 1-5）

**核心顺序**：先 Agent 化、再学习化、再接真实邮箱、最后做 UI。**不能为了快接 Gmail 而跳过 Agent 化**。

#### Phase 1：Agent 化 + 主动调查 + 退出 + 兜底 + 任务记录（核心，2-3 周）

| # | 工作项 |
| --- | --- |
| 1.1 | ✅ 完成：[src/tools/](src/tools/) 8 个工具集（10 个 ToolDefinition）全部就位 —— email / classify / action / user / memory 是实功能；rules / research / history 是 schema-defined stub（schema + 限频齐全，返回 "not yet implemented"），等 Phase 1.8 + Phase 3 把后端补上 |
| 1.2 | ✅ 完成最小版 [src/agent/loop.ts](src/agent/loop.ts)：任务记录先写盘、工具注册表执行、每步 checkpoint、step budget 退出；完整 pi `Agent` 接入顺延到 1.3 |
| 1.3 | ✅ 完成：pi AgentTool 适配层；pi lifecycle hooks（风险闸门 / checkpoint / stop 条件）；pi `Agent` 工厂；pi runner + `runAgentLoop({ engine: "pi" })`；CLI `recover --demo` continue；recovery continuation helper + 测试 |
| 1.4 | ✅ 完成：4 条 SOP 均支持 `--agent` 接入 `runAgentLoop()`，默认 legacy 路径保持兼容；分级自动化默认行为和 kill/restart/continue e2e 均已覆盖 |
| 1.5 | 进行中：✅ OpenAI / Anthropic `LLMClient` adapter 已接 `@earendil-works/pi-ai`；✅ CLI `--agent` 已支持 `--llm-provider heuristic/openai/anthropic` + `--llm-model`，provider 失败会通过 `FallbackLLMClient` 降级到 heuristic 并 stderr 明示；✅ trace/report 产物落盘与 history 回查目录已闭环；下一步把 provider 选择从 CLI 参数下沉到 `ops/config.ts` 的持久配置 |
| 1.6 | 实现主动调查触发器：把 §2.8 触发条件接入 policy 层，命中时把"建议你接下来调查 X"作为 system 提示注入 State |
| 1.7 | 实现"建议丰富度"输出格式：给 `EmailJudgment` 增加 `Suggestion` 子结构（6 字段） |
| 1.8 | 加 trace / context 单测：低置信度邮件必须触发 `readEmail`，含可疑链接的邮件必须触发域名核对；超长 thread 必须先摘要压缩 |

**Phase 1 验收（必过）**：

- a. 跑 confidence=0.6 的邮件，Agent 自发拉全文重判，trace 含完整"想 → 查 → 再想"过程
- b. 跑伪造域名的邮件，Agent 自发触发域名核对，输出含 `Risk` 字段的富建议，**不直接归档**
- c. **退出条件可验证**：死循环 / 预算耗尽 / API 失效 / kill -9 场景下都能强制收尾、写任务记录终态、写半成品报告
- d. **断点续跑可验证**：跑到一半 `kill -9` 主进程，下次启动恢复检查必须发现 `interrupted` 任务并提示 `[r]/[c]/[s]/[d]`；选 [c] 从 `progress.phase` 接着跑，已 completed 的动作不重复
- e. **轻先重后可验证**：30 封邮件清理任务的 trace 必须看到完整四轮节奏
- f. **兜底可验证**：把 OpenAI key 设无效跑一次，Agent 必须降级到 `HeuristicLLMClient` 跑完，并在报告"主动告知"小节明确写"本次降级了，原因是 LLM 调用失败"

#### Phase 2：学习化 + 主动告知 + pending 队列（核心，1-2 周）

| # | 工作项 |
| --- | --- |
| 2.1 | [src/data/learning.ts](src/data/learning.ts)：纯函数，输入"信号"输出"偏好更新" |
| 2.2 | 同步学习信号：`askUser` 回调挂学习钩子，`applyAction` 后写决策日志 |
| 2.3 | 异步学习提议器：每次 Agent 启动时扫近 N 天决策日志，候选偏好作为开场提问 |
| 2.4 | 主动告知通道：每次任务结束扫描 §2.8 场景，最多浮 3 条按重要性排序的建议 |
| 2.5 | "少即是多"约束：拒绝过的建议 30 天内不重复浮出；`--quiet` 只在高风险时提醒 |
| 2.6 | 偏好加 `learnedFrom` / `learnedAt` 元数据；`mailtidy memory rollback <id>` 一键回滚 |
| 2.7 | 学习安全边界测试：单次反馈影响有上限；危险偏好必须 raise 而不是写入 |
| 2.8 | pending 队列 + 重操作执行机制 |

**Phase 2 验收**：

- 连续 3 次确认归档某发件人后，第 4 次 Agent 直接执行而不是问
- 用户没主动问，Agent 在日报里浮出"CEO 这周给你发了 3 封都没回"
- 单次主动告知不超过 3 条；同一条被拒后 30 天内不再出现
- **重操作可恢复**：上一轮停下的"重操作建议"，用户点"立即执行"后能作为独立任务跑完
- **半成品任务可恢复**：因预算耗尽收尾的任务，未完成项进 `pendingTasks`，下次 Agent 启动时自动接着做并明确告知

#### Phase 3：自定义规则 + 研究型分析 + 自我意识（差异化，1-2 周）

| # | 工作项 |
| --- | --- |
| 3.1 | [src/rules/](src/rules/)：规则模型 / NL 解析 / 匹配 / 冲突处理 / 持久化 |
| 3.2 | 规则引擎做成 `matchRules` 工具供主循环调用；冲突处理写在 `policies.ts` |
| 3.3 | [src/research/](src/research/)：研究计划与邮件动作分离；`webSearch` 工具；风险评级 |
| 3.4 | 研究反馈接入学习层：`trustedSources` 加权 |
| 3.5 | 防钓鱼专项 case：FTX 类邮件、伪造域名、伪造账户验证，写成回归测试 |
| 3.6 | §2.8 Agent 自我意识：定期统计自己的判断准确率、偏好年龄、单次任务工具消耗 |

**Phase 3 验收**：

- 一封钓鱼邮件提到 FTX 索赔且链接域名仿冒，Agent 自发触发研究、给出含 6 字段的富建议、风险评级为高、要求用户确认
- 用户改了 Agent 3 次某类邮件分类后，Agent 主动告知"我最近这类判断准确率 60%，规则我已调整"
- Agent 不会在 trace 里出现连续 5 次相同失败的工具调用而不收敛

#### Phase 4：接真实邮箱（落地，1-2 周）

| # | 工作项 |
| --- | --- |
| 4.1 | 实现 `GmailConnector`，**第一阶段只申请只读 scope**，写动作全部抛 |
| 4.2 | 用真实邮件跑一个月，每天对比 LLM 决策和你自己的判断，调阈值 / 调 prompt |
| 4.3 | 逐步开放写权限：`label` → `star` → `markRead` → `archive` → `saveDraft`，每开放一个先在 dry-run 跑一周 |
| 4.4 | 同步实现 `OutlookConnector`，复用 agent loop 与所有工具 |

**Phase 4 验收**：真实邮箱跑一周，trace 可回放，用户标注分类正确率 ≥ 85%；至少跑通 5 条主动告知场景。

#### Phase 5：交付与运维（持续）

| # | 工作项 |
| --- | --- |
| 5.1 | 定时任务（cron / launchd / GitHub Actions schedule） |
| 5.2 | Telegram / Slack / 桌面通知（主动告知推送到这些通道） |
| 5.3 | Web 或桌面 UI（基于 `@earendil-works/pi-web-ui` + `@earendil-works/pi-tui`）：计划展示 → 用户确认 → 执行可视化；trace 回看；偏好管理 + 一键回滚；主动告知 inbox |
| 5.4 | 审计日志、用户偏好导出 / 删除接口、加密备份 |

#### 核心顺序的理由

- **必须先做 Phase 1**：如果直接进 Phase 4 接 Gmail，项目就永远是流水线，LLM 沦为更贵的正则；接入越深、改成 Agent 越难。
- **必须先做 Phase 2**：Agent 没有学习就是"高级 chat 工具"，跑两周用户就发现它不会变聪明，留不住人。
- Phase 3 / 4 / 5 内部可以并行或调换顺序，但 Phase 1 / 2 必须先做。

### 5.4 MVP 里程碑

按"必须先做"的顺序排列，每个里程碑都有可验证的产出：

| # | 里程碑 | 对应 Phase 验收点 |
| --- | --- | --- |
| 1 | ✅ **流水线骨架**（TS 版）：mock connector、heuristic LLM、四条 SOP、报告、本地记忆、单测、CLI | （已完成） |
| 1.5 | ✅ **中断恢复骨架**：TaskRecord 生命周期、CheckpointStore、CLI 恢复扫描、SIGINT 框架 | （已完成；端到端验收等 Phase 1） |
| 2 | **Agent 主循环 + 主动调查 + 退出条件 + 兜底 + 任务记录端到端** | Phase 1 全部 a-f |
| 3 | **学习层 + 主动告知 + pending 队列** | Phase 2 全部 |
| 4 | **自定义规则引擎** | Phase 3.1 / 3.2 |
| 5 | **研究型分析 + 自我意识** | Phase 3.3 / 3.4 / 3.5 / 3.6 |
| 6 | **真实 LLM + Gmail 只读 dry-run** | Phase 4.1 / 4.2 |
| 7 | **Gmail 写权限分阶段开放 + 用户确认 UI** | Phase 4.3 |
| 8 | **订阅扫描增强**：闲置判断、月度对比、退订链接抽取，挂到 agent loop | （独立交付） |
| 9 | **定时任务 + 通知** | Phase 5.1 / 5.2 |
| 10 | **Outlook connector** | Phase 4.4 |
| 11 | **Web / 桌面 UI** | Phase 5.3 / 5.4 |

每一个里程碑都必须满足：**Agent 不只是执行了用户要求的事，还表现出"它在主动多想一步"**。如果某次升级后，Agent 行为相比上一版只是更快或更准，但没有更主动，这次升级就没达到 MailTidy 的产品定位。
