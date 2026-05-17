# DEPRECATED — Python prototype

This directory contains the **original Python prototype** of MailTidy. It is
**no longer maintained**. The project has been migrated to TypeScript and now
lives at the repository root, built on the
[earendil-works/pi](https://github.com/earendil-works/pi) agent framework
(`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`).

## Why we migrated

The product roadmap (see [old/docs/agent-design.md](docs/agent-design.md) §5.3)
calls for a Web UI, desktop status-bar app, multi-channel notifications
(Slack / Telegram / desktop), and a replayable trace viewer. The JS/TS
ecosystem covers those layers an order of magnitude better than Python, and
pi's monorepo conveniently bundles `pi-tui` (for "show thinking" trace) and
`pi-web-ui` (for Phase 5) right next to its agent core. Multi-provider LLM
routing and tool-use hooks map 1:1 onto the abstractions the Python prototype
was already growing.

## What's kept and what's not

- **Kept (read-only reference)**: the entire `old/` tree — Python source,
  tests, and the v1 design doc — so we can port logic and copy
  battle-tested heuristics (e.g. `HeuristicLLMClient` keyword rules).
- **Not kept**: nothing here is imported, run, or tested by the new TS
  project. Do not add new Python code under `old/`.

## What replaces what

| Python module (legacy) | TS replacement (new) |
| --- | --- |
| `mailtidy/agent/legacy.py` (`MailTidyAgent` SOP) | `src/agent/loop.ts` (pi `agentLoop` driving SOP entry-points) |
| `mailtidy/llm/{base,router,usage}.py` | `src/llm/{client,router,usage}.ts` over `@earendil-works/pi-ai` |
| `mailtidy/integrations/llm/heuristic.py` | `src/integrations/llm/heuristic.ts` |
| `mailtidy/integrations/email/mock.py` | `src/integrations/email/mock.ts` |
| `mailtidy/data/*` | `src/data/*` |
| `mailtidy/interfaces/cli.py` | `src/interfaces/cli.ts` (commander or yargs) |
| `mailtidy/agent/skills/*.md` | `src/agent/skills/*.md` (kept verbatim, loaded by skill loader) |

## v1 design doc

The original Python-era design doc is preserved at
[old/docs/agent-design.md](docs/agent-design.md). The new TS-era design doc
is the canonical one going forward; see `docs/agent-design.md` at the repo
root.
