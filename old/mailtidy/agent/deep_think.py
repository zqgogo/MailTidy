"""Deep-thinking primitives for high-risk or ambiguous email decisions."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class OriginalRecordCheck:
    """A bounded read of an original source used to verify a summary."""

    source_type: str
    source_id: str
    range_hint: str


@dataclass
class DeepThinkResult:
    """Structured output from a deep-thinking pass."""

    conclusion: str
    confidence: float
    used_summaries: list[str] = field(default_factory=list)
    checked_originals: list[OriginalRecordCheck] = field(default_factory=list)
    remaining_uncertainty: str | None = None
    next_action: str | None = None
