"""Tool abstraction exposed to LLM tool-use runtimes."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class ToolRisk(str, Enum):
    """Risk level used by the agent loop before allowing a tool call."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass(frozen=True)
class ToolSpec:
    """Static metadata for one callable tool."""

    name: str
    description: str
    risk: ToolRisk = ToolRisk.LOW
    schema: dict[str, object] = field(default_factory=dict)
