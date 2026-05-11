"""Repository interfaces for data access boundaries."""

from __future__ import annotations

from typing import Protocol


class TaskRepository(Protocol):
    """Persistence boundary for task records."""

    def save(self, record: object) -> None:
        """Persist a task record."""
