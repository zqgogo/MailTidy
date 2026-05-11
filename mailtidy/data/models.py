"""MailTidy 的核心数据模型。

这里定义了 Agent 在整条工作流里流转的所有数据结构：
- 邮件本身（``EmailMessage``）。
- Agent 对每封邮件的判断结果（``EmailJudgment``）。
- 由判断聚合出的执行计划（``AgentPlan`` / ``PlannedAction``）。
- 执行计划落地后的统计结果（``ExecutionResult``）。
- 用户的写作风格画像（``StyleProfile``）。

这些模型刻意做得"贫血"（dataclass 而非业务对象），让决策逻辑集中在
``agent/policies.py`` / ``agent/legacy.py`` 中，便于将来替换 LLM 或邮件后端时
不用改数据层。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


class Category(str, Enum):
    """邮件的默认分类。

    继承 ``str`` 是为了在 JSON 序列化和与 LLM 输出对齐时直接得到字符串值，
    例如 ``Category.IMPORTANT == "important"``。新增分类时，需要同步更新：
    - ``agent/policies.DecisionPolicy._action_for``：决定该类别对应的默认动作。
    - ``integrations/llm/heuristic.HeuristicLLMClient.classify_email``：本地启发式分类规则。
    - ``docs/agent-design.md``：产品文档中的"默认邮件分类"小节。
    """

    IMPORTANT = "important"          # 需要用户亲自关注的重要邮件
    ACTIONABLE = "actionable"        # 需要回复 / 审批 / 安排时间等具体动作
    NEWSLETTER = "newsletter"        # 订阅资讯
    PROMOTION = "promotion"          # 营销 / 折扣
    NOTIFICATION = "notification"    # 系统通知，如 GitHub / Slack
    SPAM = "spam"                    # 垃圾邮件
    TRANSACTIONAL = "transactional"  # 订单 / 账单 / 收据


class ActionType(str, Enum):
    """Agent 可以对邮件执行的动作枚举。

    设计原则：所有"破坏性"动作（归档、标记已读）都需要经过
    ``agent/policies.DecisionPolicy`` 决策并支持需要用户确认；
    草稿回复 ``DRAFT_REPLY`` 永远只写到草稿箱，不会自动发送。
    """

    ARCHIVE = "archive"
    LABEL = "label"
    STAR = "star"
    KEEP_UNREAD = "keep_unread"
    MARK_READ = "mark_read"
    DRAFT_REPLY = "draft_reply"
    REPORT_ONLY = "report_only"  # 仅出现在报告里，不触碰邮箱


@dataclass(frozen=True)
class EmailMessage:
    """一封原始邮件。

    使用 ``frozen=True`` 让它不可变，确保 Agent 在多个步骤之间传递时
    不会被中途修改（例如分类阶段不应修改 ``labels``）。所有"邮件被改了什么"
    都通过 ``PlannedAction`` 表达，而不是改这里的字段。
    """

    id: str
    sender: str
    subject: str
    snippet: str
    date: datetime
    has_attachment: bool = False
    unread: bool = True
    body: str = ""
    labels: list[str] = field(default_factory=list)


@dataclass
class EmailJudgment:
    """Agent 对单封邮件的判断结果。

    这是 LLM（或启发式回退）输出的标准结构。后续 ``DecisionPolicy``
    会基于它生成动作，所以新增字段时要同时考虑 policy 是否需要消费。
    """

    email_id: str
    category: Category
    confidence: float
    urgency: int
    reason: str
    action_suggestion: str
    requires_confirmation: bool = False
    custom_dimensions: dict[str, Any] = field(default_factory=dict)


@dataclass
class PlannedAction:
    """一条计划中的批量动作。"""

    action: ActionType
    email_ids: list[str]
    label: str | None = None
    draft_body: str | None = None
    reason: str = ""
    requires_confirmation: bool = False


@dataclass
class AgentPlan:
    """Agent 的"先想清楚再做"成果。"""

    intent: str
    judgments: list[EmailJudgment]
    actions: list[PlannedAction]
    human_prompts: list[str] = field(default_factory=list)


@dataclass
class ExecutionResult:
    """执行计划落地后的统计。"""

    processed: int
    archived: int = 0
    labeled: int = 0
    starred: int = 0
    marked_read: int = 0
    drafts_created: int = 0
    skipped_confirmation: int = 0
    notes: list[str] = field(default_factory=list)


@dataclass
class StyleProfile:
    """用户写作风格画像，供草稿生成器模仿。"""

    tone: str = "semi-formal"
    language: str = "mixed"
    opening_patterns: list[str] = field(default_factory=lambda: ["Hi"])
    closing_patterns: list[str] = field(default_factory=lambda: ["Best"])
    signature: str = ""
    brevity: str = "concise"


__all__ = [
    "ActionType",
    "AgentPlan",
    "Category",
    "EmailJudgment",
    "EmailMessage",
    "ExecutionResult",
    "PlannedAction",
    "StyleProfile",
]
