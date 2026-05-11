"""Anthropic tool-use client placeholder."""

from __future__ import annotations

from mailtidy.llm.base import LLMClient, ModelProfile


class AnthropicLLMClient(LLMClient):
    """Future Anthropic implementation."""

    @property
    def profile(self) -> ModelProfile:
        return ModelProfile(
            name="anthropic-default",
            provider="anthropic",
            supports_tools=True,
        )
