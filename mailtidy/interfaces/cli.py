"""MailTidy 命令行入口，目前只支持 ``--demo`` 模式。

用法示例：

    python -m mailtidy.interfaces.cli run-cleanup --demo --dimension needs_reply
    python -m mailtidy.interfaces.cli daily-brief --demo
    python -m mailtidy.interfaces.cli subscription-scan --demo
    python -m mailtidy.interfaces.cli draft-replies --demo

每次执行结束都会把内存里的 ``AgentMemory`` 写回 JSON，让偏好与订阅历史
跨次累积。后续接入真实邮箱时，应去掉 ``--demo`` 限制并新增：
``--connector gmail`` / ``--connector outlook`` 等选项；
透明度相关的 ``--show-thinking`` / ``--trace-full`` / ``--paranoid`` 等开关
会在 ``mailtidy.agent.loop`` 落地后接入此处（详见 docs §2.5）。
"""

from __future__ import annotations

import argparse
from pathlib import Path

from mailtidy.agent.legacy import MailTidyAgent
from mailtidy.data.memory import JsonMemoryStore
from mailtidy.integrations.email.mock import MockEmailConnector
from mailtidy.integrations.llm.heuristic import HeuristicLLMClient


def build_demo_agent(memory_path: Path) -> tuple[MailTidyAgent, JsonMemoryStore]:
    """组装一个完全本地、无外部依赖的 demo Agent。

    返回 ``(agent, store)`` 两个对象，让调用方在跑完 SOP 之后能调用
    ``store.save(agent.memory)`` 把记忆持久化。
    """
    store = JsonMemoryStore(memory_path)
    agent = MailTidyAgent(
        connector=MockEmailConnector(),
        llm=HeuristicLLMClient(),
        memory=store.load(),
    )
    return agent, store


def main() -> None:
    """argparse 入口，按子命令分发到不同 SOP。"""
    parser = argparse.ArgumentParser(description="MailTidy email agent")
    # 把 memory 路径做成可选参数，方便单测和多用户场景指向不同文件
    parser.add_argument("--memory", default=".mailtidy/memory.json", help="Path to local memory JSON")
    subparsers = parser.add_subparsers(dest="command", required=True)

    cleanup = subparsers.add_parser("run-cleanup", help="Run inbox cleanup")
    cleanup.add_argument("--demo", action="store_true", help="Use mock email connector")
    # auto-confirm 一旦传入，所有"需要确认"的动作（如归档促销）会被直接执行
    cleanup.add_argument("--auto-confirm", action="store_true", help="Approve confirmation-gated actions")
    # --dimension 可重复传入，例如 --dimension needs_reply --dimension project
    cleanup.add_argument("--dimension", action="append", default=[], help="Custom dimension to classify")

    brief = subparsers.add_parser("daily-brief", help="Generate daily briefing")
    brief.add_argument("--demo", action="store_true", help="Use mock email connector")
    brief.add_argument("--dimension", action="append", default=[], help="Custom dimension to classify")

    scan = subparsers.add_parser("subscription-scan", help="Find subscriptions")
    scan.add_argument("--demo", action="store_true", help="Use mock email connector")

    drafts = subparsers.add_parser("draft-replies", help="Draft replies for actionable messages")
    drafts.add_argument("--demo", action="store_true", help="Use mock email connector")

    args = parser.parse_args()
    # 强制要求 --demo 是为了防止用户在还没接入真实 connector 时误以为已经在
    # 操作真邮箱。接入 GmailConnector 后应替换为 connector 选择逻辑。
    if not getattr(args, "demo", False):
        raise SystemExit("Only --demo is implemented. Add a real EmailConnector for Gmail/Outlook.")

    agent, store = build_demo_agent(Path(args.memory))

    if args.command == "run-cleanup":
        print(agent.run_cleanup(custom_dimensions=args.dimension, auto_confirm=args.auto_confirm))
    elif args.command == "daily-brief":
        print(agent.daily_briefing(custom_dimensions=args.dimension))
    elif args.command == "subscription-scan":
        markdown, csv_text = agent.scan_subscriptions()
        print(markdown)
        print("\nCSV\n")
        print(csv_text)
    elif args.command == "draft-replies":
        result = agent.draft_replies()
        print(f"Created {result.drafts_created} draft(s).")

    # 任何 SOP 都可能更新 memory（订阅历史、未来的偏好学习等），统一在末尾持久化
    store.save(agent.memory)


if __name__ == "__main__":
    main()


__all__ = ["build_demo_agent", "main"]
