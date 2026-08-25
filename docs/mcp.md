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
Agent and is not Codex App Terminal UI automation.

## Tools

| Tool | Required input | Optional input | Runtime command |
| --- | --- | --- | --- |
| `coordinate_agents_setup_discover` | `root` | — | `setup` |
| `coordinate_agents_setup_configure` | `root`, `agent`, `command` | `adapter`, `args`, `role` | `setup.configure` |
| `coordinate_agents_task_create` | `root`, `title` | `id`, `spec`, `planner`, `implementer`, `reviewer` | `task.create` |
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

The stable Task, Runtime error, and evidence shapes are documented in:

- `schemas/task.schema.json`
- `schemas/runtime-error.schema.json`
- `schemas/evidence.schema.json`

These files describe the current implementation; they do not drive runtime
behavior. A future breaking Task contract must increment `schemaVersion`.
