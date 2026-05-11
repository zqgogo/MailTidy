"""Task journal records for resumable agent runs."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class TaskStatus(str, Enum):
    """Lifecycle states for a MailTidy task."""

    CREATED = "created"
    RUNNING = "running"
    FINISHED = "finished"
    WAITING_USER = "waiting_user"
    EXHAUSTED = "exhausted"
    FAILED = "failed"
    INTERRUPTED = "interrupted"


@dataclass
class TaskRecord:
    """Minimal task record used by the future journal store."""

    task_id: str
    kind: str
    goal: dict[str, object]
    status: TaskStatus = TaskStatus.CREATED
    progress: dict[str, object] = field(default_factory=dict)
