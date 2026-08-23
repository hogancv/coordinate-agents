---
layout: page
title: FAQ
description: Answers about multi-agent coordination, Codex and Antigravity reference roles, adapter architecture, recovery, and security.
---

# Frequently asked questions

## What is the Plugin-first Task surface?

The Codex Plugin routes first-use intent through focused Skills: setup discovers
and configures a local Implementer, task owns durable Task records, review checks
evidence, and recover diagnoses explicit continuation. The Task API is layered on
the existing `.agent-bus`; it does not create a second transport. The npm CLI is
the Runtime/fallback surface for automation and advanced inspection.

## What is coordinate-agents?

A local-first coordination protocol, runtime, and Codex App/CLI skill for multi-agent software engineering in Git repositories. The core is agent-agnostic with an adapter-based runtime. OpenAI Codex App/CLI and Google Antigravity CLI serve as first-party reference adapters and the default reference workflow, while generic CLI agents can be registered directly and desktop/IPC surfaces connect through the adapter extension model.

## Can I use it directly in Codex App?

Yes. Install and enable the Codex plugin, add the target Git repository as a Codex App project, set
the thread project path to the repository root containing `.git`, and invoke `$coordinate-agents` in
a new thread. You do not need to manually open two CLI windows. The Runtime opens or reuses a
project/Agent-scoped persistent Execution Session for the configured Implementer, so configure the
actual executable command, such as `agy` or `claude`, and keep that CLI installed on the same machine.

The Session is a Runtime-owned PTY host, not the Codex App Terminal UI. Session tools are bounded and
operate only on the process created by that host.

For a non-reference CLI, ask Codex App to inspect the installed executable and its `--help` output,
register it with `generic-cli`, run `doctor`, and show the resolved configuration before starting a
task. This avoids copying prompt, directory, or permission flags from another CLI version.

## What is an Execution Session?

An Execution Session is independent process state for a configured Agent in one repository. A Task
stores a non-owning `sessionId`; a healthy Session can therefore survive a review round and receive
`CHANGES_REQUESTED` rework through the same PTY. `status`, `inspect`, `write`, `read`, and `close`
are explicit bounded operations. Recovery inspection does not restart, replay, or attach to an
arbitrary process, and no Session operation automates the Codex App Terminal UI.

## How do I prevent multiple AI agents from editing code simultaneously?

Assign clear, non-overlapping workflow roles. In the default reference workflow, Antigravity is the exclusive implementation writer while Codex specifies requirements and reviews commits. Do not execute concurrent Git writes on the same worktree.

## Does it share my accounts or API credentials?

No. Each agent and CLI maintains its native authentication and environment independently. Never place API tokens or credentials in `.agent-bus`.

## Can custom or third-party CLI agents be added?

Yes. Custom CLI agents can be registered dynamically using `coordinate-agents agent add <id> --adapter generic-cli --command <cmd> --args '<args>'`. Workflow roles (`planner`, `implementer`, `reviewer`) can be assigned to any registered agent.

The built-in Antigravity Adapter does not automatically add full permissions. Its legacy one-shot
path passes configured arguments and then appends `--prompt-interactive <prompt>`; a persistent
Session starts with `--prompt-interactive ""` for current `agy`/`agy-proxy` parsers, then writes its
first instruction through the PTY unless `{prompt}` is explicitly configured. If the local `agy --help` confirms
`--dangerously-skip-permissions` and the user explicitly wants it, set it with
`config set agent.antigravity.args`; otherwise the local `agy` configuration remains authoritative.

## Can interrupted work be resumed?

Yes. Message queues (`new`, `processing`, `processed`) and append-only state logs survive terminal restarts. Use `coordinate-agents doctor` or `scripts/agent-bus.mjs recover` to recover stale claims.

## Is `.agent-bus` encrypted?

No. It is a local plaintext directory on the filesystem and is excluded from ordinary Git tracking via `.git/info/exclude`, not an encrypted store.

## How do I uninstall it?

Run `npx @hogancv/coordinate-agents@latest uninstall`. Unrecognized or user-modified skill installations are preserved unless `--force` is explicitly authorized.

For detailed answers and exact commands, read the [English README](https://github.com/hogancv/coordinate-agents#faq) or [Simplified Chinese README](https://github.com/hogancv/coordinate-agents/blob/main/README.zh-CN.md#常见问题).
