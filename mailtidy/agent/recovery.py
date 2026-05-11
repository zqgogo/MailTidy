"""Task recovery semantics for resume and continue."""

from __future__ import annotations

from enum import Enum


class RecoveryMode(str, Enum):
    """How an interrupted task should restart."""

    RESUME = "resume"
    CONTINUE = "continue"
    SKIP = "skip"
    DISCARD = "discard"
