"""本地开发 / 单测用的假邮箱实现。

特点：
- 内置一组覆盖常见分类的样例邮件（重要 / newsletter / 促销 / 通知 / 账单）。
- 写动作不真的修改邮件，只把操作字符串追加到 ``self.operations`` 里，
  让单测可以断言"是否调用过 archive:m3"。
"""

from __future__ import annotations

from datetime import datetime, timedelta

from mailtidy.data.models import EmailMessage
from mailtidy.integrations.email.base import EmailConnector


class MockEmailConnector(EmailConnector):
    """固定 6 封样例邮件、把所有写动作记录到字符串列表里的本地 connector。"""

    def __init__(self) -> None:
        now = datetime.now()
        # 6 封样例邮件，故意覆盖每种分类，让 run-cleanup demo 一次跑全所有分支
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
        # 去掉外层引号，让 ``"payment receipt"`` 这样的查询能正确匹配
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
        # 截断到 24 字符，避免单测断言时受 LLM 输出长短影响
        self.operations.append(f"draft:{email_id}:{body[:24]}")


__all__ = ["MockEmailConnector"]
