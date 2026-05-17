"""LLM 调用统计与成本归因。

这些结构会被 Agent trace、任务报告和 UI 成本卡共用，确保每一笔 token
消耗都能追溯到 task / step / model。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from mailtidy.llm.base import ModelProfile


@dataclass(frozen=True)
class LLMUsage:
    """单次 LLM 调用的 token 与成本数据。"""

    input_tokens: int = 0
    output_tokens: int = 0
    estimated_cost: float = 0.0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


@dataclass(frozen=True)
class LLMCallRecord:
    """一条可落盘的 LLM 调用记录。"""

    task_id: str
    step_id: str
    purpose: str
    model: str
    provider: str
    usage: LLMUsage
    started_at: datetime
    finished_at: datetime
    fallback_from: str | None = None


@dataclass
class LLMUsageTracker:
    """任务内的 LLM 调用统计器。"""

    records: list[LLMCallRecord] = field(default_factory=list)

    def estimate(self, profile: ModelProfile, input_tokens: int, output_tokens: int = 0) -> LLMUsage:
        """按模型价格估算成本；本地 / heuristic 模型价格为 0。"""
        cost = (input_tokens / 1000 * profile.input_cost_per_1k) + (
            output_tokens / 1000 * profile.output_cost_per_1k
        )
        return LLMUsage(input_tokens=input_tokens, output_tokens=output_tokens, estimated_cost=cost)

    def record(self, record: LLMCallRecord) -> None:
        self.records.append(record)

    @property
    def total_tokens(self) -> int:
        return sum(record.usage.total_tokens for record in self.records)

    @property
    def total_cost(self) -> float:
        return sum(record.usage.estimated_cost for record in self.records)

    def by_model(self) -> dict[str, LLMUsage]:
        totals: dict[str, LLMUsage] = {}
        for record in self.records:
            current = totals.get(record.model, LLMUsage())
            totals[record.model] = LLMUsage(
                input_tokens=current.input_tokens + record.usage.input_tokens,
                output_tokens=current.output_tokens + record.usage.output_tokens,
                estimated_cost=current.estimated_cost + record.usage.estimated_cost,
            )
        return totals


__all__ = ["LLMCallRecord", "LLMUsage", "LLMUsageTracker"]
