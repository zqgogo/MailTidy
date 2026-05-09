from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any


class Category(str, Enum):
    IMPORTANT = "important"
    ACTIONABLE = "actionable"
    NEWSLETTER = "newsletter"
    PROMOTION = "promotion"
    NOTIFICATION = "notification"
    SPAM = "spam"
    TRANSACTIONAL = "transactional"


class ActionType(str, Enum):
    ARCHIVE = "archive"
    LABEL = "label"
    STAR = "star"
    KEEP_UNREAD = "keep_unread"
    MARK_READ = "mark_read"
    DRAFT_REPLY = "draft_reply"
    REPORT_ONLY = "report_only"


@dataclass(frozen=True)
class EmailMessage:
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
    action: ActionType
    email_ids: list[str]
    label: str | None = None
    draft_body: str | None = None
    reason: str = ""
    requires_confirmation: bool = False


@dataclass
class AgentPlan:
    intent: str
    judgments: list[EmailJudgment]
    actions: list[PlannedAction]
    human_prompts: list[str] = field(default_factory=list)


@dataclass
class ExecutionResult:
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
    tone: str = "semi-formal"
    language: str = "mixed"
    opening_patterns: list[str] = field(default_factory=lambda: ["Hi"])
    closing_patterns: list[str] = field(default_factory=lambda: ["Best"])
    signature: str = ""
    brevity: str = "concise"
