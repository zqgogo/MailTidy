"""Summary and evidence-index records for compressed agent context."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class SummaryRef:
    """A reference from a compressed summary back to original evidence."""

    source_type: str
    source_id: str
    range_hint: str | None = None


@dataclass
class WorkingSummary:
    """Durable task summary saved at checkpoints."""

    task_id: str
    phase: str
    text: str
    refs: list[SummaryRef] = field(default_factory=list)
    version: int = 1
