---
layout: page
title: Security
description: Security and privacy boundaries for the local plaintext .agent-bus and package installer.
---

# Security

`.agent-bus` is **local plaintext working data**. It is not encrypted and must not contain tokens, cookies, passwords, private keys, or unnecessary production data.

Local Git exclusion prevents ordinary commits but does not block administrators, same-user processes, backups, cloud sync, or malware. Inspect and redact bus data before sharing diagnostics. Use the explicit `clean --confirm DELETE_AGENT_BUS` operation after audit retention is no longer needed.

The installer refuses unknown directories, symlinks, junctions, path escapes, modified installs, and extra files by default. Review the full [security policy](https://github.com/hogancv/coordinate-agents/blob/main/SECURITY.md), including private vulnerability reporting.
