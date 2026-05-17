# Agent Skills

Agent skills are Markdown workflow rules for the LLM. They are not executable
tools and they should not contain mailbox implementation logic.

A skill should teach the agent:

- when to use this workflow
- what to inspect first
- which tools may provide evidence
- what risks require asking the user
- what the final answer or report must include

Built-in skills live in this directory. User-created or edited skills should be
loaded from `.mailtidy/skills/` and merged with these defaults.
