"""Audit-log boundary."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AuditEvent:
    """A compact audit record for user-visible actions."""

    action: str
    reason: str
    task_id: str | None = None
