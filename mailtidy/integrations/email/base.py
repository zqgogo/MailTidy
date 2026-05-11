"""邮件连接器抽象：Agent 与外部邮箱之间唯一的 IO 边界。

设计原则：
- 接口只暴露最小必需动作（fetch / search / archive / label / star / mark_read / save_draft）。
- **永远不暴露 ``send`` 接口**：从架构上杜绝"自动替用户发邮件"。
- 写动作支持批量 ``email_ids``，方便未来对接 Gmail batch API 节省调用量。

接入真实 Gmail / Outlook 时按以下步骤：
1. 在 ``mailtidy/integrations/email/{gmail,outlook}.py`` 实现 ``EmailConnector`` 子类。
2. 第一阶段只实现读权限，写动作抛 ``NotImplementedError``。
3. 跑 ``run-cleanup`` 验证分类质量后，再逐步开放写权限。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from mailtidy.data.models import EmailMessage


class EmailConnector(ABC):
    """所有邮箱后端必须实现的接口。"""

    @abstractmethod
    def fetch_recent(self, hours: int = 24, limit: int = 200, unread_only: bool = True) -> list[EmailMessage]:
        """拉取最近 ``hours`` 小时内的邮件，最多 ``limit`` 封。"""
        raise NotImplementedError

    @abstractmethod
    def search(self, query: str, months: int = 6) -> list[EmailMessage]:
        """按查询字符串搜索最近 ``months`` 个月内的邮件，主要给订阅扫描用。"""
        raise NotImplementedError

    @abstractmethod
    def archive(self, email_ids: list[str]) -> None:
        """批量归档（不删除）。"""
        raise NotImplementedError

    @abstractmethod
    def label(self, email_ids: list[str], label: str) -> None:
        """批量打标签，标签若不存在应自动创建。"""
        raise NotImplementedError

    @abstractmethod
    def star(self, email_ids: list[str]) -> None:
        raise NotImplementedError

    @abstractmethod
    def mark_read(self, email_ids: list[str]) -> None:
        raise NotImplementedError

    @abstractmethod
    def save_draft(self, email_id: str, body: str) -> None:
        """生成草稿，**仅保存到草稿箱，不发送**。"""
        raise NotImplementedError


__all__ = ["EmailConnector"]
