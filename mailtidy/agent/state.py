"""State objects for the future Reason-Act-Observe agent loop.

These structures are intentionally small for now. They give the new directory
layout a concrete import target without changing the current pipeline runtime.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class BudgetState:
    """Tracks the loop budget that protects the agent from runaway work."""

    steps_left: int = 12
    tokens_left: int = 50_000
    wall_seconds_left: int = 120


@dataclass
class AgentState:
    """Mutable state carried between Reason, Act, and Observe steps."""

    task_id: str
    goal: str
    budget: BudgetState = field(default_factory=BudgetState)
    working_summary: str = ""
    evidence_index: list[dict[str, str]] = field(default_factory=list)
    pending_questions: list[str] = field(default_factory=list)
