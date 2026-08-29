---
layout: page
title: Execution Session and PTY Runtime
description: Persistent project-scoped coding-agent sessions, bounded PTY I/O, reuse, recovery, and security boundaries.
---

# Execution Session and PTY Runtime

The Plugin Task API uses an independent `Execution Session` for a long-lived
coding-agent process. A Task stores a non-owning `sessionId`; the Session
Manager owns lifecycle and the PTY Runtime owns bounded interactive I/O.
Task Graph Sessions additionally persist `taskId` and `subtaskId`, and their
Session events carry both associations so parallel worktree-local journals
cannot be misattributed across sibling subtasks.

```text
Task --sessionId--> Session Manager --owns--> PTY Session Host --owns--> Implementer CLI
```

Sessions are scoped by canonical repository root, Agent identity, and effective
executable. A healthy match is reused across Task dispatches and review
rework. A Task does not restart or close its Session simply because a review
round changed.

## Lifecycle and tools

```text
starting -> running <-> busy -> idle
                 \-> exited | failed
```

The Plugin exposes six bounded MCP tools:

| Tool | Purpose |
| --- | --- |
| `coordinate_agents_session_open` | Resolve the configured executable and start or reuse a Session. |
| `coordinate_agents_session_status` | Read state, root, command, timestamps, PID, and exit facts. |
| `coordinate_agents_session_inspect` | Read-only status plus bounded redacted recent output. |
| `coordinate_agents_session_write` | Send structured input to the owned process; no shell parsing. |
| `coordinate_agents_session_read` | Read bounded buffered output using a cursor. |
| `coordinate_agents_session_close` | Gracefully interrupt, then boundedly close the owned process. |

`resize` and `interrupt` are internal Runtime operations for adapters and
diagnostics. They do not provide desktop UI automation.

## Task and review loop

`task dispatch` validates the final executable, sends `IMPLEMENT`, and opens or
reuses the Session. If the adapter did not consume the first specification as
launch arguments, the Runtime writes it into the PTY. A short grace period
captures immediate completion evidence; otherwise the Task remains
`WAITING_IMPLEMENTER` while the Session stays inspectable.

After `CHANGES_REQUESTED`, the next explicit dispatch writes the new feedback
into the same healthy Session. If the Session is `exited` or `failed`, the
Runtime reports that fact; replacement requires the normal explicit dispatch
path and never an infinite retry loop. `recover inspect` is facts-only and does
not restart, replay input, resume a Task, or attach to an arbitrary PID.

For Task Graph execution, `task graph-status`/`graph-inspect` expose the same
Session facts together with the parent Task, subtask, Agent, worktree, and
verified completion evidence. `graph-recover` records an interrupted subtask
when its Session host is no longer healthy and never treats a filename or prose
message as proof. `graph-resume` reuses only a verified healthy Session rooted
at the matching Runtime-owned worktree; an exited/failed Session is returned to
`READY` for an explicit replacement dispatch. `graph-stop` and `graph-cleanup`
close only Runtime-owned graph Sessions under a bounded timeout and preserve
user worktrees, branches, refs, commits, and evidence when cleanup fails.

## Executable and platform rules

Resolution is exact and fail-closed:

```text
explicit project command > user command > Adapter default
```

Agent identity is not executable identity. `antigravity` configured with
`agy-proxy` launches `agy-proxy`, never a guessed `agy`. Arguments are passed
as arrays, so Windows paths with spaces, `.cmd` wrappers, PowerShell entry
points, Unicode, and ANSI output are handled without shell-string assembly.

`node-pty` is preferred. A direct Plugin checkout without installed package
dependencies, or a platform/Node combination where the native PTY cannot
initialize, may use the same owned Session protocol over bounded stdio pipes
as a degraded compatibility backend. In either mode, the Session Host can
interrupt or terminate only the process it created. Metadata excludes
environment variables, output is bounded/redacted, roots are validated, and
the Runtime never controls the Codex App Terminal UI.
