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
network port, create a daemon, initialize the Agent Bus, scan repositories, or
start an Implementer until a tool is called.

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

Tool schemas are advertised by `tools/list` and reject unknown top-level
arguments. `root` is validated as a Git repository by the canonical Runtime.
The setup tool keeps Agent identity, Adapter, and executable command separate;
for example, `antigravity` may use `agy-proxy`.

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
`lastError`, Agent state, executable facts, and bounded error artifacts. It does
not resume or dispatch. Recovery is an explicit follow-up operation.

## Fallback and security

If the MCP server is unavailable, Skills may use the bundled
`skills/coordinate-agents/scripts/runtime-entry.mjs` fallback. This fallback is
for compatibility, standalone Runtime use, and debugging; it is not the normal
Plugin machine path. Skills must not silently loop between MCP and fallback.

The server is local-only and uses existing repository validation, safe-path and
symlink protections, bounded/redacted error output, user/project executable
precedence, argument-array child-process spawning, and the existing release
gate. It exposes no general shell, command execution, or Agent Bus mutation
tool and persists no credentials.

## Protocol schemas

The stable Task, Runtime error, and evidence shapes are documented in:

- `schemas/task.schema.json`
- `schemas/runtime-error.schema.json`
- `schemas/evidence.schema.json`

These files describe the current implementation; they do not drive runtime
behavior. A future breaking Task contract must increment `schemaVersion`.
