"""Classification tool namespace.

Re-exports the ``LLMClient`` interface so future tool wrappers can depend on
the dedicated LLM layer without reaching into provider integrations.
"""

from mailtidy.llm.base import LLMClient

__all__ = ["LLMClient"]
