"""Notification integrations."""

from mailtidy.integrations.notification.base import Notifier
from mailtidy.integrations.notification.desktop import DesktopNotifier
from mailtidy.integrations.notification.slack import SlackNotifier
from mailtidy.integrations.notification.telegram import TelegramNotifier

__all__ = ["DesktopNotifier", "Notifier", "SlackNotifier", "TelegramNotifier"]
