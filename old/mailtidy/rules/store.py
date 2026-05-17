"""Rule persistence boundary."""

from __future__ import annotations

from dataclasses import dataclass, field

from mailtidy.rules.models import CustomRule


@dataclass
class InMemoryRuleStore:
    """Simple rule store used until database-backed storage lands."""

    rules: list[CustomRule] = field(default_factory=list)
