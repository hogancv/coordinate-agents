---
layout: page
title: Protocol and recovery
description: How the local-first Agent Bus coordinates messages, claims, reviews, adapters, and interrupted work.
---

# Protocol and recovery

`.agent-bus` is a local-first coordination runtime with atomic message publication, atomic claiming,
deduplication keys, leases, quarantine, append-only agent state, idempotent completion, and
Runtime-owned Execution Session records. It does not require an external CAO server or database.

Key Task, Session, review, recovery, and Bus lifecycle hooks also append sanitized
schema-v1 records to `.agent-bus/events/runtime.jsonl`. This journal is
observability history, not an event-sourced replacement for current state.

## Architecture

1. **Coordination Layer**: Maps workflow roles (`planner`, `implementer`, `reviewer`) to registered agents and enforces human release gating (`RELEASE_APPROVED`).
2. **Agent Bus Protocol Layer**: Core message bus, queue lifecycle (`new/`, `processing/`, `processed/`), lease sidecars, append-only states, and crash recovery. Independent of vendor-specific transports.
3. **Execution Layer**: Separates Task state from project/Agent-scoped `ExecutionSession` objects.
   The Session Manager reuses healthy Sessions, while the PTY Runtime owns bounded interactive I/O
   and the Session Host owns only the process it created.
4. **Adapters & Runtime Layer**: Bridges concrete execution surfaces (CLI executables, desktop wrappers, IPC) with structured tasks.

Adapters also declare a normalized launch policy. The canonical Plugin Task path opens or reuses a
persistent PTY Session and stores a non-owning `sessionId` on the Task. A healthy Session is reused
after `CHANGES_REQUESTED`; `exited`/`failed` is reported without an automatic retry loop. The legacy
CLI `launch` path may still use `one-shot` or `bus-supervised` compatibility behavior; it is separate
from the Session Manager.

Typical workflow:

1. Planner (default: Codex) sends `IMPLEMENT` with a specification.
2. Implementer (default: Antigravity) claims it, implements, tests, commits, and sends `IMPLEMENTATION_DONE` with evidence.
3. Reviewer (default: Codex) validates the commit and evidence, then sends `CHANGES_REQUESTED` or `REVIEW_APPROVED`.
4. Release work remains blocked until the user separately enters `RELEASE_APPROVED`.
5. For a Task Graph, the Runtime then integrates verified subtask commits in a
   separate aggregate worktree and sends that aggregate through the existing
   reviewer boundary; integration and review never change the current checkout
   or authorize release actions.

Messages and state survive terminal restarts. Reinvoke the Skill and inspect `status` to resume. Recover a stale claim only after confirming no matching implementation, commit, or reply exists, because recovery may make the work eligible for delivery again.

`recover inspect` is facts-only and includes Session status when a Task has `sessionId`; it does not
restart a process, replay input, attach to an arbitrary PID, or control the Codex App Terminal UI.
Session output is bounded and redacted, and the configured executable is resolved exactly with
project-over-user precedence.

The full command and state contract is maintained in [`references/protocol.md`](https://github.com/hogancv/coordinate-agents/blob/main/references/protocol.md).
