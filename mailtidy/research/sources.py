"""Source tracking for research analysis."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SourceCitation:
    """A source used to support a research conclusion."""

    title: str
    url: str
    summary: str
