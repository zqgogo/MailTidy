"""Runtime configuration defaults."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RuntimeConfig:
    """Default budgets used by the future agent loop."""

    max_steps: int = 12
    max_tokens: int = 50_000
    max_wall_seconds: int = 120
    working_summary_max_tokens: int = 6_000
