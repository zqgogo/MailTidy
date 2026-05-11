"""Phishing-oriented research helpers."""

from __future__ import annotations


def domains_match(sender_domain: str, official_domain: str) -> bool:
    """Return True only for exact domain matches in the placeholder version."""

    return sender_domain.lower() == official_domain.lower()
