"""Email tool namespace.

The agent loop will register read/write email tools (``read_email``,
``mark_read``, ``archive``, ...) here. For now we just re-export the
``EmailConnector`` interface so other modules can type against it.
"""

from mailtidy.integrations.email.base import EmailConnector

__all__ = ["EmailConnector"]
