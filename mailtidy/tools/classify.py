"""Classification tool namespace.

Re-exports the ``LLMClient`` interface so future tool wrappers can depend on
it without reaching into the integrations package directly.
"""

from mailtidy.integrations.llm.base import LLMClient

__all__ = ["LLMClient"]
