"""LLM 层的稳定抽象。

这一层不绑定任何供应商。Agent、tools、skills 只依赖这里定义的接口；
OpenAI、Anthropic、本地模型、启发式兜底都放在 ``mailtidy.integrations.llm``。
这样以后替换模型时，只换配置和 adapter，不改主循环。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from mailtidy.data.models import EmailJudgment, EmailMessage, StyleProfile


@dataclass(frozen=True)
class ModelProfile:
    """一个可选模型的能力和成本画像。"""

    name: str
    provider: str
    input_cost_per_1k: float = 0.0
    output_cost_per_1k: float = 0.0
    context_window: int | None = None
    supports_tools: bool = True
    supports_local: bool = False


class LLMClient(ABC):
    """LLM 能力的最小接口集合。

    保持接口"窄"是有意为之的：prompt 工程、token 计数、模型路由、重试策略、
    降级策略等都由 LLM 层和具体 adapter 承担，Agent 主流程只关心结构化结果。
    """

    @property
    @abstractmethod
    def profile(self) -> ModelProfile:
        """返回当前模型的名称、供应商和成本画像。"""
        raise NotImplementedError

    @abstractmethod
    def classify_email(self, message: EmailMessage, custom_dimensions: list[str] | None = None) -> EmailJudgment:
        raise NotImplementedError

    @abstractmethod
    def draft_reply(self, message: EmailMessage, style: StyleProfile) -> str:
        raise NotImplementedError

    @abstractmethod
    def summarize_newsletters(self, messages: list[EmailMessage]) -> str:
        raise NotImplementedError


__all__ = ["LLMClient", "ModelProfile"]
