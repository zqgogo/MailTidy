"""决策策略：把 LLM 的判断翻译成具体可执行的动作计划。

这是 Agent 的"安全闸门"：所有"为什么这封邮件要做这件事"的规则都集中在这里，
``agent.legacy.MailTidyAgent`` / 未来 ``agent.loop`` 都不应该出现 if/else 决策分支。
这样未来接入 Gmail / Outlook 时，只要把 connector 实现替掉，决策行为完全一致。

设计思路：
1. ``apply_memory``：把用户长期偏好叠加到本次判断上（例如老板的邮件永远重要）。
2. ``build_plan``：按 (action, label, 是否需要确认) 三元组聚合，得到批量动作。
3. ``_action_for``：单封邮件 -> 单个动作的核心规则表。

后续如果要拆出"自定义规则引擎"（见 :mod:`mailtidy.rules`），应在 ``apply_memory``
之后、``build_plan`` 之前插入一层 ``CustomRuleEngine.apply``，避免污染本文件。
"""

from __future__ import annotations

from collections import defaultdict

from mailtidy.data.memory import AgentMemory
from mailtidy.data.models import (
    ActionType,
    AgentPlan,
    Category,
    EmailJudgment,
    PlannedAction,
)


class DecisionPolicy:
    """决策阈值与动作映射。

    阈值默认偏保守，宁可让用户多确认一次也不要静默归档错邮件：
    - ``archive_threshold = 0.85``：促销 / 垃圾邮件置信度低于该值时只进入报告，
      而不是放进归档计划。
    - ``mark_read_threshold = 0.82``：仅在高置信度时才自动标记通知类邮件已读。
    - ``auto_archive_promotions = False``：默认归档前需要用户确认。
    """

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
        """用用户的长期偏好覆盖本次判断。

        必须在 ``build_plan`` 之前调用，否则用户偏好不会影响最终动作。
        """
        preference = memory.preference_for(sender)
        if preference.category:
            judgment.category = Category(preference.category)
            judgment.reason = f"User preference for sender overrides classification. {judgment.reason}"
            # 拉高置信度，避免后面 confidence 阈值再把它过滤掉
            judgment.confidence = max(judgment.confidence, 0.93)
        # urgency 限制在 1~5 之间，避免偏好叠加后越界
        judgment.urgency = max(1, min(5, judgment.urgency + preference.importance_delta))
        return judgment

    def build_plan(self, intent: str, judgments: list[EmailJudgment]) -> AgentPlan:
        """把一批判断聚合成可批量执行的 ``AgentPlan``。"""
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
        """单封邮件 -> 单个动作的规则表。

        新增动作类型时务必同步更新 ``agent.legacy.MailTidyAgent.execute_plan`` 的分发逻辑。
        """
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


__all__ = ["DecisionPolicy"]
