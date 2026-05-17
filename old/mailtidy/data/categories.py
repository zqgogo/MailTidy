"""Category, action, and risk enums."""

from __future__ import annotations

from enum import Enum

from mailtidy.data.models import ActionType, Category


class RiskLevel(str, Enum):
    """Risk levels used by research and confirmation policies."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


__all__ = ["ActionType", "Category", "RiskLevel"]
