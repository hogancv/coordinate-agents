---
layout: page
title: Web Workspace and Local Inspector
description: A localhost-only dual-terminal workbench with lightweight collaboration, task-bound PTYs, and a guarded Runtime gateway; Inspector remains read-only.
---

# Web Workspace and Local Inspector

The **Web Workspace** is the lightweight interactive entry for Coordinate
Agents. Each Workspace task group owns a fresh **Codex + Antigravity** terminal
pair. The **Skill / CLI / MCP** path remains the structured workflow for durable
Tasks, Task Graphs, implementation evidence, recorded review, and recovery.
These modes share Session Runtime infrastructure, not an identical workflow.
The `inspector` command remains the compatible read-only observation UI.

## Start the Web Workspace

From an initialized Git repository with an Agent Bus, using an npm version
that includes the desired Web features:

```sh
npx @hogancv/coordinate-agents web --port 3000
```

To run the current source checkout (a merge does not publish npm):

```sh
node bin/coordinate-agents.mjs web --port 3000
```

Open the printed URL, normally `http://localhost:3000`. The server binds one
canonical regular Git repository root and rejects unsafe or symlinked roots.
Requests cannot switch repositories. It listens on `127.0.0.1` and, when
available, the same port on `::1`. Stop the server with `Ctrl-C`; use the
explicit terminal-close controls to close persistent sessions.
The workbench needs no Codex Plugin or remote coordination service;
agent CLIs still require their own provider configuration and login.

## Layout and first use

- **Sidebar:** repository and expandable Git identity, New task, Terminal
  settings, and Workspace groups only. Standard Tasks and Task Graphs are
  hidden, not deleted.
- **New task:** starts two new persistent PTYs, waits for CLI readiness, and
  submits role prompts. Titles are generated from time and ID, not output.
  There is no requirements form: enter requirements in Codex.
- **Interactive terminals:** keyboard input, Enter, arrows, and Ctrl-C are
  sent as ordered raw PTY data. Size follows the visible space; bounded,
  redacted output is polled independently, faster while active and after input.
- **Controls:** refresh, close, restart the pair, or close all Workspace
  terminal groups. Selecting or reloading never launches or retries an agent.
  Restart explicitly creates two new Sessions.
- **Settings:** customize the two fixed agents' commands, for example
  `agy-proxy` for Antigravity. Codex model and reasoning choices use the local
  model cache. Project-level arguments cannot be silently replaced by
  user-level model choices. Changes apply to future launches, not running
  CLIs. Project > user > adapter-default precedence still applies.
- **Language and layout:** `zh-CN` / `en-US` toggle persisted in localStorage,
  scrollable task list and viewport-sized terminal panels. Narrow screens
  stack terminals and place the sidebar in a drawer.

There is no Composer, synthetic chat timeline, right context panel, or
Graph / Agents / Sessions / Activity navigation. `composer-model.mjs` remains
a static compatibility resource, unused by the current Workspace UI.

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
