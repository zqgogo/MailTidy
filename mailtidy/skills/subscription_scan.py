"""Subscription scanning skill wrapper."""

from __future__ import annotations

from mailtidy.agent.legacy import MailTidyAgent


def run(agent: MailTidyAgent) -> tuple[str, str]:
    """Run the legacy subscription scan SOP through the new skill namespace."""
    return agent.scan_subscriptions()
