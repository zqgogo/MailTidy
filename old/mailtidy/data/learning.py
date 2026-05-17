"""Learning-layer placeholders for preference updates."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LearningSignal:
    """A user action or feedback item that may update long-term preference."""

    signal_type: str
    source_task_id: str | None
    payload: dict[str, object]


@dataclass(frozen=True)
class PreferenceUpdate:
    """A proposed preference update that must remain explainable."""

    key: str
    delta: object
    reason: str
