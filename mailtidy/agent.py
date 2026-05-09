from __future__ import annotations

import re
from datetime import datetime

from mailtidy.connectors import EmailConnector
from mailtidy.llm import LLMClient
from mailtidy.memory import AgentMemory
from mailtidy.models import ActionType, AgentPlan, Category, EmailMessage, ExecutionResult
from mailtidy.policies import DecisionPolicy
from mailtidy.reports import cleanup_report, daily_brief, subscriptions_csv, subscriptions_markdown


class MailTidyAgent:
    def __init__(
        self,
        connector: EmailConnector,
        llm: LLMClient,
        memory: AgentMemory | None = None,
        policy: DecisionPolicy | None = None,
    ) -> None:
        self.connector = connector
        self.llm = llm
        self.memory = memory or AgentMemory()
        self.policy = policy or DecisionPolicy()

    def plan_cleanup(
        self,
        hours: int = 24,
        limit: int = 200,
        custom_dimensions: list[str] | None = None,
    ) -> tuple[AgentPlan, list[EmailMessage]]:
        messages = self.connector.fetch_recent(hours=hours, limit=limit, unread_only=True)
        judgments = []
        for message in messages:
            judgment = self.llm.classify_email(message, custom_dimensions=custom_dimensions)
            judgments.append(self.policy.apply_memory(judgment, message.sender, self.memory))
        return self.policy.build_plan("inbox_cleanup", judgments), messages

    def execute_plan(self, plan: AgentPlan, auto_confirm: bool = False) -> ExecutionResult:
        result = ExecutionResult(processed=len(plan.judgments))
        for action in plan.actions:
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
        plan, messages = self.plan_cleanup(hours=hours, limit=limit, custom_dimensions=custom_dimensions)
        result = self.execute_plan(plan, auto_confirm=auto_confirm)
        newsletters = [message for message in messages if self._category_for(plan, message.id) == Category.NEWSLETTER]
        newsletter_summary = self.llm.summarize_newsletters(newsletters)
        return cleanup_report(plan, result, messages, newsletter_summary)

    def draft_replies(self, email_ids: list[str] | None = None) -> ExecutionResult:
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

    def daily_briefing(self, custom_dimensions: list[str] | None = None) -> str:
        plan, messages = self.plan_cleanup(hours=14, limit=200, custom_dimensions=custom_dimensions)
        return daily_brief(plan, messages)

    def scan_subscriptions(self) -> tuple[str, str]:
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
                current = seen.get(str(row["service_name"]).lower())
                if current is None or row["last_charge_date"] > current["last_charge_date"]:
                    seen[str(row["service_name"]).lower()] = row
        rows = sorted(seen.values(), key=lambda row: str(row["service_name"]))
        self.memory.subscription_history.append({"scanned_at": datetime.now().isoformat(), "items": rows})
        return subscriptions_markdown(rows), subscriptions_csv(rows)

    def _category_for(self, plan: AgentPlan, email_id: str) -> Category | None:
        for judgment in plan.judgments:
            if judgment.email_id == email_id:
                return judgment.category
        return None

    def _extract_subscription(self, message: EmailMessage) -> dict[str, object]:
        text = f"{message.subject} {message.snippet} {message.body}"
        amount_match = re.search(r"\$([0-9]+(?:\.[0-9]{2})?)", text)
        amount = float(amount_match.group(1)) if amount_match else 0.0
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
        service_lower = service.lower()
        if service_lower in {"netflix", "spotify", "hulu"}:
            return "entertainment"
        if service_lower in {"notion", "github", "slack"}:
            return "productivity"
        return "other"
