# Execution Session and PTY Runtime

`ExecutionSession` is the canonical Runtime object for a long-lived coding-agent
process. It separates workflow state from process state:

```text
Task ──sessionId──> ExecutionSession ──owns──> Implementer PTY process
  │                                              │
  └── Agent Bus messages and review state         └── bounded output buffer
```

A Task may refer to a Session, but it does not own the Session. A Session is
scoped by the canonical repository root and Agent identity, and its effective
executable is part of the reuse key. The project-local record is persisted at
`.agent-bus/sessions/<sessionId>.json`; the live host is a detached Runtime
child, not a daemon or an external CAO service.

## Lifecycle

The Session and PTY states are:

```text
starting -> running <-> busy -> idle
                 \-> exited
                 \-> failed
```

- `starting`: the Runtime host is being attached and the executable is being spawned.
- `running`: the process is alive and ready for input.
- `busy`: input was written and the process is actively producing work/output.
- `idle`: the process is alive after a short quiet period and can receive the next task.
- `exited`: the owned process ended with exit code 0 or was closed cleanly.
- `failed`: executable, spawn, transport, or non-zero-exit failure. The state is
  inspectable and is never silently retried.

The bounded control surface is:

| Operation | Behavior |
| --- | --- |
| `open` | Resolve the configured executable, reuse a healthy matching Session, or start one PTY host. |
| `status` | Read state, PID, command, root, timestamps, exit facts, and bounded buffer counters. |
| `inspect` | Read-only status plus a bounded recent output excerpt with credentials redacted. |
| `write` | Send structured text to the owned process; never interprets it as a shell command. |
| `read` | Read bounded output from a cursor; truncation is reported explicitly. |
| `resize` | Apply terminal dimensions to a live PTY. |
| `interrupt` | Send Ctrl+C/interrupt to the owned process only. |
| `close` | Gracefully interrupt, then boundedly terminate the owned process and remove its endpoint. |

The public Plugin surface exposes `coordinate_agents_session_open`,
`coordinate_agents_session_status`, `coordinate_agents_session_inspect`,
`coordinate_agents_session_write`, `coordinate_agents_session_read`, and
`coordinate_agents_session_close`. Resize and interrupt are Runtime operations
for adapters and diagnostics; they are intentionally not exposed as broad UI
automation.

## Task and review semantics

`task dispatch` performs executable validation, sends the durable `IMPLEMENT`
handoff, then opens or reuses the Session. If the adapter consumed the first
specification as a launch argument, no duplicate input is written. Otherwise
the Runtime writes the specification to the live Session. A short bounded
grace period synchronizes immediate `IMPLEMENTATION_DONE` evidence; if the
Implementer is still working, the Task remains `WAITING_IMPLEMENTER` and later
status/inspect calls can observe it.

When a Reviewer records `CHANGES_REQUESTED`, the next explicit dispatch keeps
the Task's `sessionId` and writes the feedback plus the new specification into
the same healthy Session. It does not restart the CLI merely because the Task
round changed. If the Session is `exited` or `failed`, dispatch records the
fact, creates a replacement only through the normal explicit dispatch path,
and never loops until something works.

Recovery is facts-first. `recover inspect` includes Task error data, Agent Bus
state, executable facts, and Session facts when `sessionId` exists. Inspecting
does not mutate state, restart a process, replay input, or resume a Task. An
explicit user `task resume` followed by explicit dispatch is required after a
terminal Task error or stop.

## Executable identity and configuration

Agent identity, adapter, and executable are separate fields. Resolution is:

```text
explicit project command > user command > adapter default
```

For example, Agent identity `antigravity` may be configured with command
`agy-proxy`; the Runtime resolves and launches `agy-proxy` exactly and never
guesses `agy`. `session_open` fails before Bus handoff or process creation when
the final executable is missing, not runnable, or incompatible with the
adapter. Errors carry the Agent, command, root, stage, and `sessionId` when
available.

Interactive Session arguments are adapter-defined argument arrays. Generic
CLIs must be configured with flags verified from their installed `--help`; a
one-shot `{prompt}` template is not silently treated as an interactive
conversation. No command is assembled as a shell string.

## Platform and security boundary

- Windows uses structured `CreateProcess` arguments through the PTY backend,
  supports paths containing spaces, and treats `.cmd`/PowerShell resolution as
  executable configuration rather than string concatenation.
- Unix uses a local permission-restricted socket endpoint; Windows uses a
  process-scoped named pipe. Endpoints are derived from the root and Session
  ID, never accepted from the caller as an arbitrary path.
- `node-pty` is the preferred PTY backend. A Plugin checkout without installed
  package dependencies, or a platform/Node combination where the native PTY
  cannot initialize, may use the same bounded Session protocol over owned
  stdio pipes as a degraded compatibility backend; it never broadens process
  ownership or shell access.
- Ctrl+C is sent through the PTY when available. Forced termination is bounded
  and can target only the process created by that Session host.
- Output is bounded in memory and in every read/inspect response. Metadata
  stores command, arguments, root, state, and exit facts, but not environment
  variables or raw `.agent-bus` payloads. Output and errors are redacted before
  leaving the Runtime.
- The Runtime refuses symlinked/path-escaping roots and malformed Session
  records. It does not attach to arbitrary PIDs, control a desktop terminal,
  invoke Codex App UI actions, or manipulate another application window.

## Role boundary

Codex remains the Planner and Reviewer: clarify requirements, approve the
specification, inspect commits/evidence, and decide `REVIEW_APPROVED` or
`CHANGES_REQUESTED`. The configured local Agent is the Implementer: it edits
product code and tests in the selected repository. The Runtime owns transport,
Session lifecycle, bounded I/O, and recovery facts; it does not turn Codex into
an additional Implementer or release authority.
