"""LLM integration package."""

from mailtidy.integrations.llm.base import LLMClient
from mailtidy.integrations.llm.heuristic import HeuristicLLMClient

__all__ = ["HeuristicLLMClient", "LLMClient"]
