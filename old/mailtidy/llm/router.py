"""模型路由与降级策略。

Router 不直接实现模型能力，只负责按用途选择 client。具体调用仍由
``LLMClient`` adapter 完成。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from mailtidy.llm.base import LLMClient


@dataclass(frozen=True)
class ModelRoute:
    """某类任务使用哪个模型，以及失败时降级到哪个模型。"""

    purpose: str
    primary: str
    fallback: str | None = None
    max_input_tokens: int | None = None


@dataclass
class LLMRouter:
    """按 purpose 选择模型 client。"""

    clients: dict[str, LLMClient]
    routes: dict[str, ModelRoute] = field(default_factory=dict)
    default_model: str = "heuristic"

    def client_for(self, purpose: str) -> LLMClient:
        route = self.routes.get(purpose)
        model_name = route.primary if route else self.default_model
        return self.clients[model_name]

    def fallback_for(self, purpose: str) -> LLMClient | None:
        route = self.routes.get(purpose)
        if route is None or route.fallback is None:
            return None
        return self.clients.get(route.fallback)


__all__ = ["LLMRouter", "ModelRoute"]
