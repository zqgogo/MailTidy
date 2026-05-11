"""Draft-replies skill wrapper."""

from __future__ import annotations

from mailtidy.agent.legacy import MailTidyAgent
from mailtidy.data.models import ExecutionResult


def run(agent: MailTidyAgent) -> ExecutionResult:
    """Run the legacy draft-replies SOP through the new skill namespace."""
    return agent.draft_replies()
