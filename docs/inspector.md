---
layout: page
title: Local Inspector Web UI
description: A localhost-only, read-only dashboard for observing Coordinate Agents Tasks, Agents, Sessions, and Agent Bus events.
---

# Local Inspector Web UI

The Inspector is a small local observability surface for Coordinate Agents. It
helps answer “what is happening?” while the Codex Plugin and the existing
Runtime remain the product and execution surfaces.

It is intentionally not a SaaS console, a replacement for Codex, or a second
Task workflow. It does not accept Task input, send Agent messages, control
Sessions, or change Runtime state.

## Architecture

```text
Browser
   |
   | localhost-only HTTP GET
   v
Inspector Server
   |
   | read-only journal/state adapter
   v
Existing Coordinate Agents Runtime State
   ├── .agent-bus/events/runtime.jsonl
   ├── .agent-bus/tasks/*.json
   ├── .agent-bus/config.json
   ├── .agent-bus/state/<agent>/*.json
   ├── .agent-bus/inbox/<agent>/{new,processing,processed}/*.md
   └── .agent-bus/sessions/*.json
```

The Inspector does not create a database or duplicate the Task, Agent, Session,
or Event models. Recent events and Task/Session timelines prefer the Runtime's
real [Durable Event Journal](./event-journal.md). Repositories or individual
records that predate the journal continue to work through an explicitly labeled
**Derived / Legacy History** fallback; the Inspector never writes fabricated
events back to disk.

## Start it

From a Git repository initialized for Coordinate Agents:

```sh
npx @hogancv/coordinate-agents inspector
```

The default port is `3000`. Choose another local port when needed:

```sh
npx @hogancv/coordinate-agents inspector --port 3000
```

The CLI prints a URL such as `http://localhost:3000`. The server binds to
`127.0.0.1` only and accepts GET requests only. Stop it with `Ctrl-C`.

## Pages and panels

- **Tasks** — current Task title, status, round, and update time.
- **Agent flow** — the configured Planner → Implementer → Reviewer topology,
  including each Agent’s current Agent Bus state.
- **Task detail** — sequence-ordered recorded event timeline, role assignments, specification,
  implementation commit, evidence, review history, and last error.
- **Sessions** — Session state, timestamps, linked Tasks, bounded recent output,
  and recorded Session event history.
- **Recent events** — timestamp, sequence, event type, Task, Session, Agent, and
  a bounded summary from the append-only journal.

The dashboard receives new records through the localhost-only read-only
`GET /api/events/stream` SSE endpoint, resumes from `Last-Event-ID`, refreshes
periodically as a fallback, and has a manual Refresh button. It is
read-only by design; use the Plugin or the existing CLI/Runtime operations to
create, dispatch, review, resume, or stop Tasks.

## Data and security boundary

The Inspector reads only the selected repository’s existing `.agent-bus` state.
It validates the local Runtime path and uses bounded, redacted output for
Session logs, evidence details, messages, and error text. It does not add
authentication because the server is deliberately localhost-only; do not expose
the port through a proxy or network tunnel without adding an explicit security
boundary first.

`.agent-bus` remains local plaintext working data. Never put tokens, cookies,
passwords, private keys, or unnecessary production data in Bus messages or
evidence. The Inspector is an observability view, not a secret store.

## Compatibility and limitations

- History created before Event Journal support remains derived and may be
  incomplete; old history is never fabricated or backfilled.
- Recorded ordering uses repository-monotonic sequence values rather than
  timestamps.
- There is no authentication, remote access, mutation, chat, Task input form,
  multi-tenant mode, cloud sync, or benchmark/evaluation dashboard yet.
