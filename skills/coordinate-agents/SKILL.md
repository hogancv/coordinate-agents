---
name: coordinate-agents
description: >-
  Route Codex-native multi-agent orchestration in a Git repository through a
  local-first, recoverable Agent Bus. Use for role-based planning, task
  execution, review, recovery, adapters, and human-gated release workflows.
  The plugin supports Codex CLI, Google Antigravity CLI, Claude, and other
  configured coding agents. Do not use for ordinary single-agent tasks or
  unsafe concurrent writes to the same worktree.
---

# Coordinate Agents

This is the Plugin-first router. It identifies the user's intent and delegates
to the smallest focused skill:

- `coordinate-setup` - discover coding CLIs and configure the Implementer.
- `coordinate-task` - create, start, resume, inspect, and stop a Task.
- `coordinate-review` - review the real commit, diff, tests, and evidence.
- `coordinate-recover` - diagnose a failed or stale Task and propose a safe,
  user-confirmed recovery.

Do not make the user reason about inbox directories or message files. The
Task API is the product surface; the Agent Bus remains the single canonical
durable transport and persistence layer. The bundled runtime and adapters under
this directory are the only implementation source; do not create a second Bus.

## Canonical Plugin Runtime invocation

Codex Plugin installation does not promise that the npm bin `coordinate-agents`
is on `PATH`. Let `<skill-dir>` mean the absolute directory containing this
loaded `SKILL.md`, then invoke the one bundled Runtime entry point for every
operation:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" <command> ...
```

The resolver follows the active Plugin payload to its canonical
`bin/coordinate-agents.mjs`; it also understands the personal marketplace,
Git marketplace cache, and standalone npm compatibility layout. Do not replace
this with a per-Skill path guess or a copied Runtime. JSON operations must keep
`--json` as the machine-facing contract.

## Codex App workflow

In Codex App, resolve the active project with `git rev-parse --show-toplevel`,
confirm it is the `.git` repository open in the App, and keep Codex as Planner
and Reviewer. Use the Task runtime to start the configured local Implementer.
Before launch, verify the actual local executable, such as `agy`, `claude`, or
another configured command; do not treat a role label as an executable. The
App path does not require manually opening two CLI windows. The CLI quickstart
remains a fallback for hosts without direct App skill execution.

## Intent routing

| User intent | Skill | Runtime surface |
| --- | --- | --- |
| "Which coding CLIs are installed?" | `coordinate-setup` | `setup --json` |
| "Configure the implementation agent." | `coordinate-setup` | `setup configure --json` transaction |
| "Build this feature with Coordinate Agents." | `coordinate-task` | `task create`, `task dispatch` |
| "Review the implementation." | `coordinate-review` | inspect evidence, `task review` |
| "Continue the last task." | `coordinate-recover` | `task status`, explicit `task resume`, `task dispatch` |

Use `--json` for runtime facts. JSON stdout is a single document and errors
use stable codes; explanatory prose belongs in the Skill layer. Never infer
authentication from absence of a version; classify `AUTH_REQUIRED` only when
the agent explicitly reports login or authentication failure. Preserve
fail-fast behavior: a runtime error stops the current activation and never
starts an automatic retry loop.

For protocol details and task templates, read the relative resources
`references/protocol.md` and `references/task-templates.md`. For direct Bus
inspection, the canonical runtime remains `scripts/agent-bus.mjs` and
`scripts/agent-observer.mjs`; do not hand-edit queue files.
