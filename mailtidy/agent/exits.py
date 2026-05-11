"""Exit-condition names for the future agent loop."""

from __future__ import annotations

from enum import Enum


class ExitReason(str, Enum):
    """Terminal reasons enforced by the loop, not chosen freely by the LLM."""

    FINISHED = "finished"
    STEP_BUDGET_EXHAUSTED = "step_budget_exhausted"
    TOKEN_BUDGET_EXHAUSTED = "token_budget_exhausted"
    WALL_TIME_EXHAUSTED = "wall_time_exhausted"
    TOOL_FAILURES = "tool_failures"
    REPEATED_ACTION = "repeated_action"
    USER_INTERRUPTED = "user_interrupted"
    FATAL_ERROR = "fatal_error"
    WAITING_USER = "waiting_user"
