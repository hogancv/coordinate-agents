---
layout: default
title: Coordinate Agents MCP
description: Local stdio MCP tools over the canonical Coordinate Agents Runtime.
---

# Coordinate Agents MCP

Coordinate Agents exposes a local, stdio-only MCP server for Codex Plugins.
The MCP layer is a structured transport over the existing Runtime, Task API,
and Agent Bus; it is not a second workflow engine.

```text
User <-> Codex
  -> Skills
  -> MCP Tools
  -> Canonical Runtime
  -> Task API
  -> Agent Bus
  -> External Implementer
```

## Installation and lifecycle

`.codex-plugin/plugin.json` points to the companion `./.mcp.json`. The server
starts as a local child process:

```json
{
  "mcpServers": {
    "coordinate_agents": {
      "command": "node",
      "args": ["./mcp/server.mjs", "--stdio"],
      "cwd": "."
    }
  }
}
```

The server reads newline-delimited JSON-RPC from stdin and writes only valid
JSON-RPC messages to stdout. It does not open an HTTP server, listen on a
network port, create an external daemon, initialize the Agent Bus, scan
repositories, or start an Implementer until a tool is called. A Task or
Session operation may then create a detached, Runtime-owned local Session Host
for the persistent PTY; that host is scoped to the selected repository and
Agent Bus transport is not Codex App Terminal UI automation.

## Tools

| Tool | Required input | Optional input | Runtime command |
| --- | --- | --- | --- |
| `coordinate_agents_setup_discover` | `root` | — | `setup` |
| `coordinate_agents_setup_configure` | `root`, `agent`, `command` | `adapter`, `args`, `role` | `setup.configure` |
| `coordinate_agents_task_create` | `root`, `title` | `id`, `spec`, `planner`, `implementer`, `reviewer` | `task.create` |
| `coordinate_agents_task_graph_validate` | `root`, `graph` | — | `task.graph-validate` |
| `coordinate_agents_task_graph_create` | `root`, `graph` | `intentMap` | `task.graph-create` |
| `coordinate_agents_task_graph_plan` | `root`, `taskId` | — | `task.graph-plan` |
| `coordinate_agents_task_graph_run` | `root`, `taskId` | `sessionWaitMs` | `task.graph-run` |
| `coordinate_agents_task_graph_recover` | `root`, `taskId` | `subtaskId` | `task.graph-recover` |
| `coordinate_agents_task_graph_resume` | `root`, `taskId` | `subtaskId` | `task.graph-resume` |
| `coordinate_agents_task_graph_stop` | `root`, `taskId` | `subtaskId`, `reason`, `timeoutMs` | `task.graph-stop` |
| `coordinate_agents_task_graph_cleanup` | `root`, `taskId` | `subtaskId`, `timeoutMs` | `task.graph-cleanup` |
| `coordinate_agents_task_graph_dispatch` | `root`, `taskId`, `subtaskId` | `spec`, `sessionWaitMs` | `task.graph-dispatch` |
| `coordinate_agents_task_graph_integrate` | `root`, `taskId` | `timeoutMs` | `task.graph-integrate` |
| `coordinate_agents_task_graph_review` | `root`, `taskId`, `decision` | `feedback`, `evidence`, `timeoutMs` | `task.graph-review` |
| `coordinate_agents_task_dispatch` | `root`, `taskId` | `spec` | `task.dispatch` |
| `coordinate_agents_task_status` | `root`, `taskId` | — | `task.status` |
| `coordinate_agents_task_inspect` | `root`, `taskId` | — | `task.inspect` |
| `coordinate_agents_task_review` | `root`, `taskId`, `decision` | `feedback`, `evidence` | `task.review` |
| `coordinate_agents_task_resume` | `root`, `taskId` | — | `task.resume` |
| `coordinate_agents_task_stop` | `root`, `taskId` | `reason` | `task.stop` |
| `coordinate_agents_recover_inspect` | `root`, `taskId` | — | `recover.inspect` |
| `coordinate_agents_session_open` | `root`, `agent` | `language`, `initialPrompt` | `session.open` |
| `coordinate_agents_session_status` | `root`, `sessionId` | — | `session.status` |
| `coordinate_agents_session_inspect` | `root`, `sessionId` | `maxLines`, `maxBytes` | `session.inspect` |
| `coordinate_agents_session_write` | `root`, `sessionId`, `input` | `submit` | `session.write` |
| `coordinate_agents_session_read` | `root`, `sessionId` | `cursor`, `maxLines`, `maxBytes` | `session.read` |
| `coordinate_agents_session_close` | `root`, `sessionId` | `graceful`, `timeoutMs` | `session.close` |

Tool schemas are advertised by `tools/list` and reject unknown top-level
arguments. `root` is validated as a Git repository by the canonical Runtime.
The setup tool keeps Agent identity, Adapter, and executable command separate;
for example, `antigravity` may use `agy-proxy`. Session output and input are
bounded, and `session_write` is structured text rather than a general shell
execution surface.

`coordinate_agents_task_graph_validate` validates and normalizes the additive
Task Graph v1 input before Agent Bus initialization or handoff, Adapter
resolution, worktree or Session creation, and process spawn. It returns
separate parent Task and parent-scoped subtask facts, or the bounded stable
`TASK_GRAPH_INVALID` error. See [Task Graph v1](./task-graph-v1.md).

`coordinate_agents_task_graph_create` accepts the same validated graph shape,
persists the parent and all subtasks atomically under
`.agent-bus/task-graphs/<parentTaskId>.json`, and returns the deterministic
`READY`/`WAITING`/`BLOCKED` frontier. It appends a `TASK_GRAPH_CREATED` event
but does not resolve an Adapter, open a Session, hand off a Bus message, or
launch a child process. Existing `coordinate_agents_task_status` and
`coordinate_agents_task_inspect` calls recognize a graph parent ID; inspect
also returns bounded graph lifecycle events.

Creation also accepts an optional `intentMap` object with `schemaVersion: 1`,
the same `parentTaskId`, optional `scopePolicy` (`observe`, `warn`, or
`strict`, default `warn`), and exactly one `{ id, writeIntent }` declaration
per graph subtask. The Runtime normalizes repository-relative separators and
rejects incomplete, duplicate, absolute, escaping, malformed, or oversized
input before graph persistence. Status, inspect, and plan expose bounded
`intentCoverage` facts that distinguish unavailable legacy coverage from an
explicitly empty declaration.

`coordinate_agents_task_graph_plan` is a read-only scheduler view over the
persisted graph. It returns every subtask in deterministic identifier order,
the dependency outcome and bounded reason for each decision, the concurrency-
eligible prefix, capacity-limited READY subtasks, and exact configured Agent,
Adapter, command, and command-source facts. It rejects unknown arguments and
invalid Agent/Adapter/executable configuration without creating a worktree,
Bus message, Session, event, or child process.

With Intent Map coverage, the plan additionally returns a deterministic
`wave`, `conflictDeferred`, and bounded `WRITE_INTENT_CONFLICT` facts. Stable
subtask-ID order greedily selects non-conflicting READY work up to capacity;
unprovable glob separation is treated conservatively. Missing coverage keeps
the v2.3 selection and reports `intentCoverageAvailable: false`. Dependency,
capacity, and intent decisions remain distinct and no `dependsOn` edge changes.

`coordinate_agents_task_graph_run` executes only the eligible prefix from one
deterministic scheduling snapshot, up to the persisted `maxConcurrency` after
counting existing RUNNING subtasks. Every selected subtask is claimed under the
graph lock, uses the same captured graph base commit, and receives its own
Runtime-owned worktree, branch/ref, Bus handoff, and Session. Results and errors
remain parent/subtask-associated; the operation waits for all selected bounded
dispatch observations without recursively launching newly unlocked work.
The locked claim rechecks write-intent compatibility against RUNNING subtasks;
a conflict fails before launch without fallback, retry, sibling mutation, or
user-checkout mutation.

`coordinate_agents_task_graph_dispatch` dispatches one selected `READY` subtask
from a persisted Task Graph in an isolated Git worktree without modifying
uncommitted files in the user repository or mutating sibling subtasks. It captures
the graph base commit, provisions a dedicated worktree and branch, resolves the
configured Implementer, runs an isolated persistent Session, and updates the
subtask and frontier state upon completion.

`coordinate_agents_task_graph_integrate` is the explicit aggregate step after
all required subtasks succeed. It verifies each exact Runtime branch/ref and
completion commit, then applies source commits in sorted subtask-id order to
`.agent-bus/worktrees/<parentTaskId>/__integration__`. The aggregate worktree
and its durable base/source/applied/conflict facts are separate from every
subtask worktree and from the current checkout. A conflict is returned as a
bounded business failure with the in-progress Git state preserved for inspection.

`coordinate_agents_task_graph_review` sends that aggregate through the existing
review boundary. It rechecks source evidence, the exact integration source
fingerprint, aggregate ownership, aggregate HEAD, and worktree cleanliness before
recording `REVIEW_APPROVED` or `CHANGES_REQUESTED`; review never merges, pushes,
tags, publishes, deploys, or releases. `graph-cleanup` and unscoped
`graph-stop` clean only the Runtime-owned aggregate worktree and retain its
branch, commits, conflict facts, and review evidence.

`coordinate_agents_task_graph_recover` is the facts-first interruption path. It
reads the durable graph, Session, worktree, and Event Journal records, verifies
any `IMPLEMENTATION_DONE` commit against the captured base commit, and returns a
per-subtask recovery classification. It never treats filenames or free-form
prose as completion evidence and never launches or retries an Implementer.
Unhealthy `RUNNING` records become durable `FAILED` records with root, graph,
subtask, Agent, Session, and worktree facts; dependents remain `BLOCKED`.

`coordinate_agents_task_graph_resume` is an explicit recovery gate. A healthy
Runtime-owned Session/worktree is reused without another launch or input. An
exited or failed Session is cleared for replacement and the subtask becomes
`READY`, but dispatch is still a separate explicit operation. Dependents are
only re-derived after that valid prerequisite recovery. Repeated recovery and
resume calls are idempotent.

`coordinate_agents_task_graph_stop` and `coordinate_agents_task_graph_cleanup`
are explicit bounded cleanup operations. Stop marks active subtasks `STOPPED`,
closes only Runtime-owned Sessions, and removes only the exact Runtime-owned
worktree after the bounded timeout. Cleanup may be run for terminal subtasks;
it records `SKIPPED` for an active subtask until stop is requested. Ownership,
symlink, path, or Session errors are returned as bounded Runtime errors and
persisted with their graph facts. User worktrees, remote refs, branches,
successful commits, and evidence are preserved, and repeated stop/cleanup calls
do not duplicate side effects. Their shared output contract is
`schemas/task-graph-v1-recovery.schema.json`.

`coordinate_agents_setup_discover` returns an additive `adapters` snapshot.
Each record exposes the registered Adapter Contract identity, contract version,
capabilities, and configured Agent facts. Explicitly registered external
adapters appear alongside the three built-ins; discovery never resolves a
launch plan or starts an Implementer. For a configured external adapter, the
only adapter process operation performed by discovery is its Contract-defined
`detect()` call. `coordinate_agents_setup_configure` accepts the same adapter
identity and preserves the exact configured command and project > user >
adapter-default precedence. The setup response and subsequent Task dispatch
use the same registry view, while existing tool names and input shapes remain
unchanged.

## Output and errors

Successful and business-failure results use the existing Runtime contract:

```json
{
  "ok": false,
  "command": "task.dispatch",
  "error": {
    "code": "EXECUTABLE_NOT_FOUND",
    "message": "...",
    "recoverable": true
  }
}
```

The same object is returned in `structuredContent` and as a JSON text content
block. Business failures use MCP `isError: true`; they are not converted to a
new `MCP_ERROR_*` code. JSON-RPC protocol errors are reserved for malformed
requests, unknown methods/tools, or invalid tool arguments.

The MCP server identifier is `coordinate_agents`; its product/server name remains
`coordinate-agents`. The version is read from the
bundled package manifest. Protocol compatibility is not represented as a
second product version. Task records continue to use `schemaVersion: 1`.

## Workflow boundaries

MCP does not plan specifications, automatically review changes, retry failed
activations, or authorize release. Codex remains responsible for clarification,
approved specifications, evidence review, and the human release gate.
`REVIEW_APPROVED` means Task `APPROVED`; it never means merge, push, tag,
publish, deploy, or release.

`coordinate_agents_recover_inspect` is facts-only. It reports Task state,
`lastError`, Agent state, executable facts, and bounded error artifacts. When a
Task has `sessionId`, it also reports read-only Session status/inspect facts. It
does not resume, dispatch, restart a Session, replay input, or attach to an
arbitrary PID. Recovery is an explicit follow-up operation.

## Fallback and security

If the MCP server is unavailable, Skills may use the bundled
`skills/coordinate-agents/scripts/runtime-entry.mjs` fallback. This fallback is
for compatibility, standalone Runtime use, and debugging; it is not the normal
Plugin machine path. Skills must not silently loop between MCP and fallback.

The server is local-only and uses existing repository validation, safe-path and
symlink protections, bounded/redacted error output, user/project executable
precedence, argument-array child-process spawning, and the existing release
gate. It exposes no general shell, command execution, Codex Terminal UI, or
arbitrary-PID control tool and persists no credentials. The Session Host sends
interrupt/termination only to the process it created.

## Protocol schemas

The stable Task, Task Graph v1 input, Runtime error, and evidence shapes are documented in:

- `schemas/task.schema.json`
- `schemas/task-graph-v1.schema.json`
- `schemas/task-graph-v1-record.schema.json`
- `schemas/task-graph-v1-plan.schema.json`
- `schemas/task-graph-v1-run.schema.json`
- `schemas/task-graph-v1-recovery.schema.json`
- `schemas/task-graph-v1-integrate.schema.json`
- `schemas/task-graph-v1-review.schema.json`
- `schemas/runtime-error.schema.json`
- `schemas/evidence.schema.json`

These files describe the current implementation; they do not drive runtime
behavior. A future breaking Task contract must increment `schemaVersion`.
