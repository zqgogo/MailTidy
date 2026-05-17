"""Summary compression helpers for long-running agent tasks."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CompressedSummary:
    """A compressed summary plus enough metadata to audit its source."""

    text: str
    source_refs: list[str]
    facts: list[str]
    inferences: list[str]


def needs_compression(text: str, max_chars: int = 24_000) -> bool:
    """Return True when the working context should be summarized again."""

    return len(text) > max_chars
