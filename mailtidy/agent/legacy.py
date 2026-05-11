"""遗留的"流水线 SOP 编排"实现。

这是 Phase 1 之前的 ``MailTidyAgent`` 类：把"获取邮件 -> LLM 判断 -> 套用策略
-> 生成执行计划 -> 执行 -> 出报告"几件事串成 SOP 工作流。该文件刻意保持薄：
所有真正的"决策智慧"都委托给：

- :mod:`mailtidy.llm`：稳定 LLM 抽象、路由、统计。
- :mod:`mailtidy.integrations.llm`：具体模型 / API / 本地运行时适配。
- :mod:`mailtidy.agent.policies`：哪些邮件做哪些动作、什么时候要确认。
- :mod:`mailtidy.integrations.email`：与真实 / Mock 邮箱的 IO 边界。
- :mod:`mailtidy.data.memory`：长期偏好与历史。

四个 SOP 对应四个 public 方法：

- ``run_cleanup``：收件箱清理 + 报告。
- ``draft_replies``：为 actionable 邮件批量草拟回复。
- ``daily_briefing``：早晨 2 分钟阅读的日报。
- ``scan_subscriptions``：订阅费扫描，导出 Markdown / CSV。

Phase 1 完成后，所有 SOP 会改写成 ``mailtidy.agent.loop`` 的 entry-point；
本类暂时保留以保证 CLI / 单测兼容。
"""

from __future__ import annotations

import re
from datetime import datetime

from mailtidy.agent.policies import DecisionPolicy
from mailtidy.data.memory import AgentMemory
from mailtidy.data.models import (
    ActionType,
    AgentPlan,
    Category,
    EmailMessage,
    ExecutionResult,
)
from mailtidy.data.reports import (
    cleanup_report,
    daily_brief,
    subscriptions_csv,
    subscriptions_markdown,
)
from mailtidy.integrations.email.base import EmailConnector
from mailtidy.llm.base import LLMClient


class MailTidyAgent:
    """负责把所有依赖装配起来并驱动 SOP。

    使用依赖注入的方式接收 ``connector`` / ``llm`` / ``memory`` / ``policy``，
    单测里可以用 Mock 完全跑通；接入真实 Gmail 时只要换两个实现即可。
    """

    def __init__(
        self,
        connector: EmailConnector,
        llm: LLMClient,
        memory: AgentMemory | None = None,
        policy: DecisionPolicy | None = None,
    ) -> None:
        self.connector = connector
        self.llm = llm
        # memory / policy 缺省时使用空记忆与默认阈值，方便临时跑 demo
        self.memory = memory or AgentMemory()
        self.policy = policy or DecisionPolicy()

    # ------------------------------------------------------------------ #
    # SOP 1：收件箱清理
    # ------------------------------------------------------------------ #
    def plan_cleanup(
        self,
        hours: int = 24,
        limit: int = 200,
        custom_dimensions: list[str] | None = None,
    ) -> tuple[AgentPlan, list[EmailMessage]]:
        """生成清理计划但不执行，便于 UI 先展示给用户审核。"""
        messages = self.connector.fetch_recent(hours=hours, limit=limit, unread_only=True)
        judgments = []
        for message in messages:
            judgment = self.llm.classify_email(message, custom_dimensions=custom_dimensions)
            judgments.append(self.policy.apply_memory(judgment, message.sender, self.memory))
        return self.policy.build_plan("inbox_cleanup", judgments), messages

    def execute_plan(self, plan: AgentPlan, auto_confirm: bool = False) -> ExecutionResult:
        """实际调用 connector 落地计划中的动作。"""
        result = ExecutionResult(processed=len(plan.judgments))
        for action in plan.actions:
            # 安全闸门：未拿到 auto_confirm，跳过所有需要确认的动作
            if action.requires_confirmation and not auto_confirm:
                result.skipped_confirmation += len(action.email_ids)
                continue
            if action.action == ActionType.ARCHIVE:
                self.connector.archive(action.email_ids)
                result.archived += len(action.email_ids)
            elif action.action == ActionType.LABEL and action.label:
                self.connector.label(action.email_ids, action.label)
                result.labeled += len(action.email_ids)
            elif action.action == ActionType.STAR:
                self.connector.star(action.email_ids)
                result.starred += len(action.email_ids)
            elif action.action == ActionType.MARK_READ:
                self.connector.mark_read(action.email_ids)
                result.marked_read += len(action.email_ids)
        return result

    def run_cleanup(
        self,
        hours: int = 24,
        limit: int = 200,
        custom_dimensions: list[str] | None = None,
        auto_confirm: bool = False,
    ) -> str:
        """完整的"清理 + 报告"端到端流程，CLI 直接调用这一个方法即可。"""
        plan, messages = self.plan_cleanup(hours=hours, limit=limit, custom_dimensions=custom_dimensions)
        result = self.execute_plan(plan, auto_confirm=auto_confirm)
        newsletters = [message for message in messages if self._category_for(plan, message.id) == Category.NEWSLETTER]
        newsletter_summary = self.llm.summarize_newsletters(newsletters)
        return cleanup_report(plan, result, messages, newsletter_summary)

    # ------------------------------------------------------------------ #
    # SOP 2：智能回复草拟
    # ------------------------------------------------------------------ #
    def draft_replies(self, email_ids: list[str] | None = None) -> ExecutionResult:
        """为 actionable 的邮件生成回复草稿，永远只写到草稿箱不发送。"""
        plan, messages = self.plan_cleanup(hours=24, limit=200)
        actionable = [
            message
            for message in messages
            if self._category_for(plan, message.id) == Category.ACTIONABLE
            and (email_ids is None or message.id in email_ids)
        ]
        result = ExecutionResult(processed=len(actionable))
        for message in actionable:
            draft = self.llm.draft_reply(message, self.memory.style_profile)
            self.connector.save_draft(message.id, draft)
            result.drafts_created += 1
        return result

    # ------------------------------------------------------------------ #
    # SOP 3：日报
    # ------------------------------------------------------------------ #
    def daily_briefing(self, custom_dimensions: list[str] | None = None) -> str:
        """早晨日报。

        窗口取 14 小时，覆盖"昨晚到今天早晨"的未读邮件，
        日报本身是只读的，不会触发任何邮箱动作。
        """
        plan, messages = self.plan_cleanup(hours=14, limit=200, custom_dimensions=custom_dimensions)
        return daily_brief(plan, messages)

    # ------------------------------------------------------------------ #
    # SOP 4：订阅费扫描
    # ------------------------------------------------------------------ #
    def scan_subscriptions(self) -> tuple[str, str]:
        """从最近 6 个月邮件里挖出订阅费。"""
        # 多个查询覆盖不同邮件提供方的描述词，互相补充
        queries = [
            '"subscription confirmation"',
            '"payment receipt"',
            '"renewal notice"',
            '"monthly charge"',
            '"your plan"',
            '"billing statement"',
        ]
        seen: dict[str, dict[str, object]] = {}
        for query in queries:
            for message in self.connector.search(query, months=6):
                row = self._extract_subscription(message)
                # 同一服务保留 last_charge_date 更新的一条，避免重复计数
                current = seen.get(str(row["service_name"]).lower())
                if current is None or row["last_charge_date"] > current["last_charge_date"]:
                    seen[str(row["service_name"]).lower()] = row
        rows = sorted(seen.values(), key=lambda row: str(row["service_name"]))
        # 写入历史用于将来"和上月对比"功能
        self.memory.subscription_history.append({"scanned_at": datetime.now().isoformat(), "items": rows})
        return subscriptions_markdown(rows), subscriptions_csv(rows)

    # ------------------------------------------------------------------ #
    # 辅助方法
    # ------------------------------------------------------------------ #
    def _category_for(self, plan: AgentPlan, email_id: str) -> Category | None:
        """在计划里反查某封邮件被归到哪一类。"""
        for judgment in plan.judgments:
            if judgment.email_id == email_id:
                return judgment.category
        return None

    def _extract_subscription(self, message: EmailMessage) -> dict[str, object]:
        """从一封订阅 / 账单邮件里抠出结构化字段。

        当前是粗暴的正则版本，足够 demo 用，生产版应改用 LLM 抽取。
        """
        text = f"{message.subject} {message.snippet} {message.body}"
        amount_match = re.search(r"\$([0-9]+(?:\.[0-9]{2})?)", text)
        amount = float(amount_match.group(1)) if amount_match else 0.0
        # 用域名前缀近似服务名，例如 billing@notion.so -> Notion
        service = message.sender.split("@")[-1].split(".")[0].title()
        plan_match = re.search(r"(Premium|Plus|Pro|Basic|Team|Enterprise)", text, re.IGNORECASE)
        return {
            "service_name": service,
            "monthly_amount": amount,
            "currency": "USD",
            "billing_cycle": "monthly",
            "last_charge_date": message.date.date().isoformat(),
            "plan_name": plan_match.group(1).title() if plan_match else "Unknown",
            "unsubscribe_link": "",
            "category": self._subscription_category(service),
        }

    def _subscription_category(self, service: str) -> str:
        """为服务名打一个粗略的分类标签，供报告分组使用。"""
        service_lower = service.lower()
        if service_lower in {"netflix", "spotify", "hulu"}:
            return "entertainment"
        if service_lower in {"notion", "github", "slack"}:
            return "productivity"
        return "other"


__all__ = ["MailTidyAgent"]
