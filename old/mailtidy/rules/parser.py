"""Natural-language rule parser boundary."""

from __future__ import annotations


def parse_rule_text(text: str) -> dict[str, object]:
    """Return a conservative placeholder parse for future rule extraction."""

    return {"source_text": text, "requires_confirmation_before_create": True}
