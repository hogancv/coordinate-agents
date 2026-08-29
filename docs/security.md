---
layout: page
title: Security
description: Security and privacy boundaries for the local plaintext .agent-bus and package installer.
---

# Security

`.agent-bus` is **local plaintext working data**, including the append-only Event Journal under
`.agent-bus/events/`. It is not encrypted and must not contain tokens, cookies, passwords, private keys, or unnecessary production data.

Execution Session metadata is bounded and excludes environment variables. Session endpoints are
derived from the validated repository root and Session ID; input is structured text, not a shell
string; and the Session Host can interrupt or terminate only the process it created. The Runtime
does not attach to arbitrary PIDs or automate the Codex App Terminal UI. The preferred `node-pty`
backend may use a bounded owned-stdio compatibility backend when a direct Plugin checkout has no
installed package dependencies.

Task Graph v1 validation is read-only and precedes Git discovery, Bus handoff, Adapter resolution,
worktree or Session creation, and child-process spawn. Invalid DAGs return the bounded
`TASK_GRAPH_INVALID` Runtime error without initializing `.agent-bus` or persisting graph state.
The separate graph-create operation persists only an already validated graph record and its
append-only lifecycle event; it does not launch an Adapter, Session, or Implementer process.
Graph planning reports deterministic dependency, capacity, and exact configured
Agent/Adapter/executable facts without creating a worktree, Bus message, Session, lifecycle event,
or child process.
The graph-dispatch operation captures one exact base commit and uses only a Runtime-owned,
repository-contained, non-symlinked worktree and branch for the selected READY subtask. Its
persistent Session is rooted at that worktree; exact Adapter command precedence, bounded I/O, and
non-zero exit semantics remain in force. Launch or completion failures do not trigger automatic
retry/fallback or mutate unrelated subtasks, and dispatch never changes the user's checkout.
Parallel graph execution claims READY subtasks under the graph lock, atomically enforces the
persisted concurrency limit, and gives every selected subtask a distinct worktree, branch/ref,
message, and Session identity rooted at one exact graph base commit. Failures remain isolated and
never trigger fallback or automatic retry. Graph recovery is facts-first: status and inspect expose
durable Session/worktree/commit/evidence classifications, and recovery only promotes a verified
`IMPLEMENTATION_DONE` commit or records an interrupted `FAILED` state. Explicit resume reuses a
verified healthy Runtime-owned Session/worktree and otherwise returns `READY` for a separate
dispatch; it never loops or infers success from filenames or prose. Explicit graph stop/cleanup
close only matching Runtime-owned Sessions and remove only the exact Runtime-owned worktree after
a bounded timeout. Ownership mismatches, symlinks, path escapes, and cleanup failures are
preserved as durable bounded errors; branches, refs, commits, evidence, and the user's worktree
remain intact.
Graph integration is a separate, explicit boundary. It runs only after every required subtask has
verified completion evidence, checks the exact Runtime source refs and captured base commit, and
applies commits in deterministic order inside a distinct Runtime-owned aggregate worktree. It
never changes the current checkout or source worktrees. A cherry-pick conflict remains in place
with bounded source, applied-ref, Git-status, and conflict facts for inspection; no automatic
resolution, reset, retry, merge, push, tag, publish, deploy, or release occurs. Aggregate review
rechecks those facts before recording `REVIEW_APPROVED` or `CHANGES_REQUESTED`, and cleanup
retains the aggregate branch, commits, conflict facts, and evidence.

Local Git exclusion prevents ordinary commits but does not block administrators, same-user processes, backups, cloud sync, or malware. Inspect and redact bus data before sharing diagnostics. Use the explicit `clean --confirm DELETE_AGENT_BUS` operation after audit retention is no longer needed.

The installer refuses unknown directories, symlinks, junctions, path escapes, modified installs, and extra files by default. Review the full [security policy](https://github.com/hogancv/coordinate-agents/blob/main/SECURITY.md), including private vulnerability reporting.
