"""Research planning helpers."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ResearchPlan:
    """External research plan kept separate from email actions."""

    queries: list[str] = field(default_factory=list)
    email_action_plan: list[dict[str, object]] = field(default_factory=list)
