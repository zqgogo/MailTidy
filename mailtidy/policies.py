from __future__ import annotations

from collections import defaultdict

from mailtidy.memory import AgentMemory
from mailtidy.models import ActionType, AgentPlan, Category, EmailJudgment, PlannedAction


class DecisionPolicy:
    def __init__(
        self,
        archive_threshold: float = 0.85,
        mark_read_threshold: float = 0.82,
        auto_archive_promotions: bool = False,
    ) -> None:
        self.archive_threshold = archive_threshold
        self.mark_read_threshold = mark_read_threshold
        self.auto_archive_promotions = auto_archive_promotions

    def apply_memory(self, judgment: EmailJudgment, sender: str, memory: AgentMemory) -> EmailJudgment:
        preference = memory.preference_for(sender)
        if preference.category:
            judgment.category = Category(preference.category)
            judgment.reason = f"User preference for sender overrides classification. {judgment.reason}"
            judgment.confidence = max(judgment.confidence, 0.93)
        judgment.urgency = max(1, min(5, judgment.urgency + preference.importance_delta))
        return judgment

    def build_plan(self, intent: str, judgments: list[EmailJudgment]) -> AgentPlan:
        grouped: dict[tuple[ActionType, str | None, bool], list[str]] = defaultdict(list)
        prompts: list[str] = []

        for judgment in judgments:
            action, label, requires_confirmation = self._action_for(judgment)
            grouped[(action, label, requires_confirmation)].append(judgment.email_id)

        actions: list[PlannedAction] = []
        for (action, label, requires_confirmation), email_ids in grouped.items():
            if requires_confirmation:
                prompts.append(
                    f"Found {len(email_ids)} high-confidence spam/promotion email(s). Archive them?"
                )
            actions.append(
                PlannedAction(
                    action=action,
                    email_ids=email_ids,
                    label=label,
                    reason=f"Policy selected {action.value}",
                    requires_confirmation=requires_confirmation,
                )
            )

        return AgentPlan(intent=intent, judgments=judgments, actions=actions, human_prompts=prompts)

    def _action_for(self, judgment: EmailJudgment) -> tuple[ActionType, str | None, bool]:
        if judgment.category in {Category.SPAM, Category.PROMOTION}:
            if judgment.confidence >= self.archive_threshold:
                return ActionType.ARCHIVE, None, not self.auto_archive_promotions
            return ActionType.REPORT_ONLY, None, False
        if judgment.category == Category.NEWSLETTER:
            return ActionType.LABEL, "Newsletters", False
        if judgment.category == Category.NOTIFICATION and judgment.confidence >= self.mark_read_threshold:
            return ActionType.MARK_READ, None, False
        if judgment.category in {Category.IMPORTANT, Category.ACTIONABLE}:
            return ActionType.STAR, None, False
        if judgment.category == Category.TRANSACTIONAL:
            return ActionType.LABEL, "Receipts", False
        return ActionType.REPORT_ONLY, None, False
