from __future__ import annotations

import argparse
from pathlib import Path

from mailtidy.agent import MailTidyAgent
from mailtidy.connectors import MockEmailConnector
from mailtidy.llm import HeuristicLLMClient
from mailtidy.memory import JsonMemoryStore


def build_demo_agent(memory_path: Path) -> tuple[MailTidyAgent, JsonMemoryStore]:
    store = JsonMemoryStore(memory_path)
    agent = MailTidyAgent(
        connector=MockEmailConnector(),
        llm=HeuristicLLMClient(),
        memory=store.load(),
    )
    return agent, store


def main() -> None:
    parser = argparse.ArgumentParser(description="MailTidy email agent")
    parser.add_argument("--memory", default=".mailtidy/memory.json", help="Path to local memory JSON")
    subparsers = parser.add_subparsers(dest="command", required=True)

    cleanup = subparsers.add_parser("run-cleanup", help="Run inbox cleanup")
    cleanup.add_argument("--demo", action="store_true", help="Use mock email connector")
    cleanup.add_argument("--auto-confirm", action="store_true", help="Approve confirmation-gated actions")
    cleanup.add_argument("--dimension", action="append", default=[], help="Custom dimension to classify")

    brief = subparsers.add_parser("daily-brief", help="Generate daily briefing")
    brief.add_argument("--demo", action="store_true", help="Use mock email connector")
    brief.add_argument("--dimension", action="append", default=[], help="Custom dimension to classify")

    scan = subparsers.add_parser("subscription-scan", help="Find subscriptions")
    scan.add_argument("--demo", action="store_true", help="Use mock email connector")

    drafts = subparsers.add_parser("draft-replies", help="Draft replies for actionable messages")
    drafts.add_argument("--demo", action="store_true", help="Use mock email connector")

    args = parser.parse_args()
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

    store.save(agent.memory)


if __name__ == "__main__":
    main()
