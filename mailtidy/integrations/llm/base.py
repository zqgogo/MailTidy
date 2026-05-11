"""LLM 抽象接口。

为什么要做抽象：
- 让本地开发 / 单测无需消耗真实 API 额度（``HeuristicLLMClient`` 兜底）。
- 接入真实 LLM（OpenAI / Anthropic / 模型路由）时只需新增一个 ``LLMClient`` 子类，
  Agent 主流程一行不用改。

接口约定（凡是 LLMClient 子类都要满足）：
- ``classify_email``：必须返回 ``EmailJudgment``，category ∈ ``Category`` 枚举。
- ``draft_reply``：永远返回字符串，**不能**触发任何邮箱动作。
- ``summarize_newsletters``：可以接受空列表，返回友好提示。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from mailtidy.data.models import EmailJudgment, EmailMessage, StyleProfile


class LLMClient(ABC):
    """LLM 能力的最小接口集合。

    保持接口"窄"是有意为之的——把 prompt 工程、token 计数、模型路由、
    重试策略等通通放到具体实现里，Agent 主流程不应该感知这些细节。
    """

    @abstractmethod
    def classify_email(self, message: EmailMessage, custom_dimensions: list[str] | None = None) -> EmailJudgment:
        raise NotImplementedError

    @abstractmethod
    def draft_reply(self, message: EmailMessage, style: StyleProfile) -> str:
        raise NotImplementedError

    @abstractmethod
    def summarize_newsletters(self, messages: list[EmailMessage]) -> str:
        raise NotImplementedError


__all__ = ["LLMClient"]
