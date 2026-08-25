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

Do not make the user reason about inbox directories, message files, PTY
endpoints, or child-process IDs. The Task API is the product surface; the
Agent Bus remains the single canonical durable transport and persistence layer.
The bundled runtime and adapters under this directory are the only
implementation source; do not create a second Bus.

The canonical execution primitive is an `Execution Session`: a project- and
Agent-scoped, Runtime-owned persistent PTY. A Task records `sessionId` as a
reference but never owns, restarts, or destroys the Session. Dispatch reuses a
healthy matching Session, writes the next specification into it, and creates a
new Session only when the old one is exited or failed. See
`references/session-runtime.md` for lifecycle, security, and platform details.

## Canonical Plugin tool invocation

Use the structured Coordinate Agents MCP tools for normal Plugin operations.
Skills decide when and why; MCP tools execute the approved operation; the
canonical Runtime owns workflow semantics. The Agent Bus is internal durable
infrastructure and is not a user-facing transport.

The normal path is:

```text
Intent -> focused Skill -> Coordinate Agents MCP tool -> Canonical Runtime
```

Only when MCP is unavailable, or when the user explicitly requests debugging,
use the bundled fallback. Let `<skill-dir>` mean the absolute directory
containing this loaded `SKILL.md`:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" <command> ...
```

The fallback resolves the active Plugin payload to the canonical
`bin/coordinate-agents.mjs`; do not guess per-Skill paths, copy the Runtime, or
silently retry between MCP and fallback.

## Codex App workflow

In Codex App, resolve the active project with `git rev-parse --show-toplevel`,
confirm it is the `.git` repository open in the App, and keep Codex as Planner
and Reviewer. Use the Task runtime to start the configured local Implementer.
Before launch, verify the actual local executable, such as `agy`, `claude`, or
another configured command; do not treat a role label as an executable. The
App path does not require manually opening two CLI windows. The CLI quickstart
remains a fallback for hosts without direct App skill execution.

## Intent routing

| User intent | Skill | MCP surface |
| --- | --- | --- |
| "Which coding CLIs are installed?" | `coordinate-setup` | `coordinate_agents_setup_discover` |
| "Configure the implementation agent." | `coordinate-setup` | `coordinate_agents_setup_configure` |
| "Build this feature with Coordinate Agents." | `coordinate-task` | `coordinate_agents_task_create`, `coordinate_agents_task_dispatch` |
| "Review the implementation." | `coordinate-review` | `coordinate_agents_task_inspect`, `coordinate_agents_task_review` |
| "Continue the last task." | `coordinate-recover` | `coordinate_agents_recover_inspect`, `coordinate_agents_task_resume`, `coordinate_agents_task_dispatch` |
| "Inspect or control the Implementer session." | `coordinate-task` / `coordinate-recover` | `coordinate_agents_session_open`, `coordinate_agents_session_status`, `coordinate_agents_session_inspect`, `coordinate_agents_session_write`, `coordinate_agents_session_read`, `coordinate_agents_session_close` |

MCP tool results carry the same structured Runtime contract as CLI JSON:
`{ ok, command, ... }`, with canonical error codes inside `error`. Keep
explanatory prose in the Skill layer. Never infer authentication from absence
of a version; classify `AUTH_REQUIRED` only when the agent explicitly reports
login or authentication failure. Preserve fail-fast behavior: a runtime error
stops the current activation and never starts an automatic retry loop.

Session operations are explicit and bounded: `session_open` resolves the
configured executable and starts or reuses one Session; `status` and `inspect`
are read-only; `write` sends input to that Session; `read` returns bounded
buffered output; and `close` ends only the Runtime-owned process. These tools
never automate the Codex App Terminal panel or another desktop UI. Codex stays
Planner/Reviewer, while the configured Implementer owns product-code changes.

For protocol details and task templates, read the relative resources
`references/protocol.md` and `references/task-templates.md`. For direct Bus
inspection, the canonical runtime remains `scripts/agent-bus.mjs` and
`scripts/agent-observer.mjs`; do not hand-edit queue files.

Adapter authors must use the public `adapter-sdk.mjs` entry and the frozen
Contract v1 boundary documented in `references/adapter-contract-v1.md`. Run
the public Adapter Conformance Kit documented in `../../docs/adapter-conformance.md`
against deterministic fixtures before proposing an adapter. To use one, register
the exact local module explicitly with `coordinate-agents adapter register
<local-file>`; the loader rejects URLs, scans, symlinked/junctioned paths,
duplicate or built-in IDs, bad exports, and unsupported Contract versions before
configuration or spawn. Registered modules are trusted code running with the
current Node.js permissions. The repository-owned Codex CLI, Antigravity CLI,
and generic CLI adapters are created through validated Contract v1 descriptors
and are covered by the same conformance suite.

Setup and MCP expose one additive `adapters` registry snapshot containing the
same registered identities and Contract capabilities. Discovery does not
launch an adapter or resolve a launch plan; for an already configured external
Agent it invokes only the adapter's defined `detect()` operation. The existing
setup and Task MCP tool names and input shapes remain compatible, and an
external adapter selected by setup follows the same exact command precedence,
Task, and persistent-Session path as a built-in adapter.
