from __future__ import annotations

import csv
from io import StringIO

from mailtidy.models import AgentPlan, Category, EmailMessage, ExecutionResult


def cleanup_report(plan: AgentPlan, result: ExecutionResult, messages: list[EmailMessage], newsletter_summary: str) -> str:
    by_id = {message.id: message for message in messages}
    attention = [
        judgment
        for judgment in plan.judgments
        if judgment.category in {Category.IMPORTANT, Category.ACTIONABLE}
    ]
    lines = [
        "# MailTidy Cleanup Report",
        "",
        f"- Processed: {result.processed}",
        f"- Archived: {result.archived}",
        f"- Labeled: {result.labeled}",
        f"- Starred: {result.starred}",
        f"- Marked read: {result.marked_read}",
        f"- Estimated cost: development heuristic mode ($0.00)",
        "",
        "## Needs Your Attention",
    ]
    if attention:
        for judgment in attention:
            message = by_id[judgment.email_id]
            lines.append(f"- {message.sender}: {message.subject} - {judgment.reason}")
    else:
        lines.append("- None")
    lines.extend(["", "## Newsletter Summary", newsletter_summary])
    if plan.human_prompts:
        lines.extend(["", "## Confirmation Needed", *[f"- {prompt}" for prompt in plan.human_prompts]])
    return "\n".join(lines)


def daily_brief(plan: AgentPlan, messages: list[EmailMessage]) -> str:
    by_id = {message.id: message for message in messages}
    groups = {
        "Urgent Today": [j for j in plan.judgments if j.urgency >= 4],
        "Important This Week": [j for j in plan.judgments if 2 <= j.urgency < 4],
        "FYI": [j for j in plan.judgments if j.urgency < 2],
    }
    lines = ["# MailTidy Daily Brief", ""]
    for title, judgments in groups.items():
        lines.append(f"## {title}")
        if not judgments:
            lines.append("- None")
        for judgment in judgments:
            message = by_id[judgment.email_id]
            lines.append(f"- [{message.sender}] {message.subject} - {message.snippet} - {judgment.action_suggestion}")
        lines.append("")
    lines.append(f"Unread: {len(messages)}; likely needs reply: {sum(1 for j in plan.judgments if j.category == Category.ACTIONABLE)}")
    return "\n".join(lines)


def subscriptions_markdown(rows: list[dict[str, object]]) -> str:
    total = sum(float(row.get("monthly_amount", 0)) for row in rows)
    lines = [
        "# Subscription Scan",
        "",
        f"You have {len(rows)} likely active subscription(s), about ${total:.2f}/month.",
        "",
        "| Service | Monthly | Category | Last Charge | Plan |",
        "| --- | ---: | --- | --- | --- |",
    ]
    for row in rows:
        lines.append(
            f"| {row['service_name']} | ${float(row['monthly_amount']):.2f} | "
            f"{row['category']} | {row['last_charge_date']} | {row['plan_name']} |"
        )
    return "\n".join(lines)


def subscriptions_csv(rows: list[dict[str, object]]) -> str:
    output = StringIO()
    fieldnames = ["service_name", "monthly_amount", "currency", "billing_cycle", "last_charge_date", "plan_name", "category"]
    writer = csv.DictWriter(
        output,
        fieldnames=fieldnames,
    )
    writer.writeheader()
    writer.writerows({key: row.get(key, "") for key in fieldnames} for row in rows)
    return output.getvalue()
