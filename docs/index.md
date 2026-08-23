---
layout: home
title: coordinate-agents
description: A local-first coordination protocol and runtime for AI coding agents.
permalink: /
---

# Local-first coordination protocol and runtime for AI coding agents

`coordinate-agents` is a local-first coordination protocol and runtime for multi-agent software engineering in Git repositories. The core is agent-agnostic and uses an adapter-based runtime. **OpenAI Codex App/CLI** and **Google Antigravity CLI (`agy`)** serve as first-party reference adapters and the default reference workflow, while generic CLI agents can be registered directly and desktop, MCP, HTTP, or IPC surfaces can integrate via the adapter extension model.

The agents communicate through a recoverable project-local `.agent-bus`. No external CAO server, daemon,
database, or shared API key is required. During an explicit Task/Session operation, the Runtime may
create a local Runtime-owned Session Host for a persistent PTY; it is not Codex Terminal UI control.

## Codex Plugin via GitHub Marketplace (Recommended)

```sh
codex plugin marketplace add hogancv/coordinate-agents
codex plugin add coordinate-agents@coordinate-agents
```

After enabling the plugin, start a new Codex App thread and invoke `$coordinate-agents`. The App
path is the preferred interactive workflow; the npm CLI quickstart below is the fallback for
automation or hosts without direct Codex App Skill execution.

Plugin-only installation does not require `npm install -g @hogancv/coordinate-agents`. Every Skill
uses the bundled resolver convention `node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs"`
to start the one canonical `bin/coordinate-agents.mjs` from the active Plugin payload. The resolver
does not depend on a `coordinate-agents` executable being present on `PATH` and handles cached Git
marketplaces, personal local marketplaces, and Windows paths with spaces.

The Plugin is a Multi-Skill surface: `coordinate-setup` discovers and configures an Implementer,
`coordinate-task` owns the durable Task API, `coordinate-review` verifies commits and evidence,
and `coordinate-recover` handles explicit recovery. Use `setup --json` and `task status --json`
for machine-readable runtime facts; all of these paths use the same project-local Agent Bus.

## Start here: Install Plugin → Discover → Configure → Build

For the simplest interactive path, install the Codex plugin, add the target Git repository to Codex
App, set the thread project path to the repository root containing `.git`, and invoke
`$coordinate-agents`. A second manually opened CLI window is not required; configure the actual
Implementer executable (`agy`, `claude`, or a wrapper) for the local runtime. The Task records a
non-owning `sessionId`; a healthy Session is reused through review rework.

Use `coordinate-setup` for discovery and the single high-level `setup configure` transaction. It
persists the machine command, registers the project Agent, assigns the Implementer workflow role,
checks Adapter compatibility and executable availability, and returns `READY`. After Codex finishes
the specification, `coordinate-task task dispatch` owns the Task → Agent Bus → Adapter → Implementer
handoff; `coordinate-review task review` records the review decision. See the [Plugin E2E audit and
acceptance gates](./plugin-e2e.html) for the exact state and error mapping.

For a custom CLI, ask the active Codex App thread to inspect the installed executable and its
`--help` output, register it with `generic-cli`, run `doctor`, and show the resolved configuration
before starting a task. The legacy Antigravity launch passes configured arguments and appends
only `--prompt-interactive <prompt>`; a persistent Session starts with `--prompt-interactive ""` for
current `agy`/`agy-proxy` parsers, then writes its first instruction through the PTY unless `{prompt}`
is explicitly configured. The Adapter does not automatically add a full-permission or
sandbox-bypass flag.

- [Getting started](./getting-started.html)
- [Install safely with an AI](./install-with-ai.html)
- [Codex CLI role](./codex-cli.html)
- [Antigravity CLI role](./antigravity-cli.html)
- [Protocol and recovery](./protocol.html)
- [Execution Session and PTY Runtime](./session-runtime.html)
- [Local Inspector Web UI](./inspector.html)
- [Security boundary](./security.html)
- [Troubleshooting](./troubleshooting.html)
- [Role comparison](./comparison.html)
- [FAQ](./faq.html)
- [Machine-readable documentation index](./llms.txt)
- [简体中文入口](./zh-CN/)

Canonical sources: [GitHub](https://github.com/hogancv/coordinate-agents) · [npm](https://www.npmjs.com/package/@hogancv/coordinate-agents)
