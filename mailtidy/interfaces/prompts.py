"""Interactive prompt helpers."""

from __future__ import annotations

from enum import Enum


class PromptChoice(str, Enum):
    """Common task recovery choices."""

    RESUME = "resume"
    CONTINUE = "continue"
    SKIP = "skip"
    DISCARD = "discard"
