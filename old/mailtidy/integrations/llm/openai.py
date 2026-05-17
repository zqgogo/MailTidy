"""OpenAI tool-use client placeholder."""

from __future__ import annotations

from mailtidy.llm.base import LLMClient, ModelProfile


class OpenAILLMClient(LLMClient):
    """Future OpenAI implementation."""

    @property
    def profile(self) -> ModelProfile:
        return ModelProfile(
            name="openai-default",
            provider="openai",
            supports_tools=True,
        )
