---
layout: page
title: Antigravity CLI role (Default reference workflow)
description: Google Antigravity CLI serves as the reference implementer in coordinate-agents.
---

# Antigravity CLI role (Reference implementer)

> [!NOTE]
> This page describes Google Antigravity CLI's responsibilities in the **default reference workflow**. The underlying `.agent-bus` runtime is agent-agnostic and allows assigning the `implementer` role to other registered agents.

In the default reference workflow, Google Antigravity CLI (`agy`) fulfills the implementation role:

- claims an `IMPLEMENT` or `CHANGES_REQUESTED` message from `.agent-bus/inbox/antigravity/new`;
- edits source code, tests, UI, and build configuration;
- performs browser, unit, or UI validation when required;
- runs the agreed checks and records evidence under `.agent-bus/evidence/`;
- creates a focused Git commit and reports `IMPLEMENTATION_DONE`.

Antigravity does not approve its own work and does not merge, tag, push, deploy, or publish. It retains its native Google account authentication and model subscription.

The Plugin Task path uses the canonical Execution Session Runtime. `task dispatch` validates the
resolved command, opens or reuses one Runtime-owned persistent PTY, and records the Task's
non-owning `sessionId`. After `CHANGES_REQUESTED`, the next explicit dispatch reuses the same healthy
Session and writes the feedback into that PTY context. A Session in `exited` or `failed` is reported
as a fact and is never retried in a loop. The separate CLI `launch` command retains its legacy
bus-supervised compatibility policy; it is not the Plugin Session Manager.

Session status, bounded output, input, and close are available through the Coordinate Agents MCP
Session tools. They operate on the Runtime-owned process only and never type into or control the
Codex App Terminal UI.

The executable can be overridden per machine without changing the installed Skill or project
defaults:

```sh
npx @hogancv/coordinate-agents config set agent.antigravity.command agy-proxy
```

The project command, if explicitly present, takes precedence over
`~/.coordinate-agents/config.json`, which takes precedence over the Adapter default `agy`.
`launch` and Session dispatch check the resolved executable before starting. Spawn failures,
non-zero exits, and CLI conversation/runtime failures write structured `ERROR`/Session facts,
preserve bounded output, and stop. They are not automatically retried.
Login state is not preflighted; a login/provider error reported by `agy` is handled as a runtime
failure with a bounded stdout/stderr tail.

## Permission and sandbox arguments

The built-in `antigravity-cli` Adapter does not infer a permission mode. Its legacy one-shot path
passes configured `args` and then appends `--prompt-interactive <prompt>`; a persistent Session
starts with `--prompt-interactive ""` so current `agy`/`agy-proxy` parsers receive the required
empty initial prompt value, then writes its first instruction through the PTY unless `{prompt}` is
explicitly configured. It does not automatically add
`--dangerously-skip-permissions` or another sandbox-bypass flag. If `agy` is already configured
locally for full permissions, that native setting remains in effect.

If the installed `agy --help` confirms the explicit flag and the user intentionally wants to use it,
configure it outside the installed Skill/Plugin:

```sh
npx @hogancv/coordinate-agents@latest config set agent.antigravity.args '["--dangerously-skip-permissions"]'
npx @hogancv/coordinate-agents@latest config list
```

`doctor` verifies the executable and version, not the effective provider permission state. Never
copy a permission flag from another CLI or version without checking its own help output.
