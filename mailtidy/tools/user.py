"""User-interaction tool namespace."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class UserQuestion:
    """Question that pauses an agent task until the user responds."""

    text: str
    options: list[str] | None = None
