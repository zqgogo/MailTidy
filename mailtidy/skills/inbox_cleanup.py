"""Inbox cleanup skill wrapper."""

from __future__ import annotations

from mailtidy.agent.legacy import MailTidyAgent


def run(agent: MailTidyAgent, **kwargs: object) -> str:
    """Run the legacy cleanup SOP through the new skill namespace."""
    return agent.run_cleanup(**kwargs)
