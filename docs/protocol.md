---
layout: page
title: Protocol and recovery
description: How the local-first Agent Bus coordinates messages, claims, reviews, adapters, and interrupted work.
---

# Protocol and recovery

`.agent-bus` is a local-first, serverless coordination runtime with atomic message publication, atomic claiming, deduplication keys, leases, quarantine, append-only agent state, and idempotent completion.

## Architecture

1. **Coordination Layer**: Maps workflow roles (`planner`, `implementer`, `reviewer`) to registered agents and enforces human release gating (`RELEASE_APPROVED`).
2. **Agent Bus Protocol Layer**: Core message bus, queue lifecycle (`new/`, `processing/`, `processed/`), lease sidecars, append-only states, and crash recovery. Independent of vendor-specific transports.
3. **Adapters & Runtime Layer**: Bridges concrete execution surfaces (CLI executables, desktop wrappers, IPC) with structured tasks.

Adapters also declare a normalized launch policy. `one-shot` launches once, while `bus-supervised` keeps the parent Runtime alive after clean exits, observes queue/state changes without claiming work, and reactivates the Agent with compact resume context. `STOPPED` ends cleanly, non-zero exits fail without restart, and `launch --once` disables supervision generically.

Typical workflow:

1. Planner (default: Codex) sends `IMPLEMENT` with a specification.
2. Implementer (default: Antigravity) claims it, implements, tests, commits, and sends `IMPLEMENTATION_DONE` with evidence.
3. Reviewer (default: Codex) validates the commit and evidence, then sends `CHANGES_REQUESTED` or `REVIEW_APPROVED`.
4. Release work remains blocked until the user separately enters `RELEASE_APPROVED`.

Messages and state survive terminal restarts. Reinvoke the Skill and inspect `status` to resume. Recover a stale claim only after confirming no matching implementation, commit, or reply exists, because recovery may make the work eligible for delivery again.

The full command and state contract is maintained in [`references/protocol.md`](https://github.com/hogancv/coordinate-cli-agents/blob/main/references/protocol.md).
