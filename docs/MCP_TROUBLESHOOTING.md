---
layout: default
title: MCP troubleshooting
description: Diagnose a loaded Coordinate Agents Plugin whose MCP tools are not callable in Codex.
---

# MCP troubleshooting

Use this page when the `coordinate-agents` Skill is visible but Codex says that
`coordinate_agents_setup_discover` (or another Coordinate Agents tool) is not a
callable MCP tool.

The checks must be made in order. A visible Skill does not prove that the
Plugin payload was refreshed, that `.mcp.json` was ingested, or that the MCP
server completed `initialize` and `tools/list`.

## 1. Confirm the installed Plugin payload

The Plugin and the MCP server are shipped together. Confirm the installed
Plugin is the intended `2.1.2` payload and inspect its actual root, not only the
marketplace entry:

```powershell
codex plugin list
codex plugin list --json
```

At that installed root, verify that all of these exist:

```text
.codex-plugin/plugin.json
.mcp.json
mcp/server.mjs
skills/coordinate-agents/scripts/runtime-services.mjs
```

`plugin.json` must contain `"mcpServers": "./.mcp.json"`. A cached Plugin can
still report version `2.1.2` while pointing at an older Git revision that does
not contain the MCP payload. The version string alone is not a cache refresh
proof.

For a Git marketplace that should track the release branch, add the exact ref
and reinstall the Plugin. The marketplace source is separate from the Plugin
name:

```powershell
codex plugin remove coordinate-agents@coordinate-agents
codex plugin marketplace remove coordinate-agents
codex plugin marketplace add hogancv/coordinate-agents --ref 2.1.2
codex plugin add coordinate-agents@coordinate-agents
```

For local development, add the checkout itself as a local marketplace and
reinstall the Plugin from that source:

```powershell
codex plugin marketplace add "C:\path\to\coordinate-agents"
codex plugin add coordinate-agents@coordinate-agents
```

Do not delete the whole Codex home directory. If an existing marketplace has
the same name, refresh or remove only that marketplace before adding the
intended source.

## 2. Confirm MCP registration

Inspect the server registration separately from Plugin discovery:

```powershell
codex mcp list --json
codex mcp get coordinate_agents --json
codex mcp get coordinate-agents --json
```

The bundled server identifier is `coordinate_agents`. The Plugin name remains
`coordinate-agents`, and the ten tool names remain unchanged. A missing entry
means the failure is before MCP process startup; do not change Task Runtime or
Agent Bus code to fix that layer.

The expected registration is equivalent to:

```json
{
  "name": "coordinate_agents",
  "transport": {
    "type": "stdio",
    "command": "node",
    "args": ["./mcp/server.mjs", "--stdio"],
    "cwd": "<installed Plugin root>"
  }
}
```

The `cwd` must be the installed Plugin root, not the current project, Codex
process directory, or the user home directory. The server resolves its own
imports from its file location, so its runtime remains independent of the
launching working directory.

## 3. Run the standalone handshake

From any working directory, run the packaged self-test:

```powershell
node "<installed Plugin root>\mcp\self-test.mjs"
```

Expected output:

```text
MCP server: OK
Protocol: 2025-06-18
Tools: 10
```

The self-test launches the real stdio subprocess, sends `initialize`, sends
`notifications/initialized`, then sends `tools/list`. It also starts the
server with an independent temporary working directory. A failure here is a
server, Node, packaging, or path problem; a passing result does not by itself
prove that Codex injected the tools into an active conversation.

The stdio transport is newline-delimited JSON-RPC. stdout must contain only
valid MCP messages. Diagnostics are allowed on stderr only.

## 4. Collect optional stderr diagnostics

Enable diagnostics without contaminating the MCP stream:

```powershell
$env:COORDINATE_AGENTS_MCP_DEBUG = "1"
node "<installed Plugin root>\mcp\self-test.mjs"
Remove-Item Env:COORDINATE_AGENTS_MCP_DEBUG
```

The server reports startup, server/runtime roots, negotiated protocol, tool
count, `initialize`, and `tools/list` on stderr. Never redirect these messages
into stdout or add startup banners to the stdio process.

## 5. Complete the Codex restart

MCP processes and Plugin payloads can live at the App/session boundary. After
refreshing a Plugin or changing `.mcp.json`:

1. Close Codex App completely.
2. Confirm the related Codex process has exited.
3. Reopen Codex App.
4. Start a new thread with the repository as its project.
5. Ask Codex to list the Coordinate Agents MCP tools without using shell or CLI fallback.

Creating only a new thread is not a substitute for a complete App restart when
the Plugin cache or MCP registry changed.

## 6. Isolate Plugin ingestion from Codex MCP support

Register the same server directly, using an absolute path to the installed
Plugin payload:

```powershell
codex mcp add coordinate_agents -- node "<installed Plugin root>\mcp\server.mjs" --stdio
codex mcp list --json
```

Restart Codex App and test a new thread. Remove the temporary registration when
finished:

```powershell
codex mcp remove coordinate_agents
```

Interpret the result as follows:

| Result | Boundary indicated |
| --- | --- |
| Direct registration works, bundled Plugin does not | Plugin payload, marketplace ref/cache, manifest, server id, or Plugin cwd |
| Both fail, standalone handshake passes | Codex host/session MCP injection or host compatibility |
| Direct registration and handshake fail | Server process, Node PATH, packaging, framing, or protocol implementation |

Do not describe a standalone pass as proof of an in-thread tool invocation.

## Expected tool catalog

The server must expose exactly these high-level tools:

```text
coordinate_agents_setup_discover
coordinate_agents_setup_configure
coordinate_agents_task_create
coordinate_agents_task_dispatch
coordinate_agents_task_status
coordinate_agents_task_inspect
coordinate_agents_task_review
coordinate_agents_task_resume
coordinate_agents_task_stop
coordinate_agents_recover_inspect
```

The CLI fallback through `runtime-entry.mjs` remains available for standalone,
compatibility, and explicit debugging scenarios. It is not evidence that the
Codex App MCP path is healthy and must not be silently retried as a substitute
for a missing callable tool.
