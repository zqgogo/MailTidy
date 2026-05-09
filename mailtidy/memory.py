from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from mailtidy.models import StyleProfile


@dataclass
class SenderPreference:
    category: str | None = None
    importance_delta: int = 0
    preferred_action: str | None = None
    ignored_count: int = 0


@dataclass
class AgentMemory:
    sender_preferences: dict[str, SenderPreference] = field(default_factory=dict)
    action_preferences: dict[str, str] = field(default_factory=dict)
    style_profile: StyleProfile = field(default_factory=StyleProfile)
    subscription_history: list[dict[str, Any]] = field(default_factory=list)

    def preference_for(self, sender: str) -> SenderPreference:
        return self.sender_preferences.get(sender.lower(), SenderPreference())

    def remember_sender(self, sender: str, preference: SenderPreference) -> None:
        self.sender_preferences[sender.lower()] = preference


class JsonMemoryStore:
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
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = asdict(memory)
        self.path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
