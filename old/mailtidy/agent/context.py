"""Context window management for the future agent loop.

The agent should reason over compact summaries and evidence indexes by default,
then read original records only through bounded tools when needed.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class EvidenceRef:
    """A compact pointer back to a source record."""

    source_type: str
    source_id: str
    summary: str


@dataclass
class WorkingContext:
    """Compressed context passed to the LLM between loop iterations."""

    goal: str
    decisions_so_far: list[str] = field(default_factory=list)
    open_questions: list[str] = field(default_factory=list)
    evidence_index: list[EvidenceRef] = field(default_factory=list)

    def add_evidence(self, source_type: str, source_id: str, summary: str) -> None:
        """Attach an evidence pointer without storing full source content."""

        self.evidence_index.append(EvidenceRef(source_type, source_id, summary))
