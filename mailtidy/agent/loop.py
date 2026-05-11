"""Future Reason-Act-Observe loop entry point.

The current production path still lives in :mod:`mailtidy.agent`. This module is
the stable home for the upcoming multi-step agent loop.
"""

from __future__ import annotations

from mailtidy.agent.state import AgentState


class AgentLoop:
    """Placeholder loop object for the new agent architecture."""

    def __init__(self, state: AgentState) -> None:
        self.state = state
