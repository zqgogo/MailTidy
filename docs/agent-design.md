# MailTidy 邮件 Agent 设计文档

## 一句话产品

MailTidy 是一个会阅读收件箱、判断邮件意图和优先级、生成处理计划，并在关键动作前征求确认的邮件 Agent。它可以清理收件箱、整理标签、生成摘要、扫描订阅费，并为需要回复的邮件生成草稿。

## 核心原则

MailTidy 不是一组固定自动化规则，而应该像一个谨慎的助理：

1. 观察：获取近期邮件、历史偏好和用户自定义维度。
2. 思考：分类、判断紧急度、识别不确定性，并生成执行计划。
3. 询问：对可能让用户意外的动作先请求确认。
4. 执行：归档、打标签、加星标、标记已读、生成草稿和报告。
5. 学习：从用户确认、拒绝、修改草稿、长期忽略某些发件人等行为中更新偏好。

真正的价值不是“帮你点按钮”，而是减少用户每天面对邮件时的认知负担：哪些要处理、哪些可以忽略、哪些只是信息、哪些正在悄悄花钱。

## 目标用户

- 所有被邮件淹没的人。
- 每天需要处理大量内外部沟通的职场人。
- 管理者、CEO、创业者等需要早晨快速掌握局面的用户。
- 经常忘记订阅扣费、想看清固定支出的人。

## 内置 SOP

| SOP | 目标 | 默认频率 | 当前状态 |
| --- | --- | --- | --- |
| 收件箱清理 | 分类近期邮件，归档促销/垃圾，保留重要邮件 | 每天 9:00 + 手动 | 已有 demo 骨架 |
| 智能回复草拟 | 学习写作风格，为 actionable 邮件生成回复草稿 | 清理后触发 + 手动 | 已有 demo 骨架 |
| 订阅费扫描器 | 从邮箱中找出付费订阅和月度支出 | 每月 + 手动 | 已有 demo 骨架 |
| 邮件摘要日报 | 生成 2 分钟可读的早晨 briefing | 每天 7:30 | 已有 demo 骨架 |

## 用户自定义维度

除了默认分类，用户可以增加自己的判断维度，例如：

- 发件人重要性
- 项目或客户
- 是否需要回复
- 是否涉及费用、账单或报销
- 是否与家庭、私人事项有关
- 是否在等待对方
- 是否涉及法务、财务、安全风险

这些维度不是简单映射到文件夹，而是作为 Agent 决策时的上下文。例如同样是 GitHub 通知，有的用户认为是低优先级，有的用户认为 CI 失败必须当天处理。

## 用户自定义规则

后续需要把用户自定义规则单独抽成文件存放，例如：

```text
mailtidy/
  custom_rules.py        自定义规则模型、解析、匹配和冲突处理
  custom_rules_store.py  自定义规则的持久化存储
```

也可以根据项目复杂度合并为一个 `rules/` 目录：

```text
mailtidy/rules/
  models.py      规则数据结构
  parser.py      自然语言规则解析
  matcher.py     邮件匹配与优先级判断
  store.py       JSON/SQLite/云端存储
```

自定义规则必须和主流程解耦，不能散落在 `agent.py` 或 `policies.py` 里。Agent 在分类后、生成执行计划前，统一调用规则引擎进行覆盖、补充或降级。

### 自然语言添加规则

用户应该可以直接用自然语言告诉 Agent 自己的偏好，例如：

```text
ftx 的邮件都放好。
```

这类表达是模糊的，但 Agent 不能要求用户必须写成规则语法。它应该先理解用户意图，再在不确定时追问或采用保守策略。

对“ftx 的邮件都放好”这句话，Agent 可以推断：

- 规则对象：发件人、域名、主题或正文中包含 `ftx` 的邮件。
- 用户意图：“放好”通常表示不要丢、不要归档到看不见的位置，而是整理到一个容易找到的地方。
- 默认动作：打标签 `FTX` 或 `Important/FTX`，保留未读或不自动归档。
- 风险判断：由于 `FTX` 可能涉及交易所、资产、法律、索赔或安全风险，应提高重要性。
- 不确定点：用户是否希望加星、保持未读、进入财务/法务标签、是否需要摘要提醒。

Agent 可以生成一个待确认规则：

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

如果用户表达更明确，例如：

```text
以后 boss@company.com 的邮件都加星并保持未读。
```

Agent 可以直接创建规则，并在创建后告知用户：

```text
已记住：来自 boss@company.com 的邮件会加星并保持未读。
```

### 规则类型

自定义规则至少支持这些类型：

- 发件人规则：来自某人、某域名、某组织的邮件。
- 主题/正文规则：包含某些关键词、项目名、订单号、客户名。
- 语义规则：例如“像客户投诉的邮件”“和融资相关的邮件”“可能影响账户安全的邮件”。
- 动作规则：加星、保持未读、归档、打标签、转入某类摘要。
- 提醒规则：当天提醒、日报置顶、需要用户确认。
- 禁止规则：永不删除、永不自动归档、永不标记已读。
- 研究规则：遇到某类邮件时需要联网搜索和分析。

### 规则冲突处理

规则可能冲突，例如：

- 用户说“GitHub 通知都标记已读”。
- 后来又说“GitHub CI failed 要算重要”。

处理原则：

1. 更具体的规则优先于更宽泛的规则。
2. 用户新规则优先于旧规则，但要保留历史。
3. 安全/财务/法务相关规则优先级更高。
4. 不确定时进入报告或请求确认，不静默执行高影响动作。

### 规则学习

Agent 不应该只被动接收规则，也应该从行为中主动提议：

- 用户连续 3 次把某个发件人的邮件打上同一个标签：建议创建规则。
- 用户连续拒绝归档某类促销邮件：降低该类邮件的自动归档倾向。
- 用户经常打开某类通知：提升重要性。
- 用户从不打开某类 newsletter：建议降级或归档。

示例：

```text
我注意到你最近 4 次都把 FTX 相关邮件保留未读并加星。
以后我可以自动帮你这样处理，要记住这个偏好吗？
```

## 研究型邮件分析

MailTidy 的价值不能停留在“把邮件搬来搬去”。对于某些邮件，Agent 应该能识别出需要外部信息、时效性判断或背景分析，然后联网搜索、综合判断，并给出解释和建议。

### 什么时候需要搜索

以下情况应触发研究型分析：

- 金融、交易所、订阅、价格、退款、账单异常。
- 安全告警、数据泄露、账号风险、可疑登录。
- 法务、政策、合规、税务、签证、保险等高风险邮件。
- 新闻事件相关邮件，例如公司公告、裁员、产品关停、服务迁移。
- 邮件中提到用户不熟悉的公司、产品、域名、活动。
- 邮件要求用户点击链接、转账、验证身份或提供敏感信息。
- 邮件内容依赖当前事实，例如“服务将在某日期关闭”“价格即将上涨”。

### 研究型分析输出

对这类邮件，Agent 不应只说“重要”。它应该给出：

- 这封邮件在说什么。
- 为什么需要注意。
- 外部信息是否支持邮件内容。
- 是否存在诈骗、钓鱼或过期信息风险。
- 建议用户下一步做什么。
- 哪些地方仍然不确定。
- 使用了哪些来源。

示例输出：

```text
这封 FTX 相关邮件可能与债权索赔流程有关。我查到近期确实存在 FTX 债权人分配/索赔相关信息，但邮件里的链接域名和官方渠道不完全一致。建议不要直接点击邮件链接，先从官方索赔网站或法院文件入口进入核对。已为你加星、保持未读，并打上 FTX 标签。
```

### 研究动作和邮件动作分离

联网研究不等于执行邮箱操作。Agent 应先生成两类计划：

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

### 研究型学习

研究型分析也要进入记忆系统，而不是每次都从零开始。

Agent 需要学习：

- 用户关心哪些实体：例如 FTX、某客户、某银行、某项目。
- 用户偏好的风险等级：宁可多提醒还是少打扰。
- 用户信任哪些来源：官方公告、法院文件、银行官网、GitHub issue、公司博客等。
- 用户对某类建议的反馈：忽略、采纳、要求更多证据。
- 某些实体的长期处理方式：例如 FTX 相关邮件默认加星、保留未读、附带背景分析。

记忆示例：

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

这部分是 MailTidy 区别于普通自动化工具的关键：它不只是匹配规则，而是理解邮件背后的现实含义，并随着用户反馈越来越贴近用户的判断方式。

## 默认邮件分类

- `important`：需要用户亲自关注的重要邮件。
- `actionable`：需要回复、审批、注册、安排时间或执行某个动作。
- `newsletter`：订阅内容、资讯推送。
- `promotion`：营销、促销、折扣。
- `notification`：系统通知，例如 GitHub、Slack、银行、安全提醒。
- `spam`：垃圾邮件。
- `transactional`：订单确认、物流、收据、账单、发票。

## Agent 决策模型

每封邮件会先得到一个判断结果 `EmailJudgment`：

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
  }
}
```

然后 Agent 会把多封邮件合并成一个执行计划 `AgentPlan`：

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

这个设计让 MailTidy 先“想清楚要做什么”，再执行动作。后续接入真实 Gmail/Outlook 时，也可以先展示计划，再让用户批准。

## 确认策略

默认策略偏保守：

- 垃圾/促销邮件只有在置信度高于 `0.85` 时才进入归档计划。
- 默认归档前需要用户确认，除非用户开启自动归档偏好。
- 默认永不删除邮件。
- 默认永不自动发送回复，只保存草稿。
- `important` 和 `actionable` 邮件加星标，并保持未读。
- 低优先级系统通知只有在高置信度时才标记已读。
- 不确定的邮件只进入报告，不激进处理。

## 记忆与学习

Agent 需要长期记住用户偏好，当前代码已经有本地 JSON 记忆结构，后续可以替换成数据库或云端存储。

记忆内容包括：

- 发件人偏好：某个发件人默认重要、默认低优先级、默认归类。
- 处理偏好：用户更喜欢归档、删除、保留、打标签。
- 忽略模式：哪些发件人长期被忽略，可以未来自动降级。
- 写作风格：语气、语言、开头、结尾、签名、回复长短。
- 订阅扫描历史：用于和上月对比。

学习信号包括：

- 用户确认归档：类似邮件未来可提高自动处理置信度。
- 用户拒绝归档：记住该发件人或类别的例外。
- 用户修改草稿：更新写作风格。
- 用户长期忽略某个发件人：降低优先级。
- 用户经常给某个发件人加星或回复：提高优先级。

## SOP 1：收件箱清理

输入：

- 最近 24 小时邮件或最近 N 封未读邮件。
- 用户记忆。
- 用户自定义维度。

流程：

1. 获取候选邮件。
2. 使用低成本 LLM 或本地启发式分类器进行分类。
3. 应用用户记忆和置信度阈值。
4. 生成执行计划。
5. 对批量归档等动作请求确认。
6. 执行安全动作。
7. 生成清理报告。
8. 根据用户反馈更新记忆。

输出：

- 总处理数量。
- 已归档、已打标签、已标记已读、已加星标数量。
- 需要用户处理的邮件列表。
- 今日 newsletter 摘要。
- token 和成本估算。

## SOP 2：智能回复草拟

输入：

- 被标记为 `actionable` 的邮件。
- 邮件完整正文和对话上下文。
- 用户写作风格画像。

规则：

- 匹配用户语气和语言习惯。
- 不编造事实。
- 不确定的地方用 `[需要你补充]` 标记。
- 可以建议 reply、reply-all、forward，但不自动发送。
- 只保存到草稿箱。

## SOP 3：订阅费扫描器

输入：

- 最近 6 个月内与扣费、账单、订阅、续费有关的邮件。

流程：

1. 提取服务名、金额、币种、扣费周期、扣费日期、套餐、类别、退订链接。
2. 按服务去重，保留最新记录。
3. 计算月度和年度总支出。
4. 标记长期没有交互的疑似闲置订阅。
5. 导出 Markdown 和 CSV 报告。

产品冲击点：

第一次运行要让用户直接看到隐藏成本，例如：“你每月有 12 个订阅，共支出 $87。”

## SOP 4：邮件摘要日报

输入：

- 昨晚到今天早晨的未读邮件。

流程：

1. 为每封邮件打 1-5 分紧急度。
2. 分为“今天要处理”、“本周内重要”、“知悉即可”。
3. 输出发件人、主题、一句话摘要和建议动作。
4. 推送到 Telegram、Slack、桌面通知或邮件。

## 当前代码结构

```text
mailtidy/
  agent.py        Agent 编排和 SOP 工作流
  models.py       数据模型和枚举
  policies.py     决策阈值、确认策略和动作规划
  memory.py       本地 JSON 记忆存储
  custom_rules.py 自定义规则模型、解析、匹配和冲突处理，后续新增
  research.py     联网研究型邮件分析，后续新增
  connectors.py   邮件连接器接口和 mock 连接器
  llm.py          LLM 接口和本地启发式分类器
  reports.py      Markdown/CSV 报告生成
  cli.py          可运行 demo CLI
```

## 当前已实现功能

当前版本是一个本地可运行的 Agent 原型，重点验证产品和工程形态。

已完成：

- `EmailConnector` 抽象接口。
- `MockEmailConnector`，用于本地模拟邮箱。
- `LLMClient` 抽象接口。
- `HeuristicLLMClient`，用于本地模拟低成本 LLM 分类和回复草拟。
- 邮件分类：important、actionable、newsletter、promotion、notification、transactional。
- 基于置信度的决策策略。
- 促销/垃圾归档前确认机制。
- newsletter 自动打 `Newsletters` 标签。
- actionable/important 自动加星标。
- transactional 自动打 `Receipts` 标签。
- 清理报告生成。
- 邮件摘要日报生成。
- 订阅扫描 Markdown + CSV 导出。
- 智能回复草稿 demo，默认不会发送。
- 本地 JSON memory 结构。
- CLI demo。
- 单元测试。

可运行命令：

```bash
python -m mailtidy.cli run-cleanup --demo --dimension needs_reply --dimension project
python -m mailtidy.cli daily-brief --demo
python -m mailtidy.cli subscription-scan --demo
python -m mailtidy.cli draft-replies --demo
python -m unittest discover
```

## 当前进度

阶段：MVP 原型骨架完成。

当前代码可以证明这件事的核心闭环：

1. 邮件进入 Agent。
2. Agent 对每封邮件做分类、置信度和紧急度判断。
3. Agent 生成执行计划，而不是直接盲目操作。
4. 高影响动作需要确认。
5. 安全动作可以执行。
6. 用户得到清理报告、日报或订阅报告。
7. 后续可以通过 memory 学习偏好。

还未完成：

- 真实 Gmail OAuth。
- 真实 Outlook OAuth。
- 真实 LLM API 调用。
- 真实草稿写入 Gmail/Outlook。
- 定时任务。
- Telegram/Slack/桌面通知。
- 自定义规则文件与规则引擎。
- 用户自然语言添加规则。
- 模糊规则理解、追问和确认。
- 研究型邮件分析。
- 联网搜索、来源引用和建议生成。
- 研究型分析的用户反馈学习。
- 用户偏好的交互式反馈入口。
- 风格学习的真实“已发送邮件”分析。
- 订阅闲置判断和历史同比。
- Web UI 或桌面 UI。

## 下一步建议

优先级最高的是先补齐 Agent 智能层，再接入 Gmail 只读 dry-run。建议顺序：

1. 新增 `custom_rules.py` 或 `mailtidy/rules/`，把自定义规则从主流程中抽离。
2. 支持自然语言添加规则，并将规则解析成结构化策略。
3. 对模糊规则加入确认问题，例如“放好”应解释为加标签、加星、保持未读，还是移动到某个文件夹。
4. 新增 `research.py`，定义哪些邮件需要联网搜索、如何形成研究计划、如何输出解释和建议。
5. 把规则学习和研究型学习写入 memory。
6. 实现 `GmailConnector.fetch_recent()` 和 `GmailConnector.search()`。
7. 只申请读取权限，先不做归档/打标签。
8. 用真实邮件跑 `run-cleanup`，确认分类质量。
9. 接入真实 LLM 分类器，替换当前启发式分类。
10. 增加“展示计划 -> 用户确认 -> 执行动作”的交互层。
11. 再开放 Gmail 归档、打标签、加星标、保存草稿权限。

这样能避免产品变成死板自动化：先让 Agent 具备理解用户偏好、解释现实背景和持续学习的能力，再接真实邮箱动作。

## 生产集成边界

生产版需要实现：

- `EmailConnector`：Gmail 和 Outlook。
- `LLMClient`：OpenAI、Anthropic 或模型路由层。
- `CustomRuleEngine`：自然语言规则解析、存储、匹配和冲突处理。
- `ResearchEngine`：联网搜索、来源整理、风险判断和建议生成。
- `Notifier`：Slack、Telegram、邮件、桌面通知。
- 持久化 memory：本地数据库、云端数据库或用户私有存储。
- 审计日志：记录决策和动作，但默认不记录完整邮件正文。

## 安全边界

- OAuth scopes 按 SOP 最小化申请。
- token 存 OS keychain 或 secrets manager，不明文保存。
- 默认记录邮件元数据和决策，不记录完整敏感正文。
- 所有工作流支持 dry-run。
- 所有破坏性动作默认关闭。
- 支持 allowlist、blocklist、按发件人覆盖策略。

## MVP 里程碑

1. 本地 demo Agent、mock connector、memory、reports、tests。已完成。
2. 自定义规则文件与规则引擎。
3. 用户自然语言添加规则，包括模糊表达的澄清与确认。
4. 研究型邮件分析：联网搜索、来源引用、风险判断和建议。
5. 规则学习与研究型学习写入 memory。
6. Gmail 只读 dry-run。
7. 真实 LLM 分类器。
8. Gmail labels/archive/star/mark-read，带用户确认。
9. Gmail 草稿生成。
10. 订阅扫描增强：闲置判断、历史对比、退订链接。
11. 定时任务和通知。
12. Outlook connector。
