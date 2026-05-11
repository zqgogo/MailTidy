"""Email integration package."""

from mailtidy.integrations.email.base import EmailConnector
from mailtidy.integrations.email.mock import MockEmailConnector

__all__ = ["EmailConnector", "MockEmailConnector"]
