"""Data layer package."""

from mailtidy.data.categories import ActionType, Category, RiskLevel
from mailtidy.data.summaries import SummaryRef, WorkingSummary
from mailtidy.data.tasks import TaskRecord, TaskStatus

__all__ = [
    "ActionType",
    "Category",
    "RiskLevel",
    "SummaryRef",
    "TaskRecord",
    "TaskStatus",
    "WorkingSummary",
]
