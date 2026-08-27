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

Local Git exclusion prevents ordinary commits but does not block administrators, same-user processes, backups, cloud sync, or malware. Inspect and redact bus data before sharing diagnostics. Use the explicit `clean --confirm DELETE_AGENT_BUS` operation after audit retention is no longer needed.

The installer refuses unknown directories, symlinks, junctions, path escapes, modified installs, and extra files by default. Review the full [security policy](https://github.com/hogancv/coordinate-agents/blob/main/SECURITY.md), including private vulnerability reporting.
