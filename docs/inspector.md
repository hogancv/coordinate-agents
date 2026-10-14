---
layout: page
title: Web Workspace and Local Inspector
description: A localhost-only dual-terminal workbench with lightweight collaboration, task-bound PTYs, and a guarded Runtime gateway; Inspector remains read-only.
---

# Web Workspace and Local Inspector

> **V3 distribution / 分发说明:** npm 3.x starts the Web Workspace only and exposes no structured Task/Graph API. The read-only Inspector remains in GitHub via `node bin/coordinate-agents-legacy.mjs inspector` or npm 2.4.0. Web startup initializes config/persistence directly without executing Agent Bus.


The **Web Workspace** is the lightweight interactive entry for Coordinate
Agents. Each Workspace task group owns a fresh terminal pair: **Default
Collaboration (Codex + Antigravity)** or **Custom Terminals**. The **Skill / CLI / MCP** path remains the structured workflow for durable
Tasks, Task Graphs, implementation evidence, recorded review, and recovery.
These modes share Session Runtime infrastructure, not an identical workflow.
The `inspector` command remains the compatible read-only observation UI.

## Custom Terminals / 自定义双终端

Custom mode launches two independent, task-and-slot-bound Generic CLI Sessions. Commands are executable names or absolute paths only, without arguments or shell syntax. Same-command pairs are supported. Project defaults and three optional Prompts are atomically stored in `.agent-bus/workspace-custom.json`; each task snapshots its commands and Prompts, including across restart. The shared Prompt is bounded to 8KB UTF-8; each terminal Prompt to 4KB. Prompt preview/copy and explicit confirmed bracketed-paste delivery are available per terminal, with keyboard queue reservation and no automatic retry. Unknown CLI readiness is never inferred. Default roles, rounds and cooperation reports are not available in Custom; diff viewing/copying remains usable.

自定义模式通过 Generic CLI 启动两个独立且归属于当前 Task / Slot 的 Session。命令仅支持可执行文件名或绝对路径，不能包含参数或 Shell 语法；允许两个相同命令。项目默认配置与三个可选 Prompt 原子保存于 `.agent-bus/workspace-custom.json`，任务创建时快照化，重启不受新配置影响。共享 Prompt 最多 8KB UTF-8，终端 Prompt 各 4KB。每个终端可预览、复制或在确认 CLI 支持多行括号粘贴后显式发送；发送预留键盘队列、不自动重试，不推断未知 CLI 就绪状态。Custom 不启用默认角色、roundId 或协作报告；Diff 仍可查看和复制。

## Start the Web Workspace

From a local folder, using an npm version
that includes the desired Web features:

```sh
npx @hogancv/coordinate-agents web --port 3000
```

To run the current source checkout (a merge does not publish npm):

```sh
node bin/coordinate-agents.mjs web --port 3000
```

Open the printed URL, normally `http://localhost:3000`. The startup directory
(or `--root`) is registered and selected automatically. Git subdirectories
normalize to the repository root; ordinary startup folders initialize Git and
Agent Bus without a commit. Symlinked roots are rejected.
It listens on `127.0.0.1` and, when
available, the same port on `::1`. Stop the server with `Ctrl-C`; use the
explicit terminal-close controls to close persistent sessions.
The workbench needs no Codex Plugin or remote coordination service;
agent CLIs still require their own provider configuration and login.

## Layout and first use

- **Sidebar:** expandable project groups, New project, New task, Terminal
  settings, and Workspace groups only. Standard Tasks and Task Graphs are
  hidden, not deleted.
- **New task:** opens a Default / Custom mode picker. Default starts two new persistent PTYs, waits for CLI readiness, and
  submits role prompts. Titles are generated from time and ID, not output.
  There is no requirements form: enter requirements in Codex.
- **Interactive terminals:** keyboard input, Enter, arrows, and Ctrl-C are
  sent as ordered raw PTY data. Size follows the visible space; bounded,
  redacted output is polled independently, faster while active and after input.
- **Controls:** refresh, close, restart the pair, or close all Workspace
  terminal groups in the selected project. Selecting or reloading never launches or retries an agent.
  Restart explicitly creates two new Sessions.
- **Settings:** customize the two fixed agents' commands, for example
  `agy-proxy` for Antigravity. Codex model and reasoning choices use the local
  model cache. Settings are saved in the selected project's configuration,
  preserving unrelated arguments. Changes apply to future launches, not running
  CLIs. Project > user > adapter-default precedence still applies.
- **Language and layout:** `zh-CN` / `en-US` toggle persisted in localStorage,
  scrollable task list and viewport-sized terminal panels. Narrow screens
  stack terminals and place the sidebar in a drawer.

There is no Composer, synthetic chat timeline, right context panel, or
Graph / Agents / Sessions / Activity navigation. `composer-model.mjs` remains
a static compatibility resource, unused by the current Workspace UI.

## Project storage and routing

New project opens the operating system folder chooser (macOS, Windows, or
Linux with Zenity). Cancel leaves project data unchanged. Plain folders require
initialization confirmation after selection. If the native chooser is unavailable,
the page falls back to a directory-only browser with absolute-path entry, parent
navigation, 100-entry pages, and a hidden-directory toggle. Ordinary folders
show an explicit **Add and initialize** confirmation. Initialization failures
identify the failed stage and keep any generated data for manual recovery.

The user configuration directory contains `workspace-projects.json`, an
atomically written, locked registry with stable IDs and canonical paths. Each
project retains its own `.agent-bus/workspace-tasks/`; nothing is migrated.
Unavailable directories remain visible. Refresh reloads the shared registry.
Switching projects preserves background terminals and restores the last task.
URLs use `#project-ID/workspace-ID`; old task-only links use the startup project.

`GET /api/projects` returns the registry and startup ID. Guarded `projectBrowse`
and `projectAdd` actions use `POST /api/action`. Project APIs use
`/api/projects/:projectId/api/...`, including the action gateway. These routes
require the launch capability and loopback Host/Origin checks. Each request
resolves its own project; tabs never change a server-global selection. Legacy
single-repository APIs remain bound to startup; read-only Inspector is unchanged.

## Web-lite collaboration and its limits

Web uses prompt version `2.3.0-web-lite-1`; CLI quickstart keeps its original
`2.3.0` prompts. Initialization is one short acknowledgement without tools.
The Web prompt does **not** automatically invoke the coordinate-agents skill,
restore old Tasks, scan Agent Bus, discover plugins, or create Task/Graph
records. Those operations require an explicit request.

Codex clarifies and reviews, directly answers greetings and explanations,
and delegates implementation goals, scope, and acceptance requirements to
the paired Antigravity. Antigravity implements, reports changes, validation,
and remaining issues, then waits. Codex reviews the real diff and evidence
proportionately. Prompts forbid commit, push, or release without authorization;
they are behavioral instructions, **not an enforced state machine or security
sandbox**. Applicable repository instructions still apply.

The injected communication entry uses `workspace-message.mjs`:

```sh
node skills/coordinate-agents/scripts/workspace-message.mjs <workspace-task-id> send 'instruction'
node skills/coordinate-agents/scripts/workspace-message.mjs <workspace-task-id> read <cursor>
```

It resolves only the group's saved Antigravity Session, verifies task/agent
binding, writes the instruction and Enter through Runtime, and returns a
cursor for bounded reads. It never selects another task's recent Session.
Delivery is not completion; output may contain redraws, and `idle` is not
proof of success. Timeout means pending, not permission to resend.

**Workspace group status describes terminal lifecycle, not implementation or
review completion.** Terminal replies do not automatically create structured
`IMPLEMENTATION_DONE`, review decisions, or recoverable Task checkpoints. Use
the [structured workflow](./getting-started.md#codex-plugin-first-path) when
needed. Web groups share the bound repository; creating a group does not
create an isolated Git worktree. Do not run conflicting code modifications
concurrently across groups.

## Persistence and pair lifecycle

```text
Workspace group (.agent-bus/workspace-tasks/<id>.json)
  ├── saved Codex Session ID       → Runtime-owned PTY → Codex CLI
  └── saved Antigravity Session ID → Runtime-owned PTY → configured agy command
```

Records contain generated title, status, prompt version, and both bindings.
New groups never reuse another group's active Sessions. Startup failure
triggers pair cleanup and a bounded error; closed Session records remain for
audit. Close is idempotent. Restart retains old closed records and creates
new IDs. Failures do not trigger automatic retries.

Workspace records are independent of `.agent-bus/tasks/*.json` and
`.agent-bus/task-graphs/*.json`. Existing standard records and backend contracts
are preserved; hiding them is not migration or deletion.

## Endpoints and guarded actions

Workspace GET endpoints:

- `/api/workspace-tasks` and `/api/workspace-tasks/:id`: Workspace groups.
- `/api/workspace-settings`: resolved terminal configuration and model choices.
- `/api/repository`: bounded Git identity facts.

Existing read contracts remain: `/api/tasks`, `/api/tasks/:id`, `/api/graphs`,
`/api/graphs/:id`, `/api/agents`, `/api/sessions`, `/api/events`, and
`/api/events/stream` (SSE with `Last-Event-ID` support). Journal history and
its labeled Derived / Legacy History fallback are not fabricated or backfilled.
The terminal UI uses bounded polling, not a reconstructed chat/event timeline.

`POST /api/action` is the sole browser mutation endpoint. Workspace uses
`workspaceTaskCreate`, `workspaceTaskClose`, `workspaceTaskRestart`,
`setupConfigure`, `sessionWrite`, `sessionResize`, and Session read/status
operations. Standard Task, Graph, setup, review, recovery, and Session action
contracts remain backend capabilities, not pages in the current UI.

Requests require the per-launch capability from the page's
`meta[name="coordinate-agents-capability"]`, sent in the
`x-coordinate-agents-capability` header. The gateway enforces loopback Host
and Origin, capability matching, bounded JSON, allow-listed names and schemas,
and the bound root before dispatching Runtime services. Correlation and
canonical bounded errors are preserved. Session input and resize enforce
Runtime ownership and state; arbitrary PIDs are not Session targets.

Page load, selection, refresh, and GET do not launch processes or send
instructions. Clicking New task and typing are explicit actions with real
process/filesystem consequences, not read-only observation; there is no
separate confirmation per keystroke.

## Inspector compatibility

```sh
npx @hogancv/coordinate-agents inspector --port 3000
```

Inspector retains its read-only UI, GET contracts, and non-GET rejection.
Use another port if Workspace already occupies this one.

## Security boundary

The local capability is not multi-user authentication. Do not expose the
server through a proxy or tunnel without an explicit security boundary.
There is no cloud synchronization or multi-tenant mode.

Agent commands and wrappers are trusted executables with their configured
permissions. The HTTP root restriction does not sandbox an agent's shell
or prevent repository edits. Proxy and permission settings belong to the
CLI/wrapper; Web-lite does not provide credential isolation or an approval bypass.

`.agent-bus` is local plaintext data. Bounded redaction reduces exposure but
is not a secret store: never put tokens, cookies, passwords, or private keys
in messages or evidence. See [Security](./security.md) and
[Session Runtime](./session-runtime.md) for underlying boundaries.
