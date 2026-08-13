---
layout: page
title: Protocol and recovery
description: How the recoverable .agent-bus coordinates messages, claims, reviews, and interrupted work.
---

# Protocol and recovery

`.agent-bus` is a project-local file bus with atomic message publication, atomic claiming, deduplication keys, leases, quarantine, append-only role state, and idempotent completion.

Typical flow:

1. Codex sends `IMPLEMENT` with a specification.
2. Antigravity claims it, implements, tests, commits, and sends `IMPLEMENTATION_DONE`.
3. Codex validates the commit and evidence, then sends `CHANGES_REQUESTED` or `REVIEW_APPROVED`.
4. Release work remains blocked until the user separately enters `RELEASE_APPROVED`.

Messages and state survive terminal restarts. Reinvoke the Skill and inspect `status` to resume. Recover a stale claim only after confirming no matching implementation, commit, or reply exists, because recovery may make the work eligible for delivery again.

The full command and state contract is maintained in [`references/protocol.md`](https://github.com/hogancv/coordinate-cli-agents/blob/main/references/protocol.md).

