"""Execution boundary for applying planned tool calls."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ToolObservation:
    """Result returned from a tool call and merged back into AgentState."""

    tool_name: str
    ok: bool
    summary: str
    payload: dict[str, object] | None = None
