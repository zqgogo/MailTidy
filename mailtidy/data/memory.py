"""Agent 长期记忆：发件人偏好、写作风格、订阅历史。

记忆是 MailTidy "像助理而不是脚本" 的关键：用户每次确认 / 拒绝 / 修改，
都应该沉淀到这里，让下次 Agent 表现更贴近用户判断（学习层 §4.3 实现写入逻辑）。

当前实现：本地 JSON 文件，足够 demo 与单机使用。生产版应替换为：
- 加密的本地数据库（SQLite + SQLCipher，见 :mod:`mailtidy.data.database`），或
- 云端 KV / 用户私有存储，
但只需新增一个实现 ``load`` / ``save`` 接口的 Store 类即可，``AgentMemory``
本身的数据结构无需改动。

注意：``.mailtidy/memory.json`` 已在 ``.gitignore`` 中排除，
避免把用户偏好误推送到代码仓库。
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from mailtidy.data.models import StyleProfile


@dataclass
class SenderPreference:
    """单个发件人的长期偏好。"""

    category: str | None = None
    importance_delta: int = 0
    preferred_action: str | None = None
    ignored_count: int = 0


@dataclass
class AgentMemory:
    """Agent 的全部可持久化状态。"""

    sender_preferences: dict[str, SenderPreference] = field(default_factory=dict)
    action_preferences: dict[str, str] = field(default_factory=dict)
    style_profile: StyleProfile = field(default_factory=StyleProfile)
    subscription_history: list[dict[str, Any]] = field(default_factory=list)

    def preference_for(self, sender: str) -> SenderPreference:
        """查询某个发件人的偏好，找不到时返回空偏好（中性默认）。"""
        return self.sender_preferences.get(sender.lower(), SenderPreference())

    def remember_sender(self, sender: str, preference: SenderPreference) -> None:
        self.sender_preferences[sender.lower()] = preference


class JsonMemoryStore:
    """把 ``AgentMemory`` 序列化到本地 JSON 的存储实现。"""

    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> AgentMemory:
        if not self.path.exists():
            return AgentMemory()
        data = json.loads(self.path.read_text(encoding="utf-8"))
        sender_preferences = {
            sender: SenderPreference(**value)
            for sender, value in data.get("sender_preferences", {}).items()
        }
        style_profile = StyleProfile(**data.get("style_profile", {}))
        return AgentMemory(
            sender_preferences=sender_preferences,
            action_preferences=data.get("action_preferences", {}),
            style_profile=style_profile,
            subscription_history=data.get("subscription_history", []),
        )

    def save(self, memory: AgentMemory) -> None:
        """全量写回；如果记忆变得很大需要换成增量方案（例如订阅历史按月分文件）。"""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = asdict(memory)
        self.path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


__all__ = ["AgentMemory", "JsonMemoryStore", "SenderPreference"]
