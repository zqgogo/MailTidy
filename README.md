# MailTidy

MailTidy is an email agent that triages inboxes, drafts replies, finds subscriptions,
and produces daily briefings. It is designed as an agent, not a one-off automation:
it reasons over email context, creates an execution plan, asks for confirmation on
risky actions, and learns user preferences over time.

## What is included

- Product and agent design: [docs/agent-design.md](docs/agent-design.md)
- Python agent core: `mailtidy/`
- Demo CLI with mock email data: `python -m mailtidy.cli run-cleanup --demo`

## Quick start

```bash
python -m mailtidy.cli run-cleanup --demo
python -m mailtidy.cli daily-brief --demo
python -m mailtidy.cli subscription-scan --demo
```

Run tests:

```bash
python -m unittest
```

## Next integrations

The implementation currently ships with clean interfaces and a mock connector. To
connect real inboxes, implement `EmailConnector` for Gmail or Outlook OAuth and
plug in a production `LLMClient`.
