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
- 用户偏好的交互式反馈入口。
- 风格学习的真实“已发送邮件”分析。
- 订阅闲置判断和历史同比。
- Web UI 或桌面 UI。

## 下一步建议

优先级最高的是接入 Gmail 的只读 dry-run：

1. 实现 `GmailConnector.fetch_recent()` 和 `GmailConnector.search()`。
2. 只申请读取权限，先不做归档/打标签。
3. 用真实邮件跑 `run-cleanup`，确认分类质量。
4. 接入真实 LLM 分类器，替换当前启发式分类。
5. 增加“展示计划 -> 用户确认 -> 执行动作”的交互层。
6. 再开放 Gmail 归档、打标签、加星标、保存草稿权限。

这样能最快验证产品价值，同时把权限风险控制住。

## 生产集成边界

生产版需要实现：

- `EmailConnector`：Gmail 和 Outlook。
- `LLMClient`：OpenAI、Anthropic 或模型路由层。
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
2. Gmail 只读 dry-run。
3. 真实 LLM 分类器。
4. Gmail labels/archive/star/mark-read，带用户确认。
5. Gmail 草稿生成。
6. 订阅扫描增强：闲置判断、历史对比、退订链接。
7. 定时任务和通知。
8. Outlook connector。
