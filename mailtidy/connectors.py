from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timedelta

from mailtidy.models import EmailMessage


class EmailConnector(ABC):
    @abstractmethod
    def fetch_recent(self, hours: int = 24, limit: int = 200, unread_only: bool = True) -> list[EmailMessage]:
        raise NotImplementedError

    @abstractmethod
    def search(self, query: str, months: int = 6) -> list[EmailMessage]:
        raise NotImplementedError

    @abstractmethod
    def archive(self, email_ids: list[str]) -> None:
        raise NotImplementedError

    @abstractmethod
    def label(self, email_ids: list[str], label: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def star(self, email_ids: list[str]) -> None:
        raise NotImplementedError

    @abstractmethod
    def mark_read(self, email_ids: list[str]) -> None:
        raise NotImplementedError

    @abstractmethod
    def save_draft(self, email_id: str, body: str) -> None:
        raise NotImplementedError


class MockEmailConnector(EmailConnector):
    def __init__(self) -> None:
        now = datetime.now()
        self.messages = [
            EmailMessage("m1", "ceo@example.com", "Need your approval today", "Please approve the Q2 budget by 5pm.", now - timedelta(hours=1)),
            EmailMessage("m2", "news@productweekly.com", "Product Weekly #182", "AI tools, SaaS metrics, and three long reads.", now - timedelta(hours=2)),
            EmailMessage("m3", "deals@shop.example", "70% off today only", "Flash sale ends tonight.", now - timedelta(hours=3)),
            EmailMessage("m4", "github@github.com", "[MailTidy] CI failed", "Build failed on main branch.", now - timedelta(hours=4)),
            EmailMessage("m5", "billing@notion.so", "Your Notion receipt", "Payment receipt: you were charged $10.00 for your monthly plan.", now - timedelta(days=10), body="Your plan: Plus. Amount: $10.00 monthly."),
            EmailMessage("m6", "billing@netflix.com", "Your Netflix payment", "Payment receipt: your card was charged $15.99.", now - timedelta(days=20), body="Your plan: Premium. Amount: $15.99 monthly."),
        ]
        self.operations: list[str] = []

    def fetch_recent(self, hours: int = 24, limit: int = 200, unread_only: bool = True) -> list[EmailMessage]:
        cutoff = datetime.now() - timedelta(hours=hours)
        messages = [message for message in self.messages if message.date >= cutoff]
        if unread_only:
            messages = [message for message in messages if message.unread]
        return messages[:limit]

    def search(self, query: str, months: int = 6) -> list[EmailMessage]:
        phrase = query.strip().strip('"').lower()
        cutoff = datetime.now() - timedelta(days=months * 30)
        results = []
        for message in self.messages:
            haystack = f"{message.sender} {message.subject} {message.snippet} {message.body}".lower()
            if message.date >= cutoff and phrase in haystack:
                results.append(message)
        return results

    def archive(self, email_ids: list[str]) -> None:
        self.operations.append(f"archive:{','.join(email_ids)}")

    def label(self, email_ids: list[str], label: str) -> None:
        self.operations.append(f"label:{label}:{','.join(email_ids)}")

    def star(self, email_ids: list[str]) -> None:
        self.operations.append(f"star:{','.join(email_ids)}")

    def mark_read(self, email_ids: list[str]) -> None:
        self.operations.append(f"mark_read:{','.join(email_ids)}")

    def save_draft(self, email_id: str, body: str) -> None:
        self.operations.append(f"draft:{email_id}:{body[:24]}")
