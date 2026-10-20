---
layout: page
title: Getting started
description: Start the local Web Workspace, choose npm or current source, configure terminals, and complete a first Codex and Antigravity collaboration task.
---

# Getting started

For the previous product direction, see [v2.4 original docs and migration](./v2.4.html).

The main entry is the **Web Workspace**, a local browser workbench with two
persistent coding-agent terminals. No Codex Plugin, Skill installation, MCP
setup, or global npm installation is needed for this path.

## 1. Check prerequisites

Install Node.js >=18, Git, and the coding CLIs you want to use. For Default
Collaboration, check:

```sh
node --version
git --version
codex --version
agy --version
```

Sign in to each agent through its own CLI before creating a task. Workspace
checks executable availability; that does not verify provider access, login,
model availability, or account quota. Custom tasks check their saved two commands
instead of requiring the default pair.

Native PTY support depends on the installed Node/platform combination. Node 18
retains an owned-stdio fallback; it cannot provide full TUI or child-observed
resize behavior. See [terminal troubleshooting](./troubleshooting.html#terminal-display-or-resize-is-limited).

## 2. Choose published npm or current source

### Published npm

```sh
npx @hogancv/coordinate-agents@latest web --root "/path/to/project" --port 3000
```

As checked on **2026-10-20**, `latest` resolves to **3.0.1**. To reproduce that
release explicitly, use `@3.0.1` in place of `@latest`.

### Current source

The Git Changes/review feedback, Custom Terminals, desktop notification,
Collaboration Timeline, and Collaboration Health additions were made after
3.0.1. To use the current code:

```sh
git clone https://github.com/hogancv/coordinate-agents.git
cd coordinate-agents
npm ci
node bin/coordinate-agents.mjs web --root "/path/to/project" --port 3000
```

For an existing checkout, run the last two commands from its root. A source
merge does not publish npm. Feature descriptions in the [Workspace guide](./inspector.html)
refer to the current checkout.

Open the printed URL, normally `http://localhost:3000`. Use `--port 0` to choose
a free port. The selected startup folder is registered automatically. A Git
subdirectory resolves to its repository root; a non-Git startup folder initializes
Git and Workspace storage without a commit. Choose the directory deliberately.

The npm 3.x command surface is `web`, `--help`, and `--version`. Web accepts
`--root`, `--port`, and `--json`. Older `install`, `doctor`, `config`, `task`,
`quickstart`, and `inspector` commands require the separate Legacy runtime.

## 3. Check Workspace settings

Settings has three independently saved tabs in current source:

- **Default Collaboration:** `codex` and `agy` executable overrides, plus optional Codex model and reasoning choices. Changes apply to new launches and restarts.
- **Custom Terminals:** two executable defaults and optional shared/per-terminal prompts. New tasks snapshot these settings; existing Custom tasks retain their snapshot on restart.
- **Desktop Notifications:** project-level preferences, disabled by default. Windows 10/11 and macOS are supported; Linux reports unsupported.

Executable fields accept a command name or absolute path, without inline
arguments or shell syntax. Leave the Codex model blank to use the CLI default.
Save the active tab; switching tabs retains unsaved edits.

## 4. Run your first default task

1. Click **New task**, choose **Default Collaboration**, and wait for the two CLIs to initialize.
2. Enter a concrete requirement directly in Codex, for example: “Fix this cache invalidation bug, preserve the public API, and run the relevant regression test.”
3. Codex sends the goal, scope, and acceptance criteria to this task's Antigravity using its supplied helper.
4. Antigravity reports `WORKING`, implements, validates, and reports `DONE` or `FAILED`.
5. Codex reviews the actual changes and evidence, then reports `APPROVED` or `CHANGES_REQUESTED`. Corrections are sent as a new round.

Expand **Collaboration Timeline** to inspect dispatches and reports.
`SENT` confirms dispatch, not completion. `DONE` and `APPROVED` are formal agent
reports, not independent verification. Task-list running/closed status describes
terminal lifecycle, not implementation or review completion.

Use **Git Changes** to inspect working-tree diffs. In Default mode, select lines,
add review notes, and confirm Codex is at a blank input prompt before sending.
That readiness confirmation is cleared after each successful send. Diffs may
include earlier user edits and do not cover changes already committed.

## 5. Keep or close your sessions

Refresh reconnects to the saved sessions. Switching projects leaves background
terminals running. Browser close and Web server shutdown do not themselves close
the independent Session Hosts; use **Close**, **Restart**, or the selected
project's **Close all terminals** controls explicitly.

Right-click a task or project to archive it and close its terminals. Source files
remain. Settings can permanently clear archived conversations across registered
projects, including their timeline history. Re-adding an archived project's
folder restores its project entry.

Web tasks share the project's working directory and do not create isolated
worktrees. Avoid simultaneous conflicting edits. Prompts require authorization
for commit, push, and release; they are behavioral instructions, not a sandbox.

## Success and failure signals

A successful first run shows both configured CLIs, a single task-bound dispatch,
an implementation receipt, and Codex's review of real changes and validation.
Check the report and diff; do not use terminal idle or task-list status as proof.

On startup failure, inspect the executable and session diagnostics before
explicitly restarting. A timeout means pending, not permission to resend input.
Health hints identify missing evidence or session problems; silence alone does
not prove an agent is stuck. See [Troubleshooting](./troubleshooting.html).

## If you need structured Tasks or a Codex Plugin

Use the separate [Structured workflow guide](./structured-workflow.html) for
Plugin installation, Agent Bus Tasks, implementation evidence, Task Graphs,
recorded review, and recovery. These capabilities are retained in GitHub source /
Plugin and npm 2.4.0; npm 3.x Web does not expose them.

Next: [Workspace guide](./inspector.html) · [FAQ](./faq.html) · [Security](./security.html)
