"""Dedicated LLM layer.

This package owns model abstraction, routing, token accounting, and cost data.
Provider-specific clients live under ``mailtidy.integrations.llm``.
"""

from mailtidy.llm.base import LLMClient, ModelProfile
from mailtidy.llm.router import LLMRouter, ModelRoute
from mailtidy.llm.usage import LLMCallRecord, LLMUsage, LLMUsageTracker

__all__ = [
    "LLMCallRecord",
    "LLMClient",
    "LLMRouter",
    "LLMUsage",
    "LLMUsageTracker",
    "ModelProfile",
    "ModelRoute",
]
