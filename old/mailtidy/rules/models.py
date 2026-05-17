"""Custom rule model placeholders."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class CustomRule:
    """User-defined rule parsed from natural language or explicit config."""

    name: str
    conditions: dict[str, object]
    actions: list[dict[str, object]] = field(default_factory=list)
    risk_level: str = "low"
