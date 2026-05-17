"""Rule matching boundary."""

from __future__ import annotations

from mailtidy.rules.models import CustomRule


def match_rules(rules: list[CustomRule], message_text: str) -> list[CustomRule]:
    """Return rules whose name appears in the message text.

    This placeholder keeps the new module importable until the real matcher is
    implemented.
    """

    lowered = message_text.lower()
    return [rule for rule in rules if rule.name.lower() in lowered]
