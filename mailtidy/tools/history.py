"""Bounded history lookup tools for deep thinking."""

from __future__ import annotations


DEFAULT_EMAIL_MAX_CHARS = 6_000
DEFAULT_MEMORY_MAX_ITEMS = 8
DEFAULT_TRACE_WINDOW = 3


def clamp_text(text: str, max_chars: int = DEFAULT_EMAIL_MAX_CHARS) -> str:
    """Return a bounded slice of original text for safe LLM context use."""

    return text[:max_chars]
