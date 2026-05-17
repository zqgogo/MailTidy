"""Trace event structures for the agent loop."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TraceEvent:
    """One observable Reason-Act-Observe step."""

    task_id: str
    step: int
    thought_summary: str
    tool_name: str | None
    observation_summary: str | None
    exit_check: str
