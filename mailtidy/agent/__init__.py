"""Agent kernel package.

This package is the new home for the Reason-Act-Observe runtime. The legacy
``MailTidyAgent`` (pipeline-style SOP orchestrator) lives in
:mod:`mailtidy.agent.legacy` and is re-exported here for backward compatibility
with existing CLI / tests until ``mailtidy.agent.loop`` fully replaces it.
"""

from __future__ import annotations

from mailtidy.agent.context import EvidenceRef, WorkingContext
from mailtidy.agent.deep_think import DeepThinkResult, OriginalRecordCheck
from mailtidy.agent.legacy import MailTidyAgent
from mailtidy.agent.loop import AgentLoop
from mailtidy.agent.policies import DecisionPolicy
from mailtidy.agent.state import AgentState, BudgetState

__all__ = [
    "AgentLoop",
    "AgentState",
    "BudgetState",
    "DecisionPolicy",
    "DeepThinkResult",
    "EvidenceRef",
    "MailTidyAgent",
    "OriginalRecordCheck",
    "WorkingContext",
]
