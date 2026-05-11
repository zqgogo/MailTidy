"""Local model client placeholder.

This adapter is for Ollama, LM Studio, llama.cpp servers, or any future local
runtime. It implements the same ``LLMClient`` contract as hosted providers.
"""

from __future__ import annotations

from mailtidy.llm.base import LLMClient, ModelProfile


class LocalLLMClient(LLMClient):
    """Future local model implementation."""

    @property
    def profile(self) -> ModelProfile:
        return ModelProfile(
            name="local-default",
            provider="local",
            input_cost_per_1k=0.0,
            output_cost_per_1k=0.0,
            supports_tools=True,
            supports_local=True,
        )


__all__ = ["LocalLLMClient"]
