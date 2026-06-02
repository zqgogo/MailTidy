# MailTidy

MailTidy is an email agent that triages inboxes, drafts replies, finds
subscriptions, and produces daily briefings. It is designed as an **agent**,
not a one-off automation: it reasons over email context, creates an
execution plan, lets the user confirm or adjust it before mailbox writes,
persists task state to disk so it can resume after a `kill -9`, and learns
user preferences over time.

The project was originally prototyped in Python; it has since been migrated
to TypeScript and is built on
[**@earendil-works/pi-agent-core**](https://github.com/earendil-works/pi)
for the agent runtime and `@earendil-works/pi-ai` for multi-provider LLM
calls. The original Python prototype is preserved at [`old/`](old/) for
reference; do not extend it.

## What is included

- TypeScript agent core: `src/`
- Demo CLI with mock email data:
  ```bash
  npm install
  npm run demo:cleanup
  npm run demo:brief
  npm run demo:subscriptions
  npm run demo:drafts
  ```
- Task records + checkpoint store for crash-safe runs (`.mailtidy/tasks/`,
  `.mailtidy/checkpoints/`); see [docs/agent-design.md](docs/agent-design.md)
  §2.1.7 and §5.1 for the recovery model.
- Recovery scan: `npm run dev recover` (or `npx tsx src/interfaces/cli.ts
  recover`) lists unfinished tasks and prompts `[r]/[c]/[s]/[d]`.
- Skill markdown files: [`src/agent/skills/`](src/agent/skills/)
- Product and agent design: [docs/agent-design.md](docs/agent-design.md)

## Quick start

```bash
nvm use         # requires Node 20+
npm install
npm run demo:cleanup      # runs the full inbox-cleanup SOP on mock data
npm test                  # vitest, includes recovery + demo smoke tests
npm run typecheck         # strict tsc with no emit
```

## Project layout (top level)

```
src/                      # TypeScript source, Phase 0 + recovery scaffold
  agent/                  # main loop, recovery, exits, policies, skills/*.md
  data/                   # models, memory, tasks, reports, learning
  integrations/           # email / LLM / notification adapters
  interfaces/             # CLI (commander), readline prompts, future web / desktop
  llm/                    # provider-neutral LLMClient interface + Router + Usage
  ops/                    # config plus logging / scheduler / audit placeholders
  research/               # research-style analysis (Phase 3 placeholders)
  rules/                  # custom rule engine (Phase 3 placeholders)
  tools/                  # ToolDefinition + per-tool wrappers (Phase 1 placeholders)
tests/                    # vitest suite
old/                      # DEPRECATED Python prototype, kept for reference
docs/agent-design.md      # canonical product + technical design doc
```

The active progress table lives in [docs/agent-design.md §5.2](docs/agent-design.md)
and is updated at the end of every work session.

## Status today

Phase 0 (流水线骨架) is done in TS. Recovery scaffolding (task records +
checkpoint store + CLI recovery scan + SIGINT handler) is in place, and Phase
1.2 now has a minimal `runAgentLoop()` that writes task/checkpoint state while
driving cleanup through the tool registry. Phase 1.3 has started with pi
AgentTool adapters, lifecycle hooks for risk gates/checkpoints/stop conditions,
and a pi runner wired into `runAgentLoop({ engine: "pi" })` with faux-provider
tool-use tests. `recover --demo` can now continue from checkpoint through the
pi runner, and recovery continuation has a non-interactive e2e test. The four
demo SOP commands now support `--agent` loop entry-points while the legacy
pipeline remains the default. The kill/restart/recover demo path is covered by
an end-to-end test. `--agent` commands can select heuristic/OpenAI/Anthropic
LLM clients from `.mailtidy/config.json` or CLI overrides with fallback, and
agent runs now write report and trace artifacts under `.mailtidy/{reports,traces}`
for bounded history lookup. The first proactive investigation triggers now flag
low-confidence, suspicious-link, and preference-conflict cases in plans and
reports, and the deterministic loop runs bounded investigation tools before
reporting observations. Judgments now include structured rich suggestions, and
Phase 1.8 is complete with bounded original record reading, offline domain verification,
and context compression (fact/inference/source separation). Phase 2.1 has started
with the learning layer (`LearningEngine`) that processes user feedback signals
and proposes preferences from decision patterns. Phase 2.2 has started with
decision log persistence (`DecisionLogStore`) and automatic signal recording
in the agent loop. See
[docs/agent-design.md §5.2](docs/agent-design.md) for the per-module status.

## Next integrations

- Phase 2: wire askUser callback hooks for user confirmation/rejection/correction;
  implement proactive notifications channel and pending queue for heavy operations.
- Phase 4: implement real `GmailConnector` / `OutlookConnector` (read-only
  scope first; writes opened one at a time after a week of dry-run).
