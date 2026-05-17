"""Notification integration boundary."""

from __future__ import annotations

from typing import Protocol


class Notifier(Protocol):
    """Sends proactive notifications to external channels."""

    def notify(self, title: str, body: str) -> None:
        """Deliver a notification."""
