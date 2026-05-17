"""Planning boundary for converting LLM tool-use output into actions."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PlannedStep:
    """A single planned tool call or finish decision."""

    kind: str
    tool_name: str | None = None
    arguments: dict[str, object] | None = None
