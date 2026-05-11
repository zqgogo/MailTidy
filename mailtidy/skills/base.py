"""Skill abstraction for high-level SOPs."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SkillSpec:
    """Describes a skill that can be scheduled by the agent loop."""

    name: str
    description: str
    default_budget_steps: int = 12
