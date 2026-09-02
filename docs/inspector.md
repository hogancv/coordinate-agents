---
layout: page
title: Web Workspace and Local Inspector
description: A localhost-only Web Workspace for Coordinate Agents with read-only project overview and a guarded browser-to-Runtime action gateway. The Inspector remains the compatible read-only UI.
---

# Web Workspace and Local Inspector

The **Web Workspace** is the primary local browser entry for Coordinate Agents.
It starts a loopback-only project overview for one selected Git repository and
answers "what is happening?" without requiring Codex Plugin, a global
installation, or a remote service. Overview, refresh, selection, and event
replay are strictly read-only; a guarded action endpoint routes a small,
explicit allow-list of operations to the shared Runtime without making the
browser a second state owner. The **Inspector** command remains a behaviorally
compatible read-only UI over the same server and data adapter.

Both surfaces are intentionally not a SaaS console, a replacement for Codex, or
a second Task workflow. Read paths never send Agent messages, control Sessions,
or change Runtime state; action-gateway mutations reuse the exact Runtime
validation, locks, and durable state owned by CLI and MCP.

## Architecture

```text
Browser (Workspace UI)
   |
   | localhost-only HTTP GET
   v
Workspace / Inspector Server  (one shared read-only server)
   |
   | read-only journal/state adapter + repository identity facts
   v
Existing Coordinate Agents Runtime State
   ├── .git  (repository identity only: branch, HEAD, origin remote)
   ├── .agent-bus/events/runtime.jsonl
   ├── .agent-bus/tasks/*.json
   ├── .agent-bus/task-graphs/*.json
   ├── .agent-bus/config.json
   ├── .agent-bus/state/<agent>/*.json
   ├── .agent-bus/inbox/<agent>/{new,processing,processed}/*.md
   └── .agent-bus/sessions/*.json
```

The Workspace does not create a database or duplicate the Task, Agent, Session,
or Event models. Recent events and Task/Session timelines prefer the Runtime's
real [Durable Event Journal](./event-journal.md). Repositories or individual
records that predate the journal continue to work through an explicitly labeled
**Derived / Legacy History** fallback; neither surface ever writes fabricated
events back to disk.

## Start the Web Workspace (primary entry)

From an initialized Git repository:

```sh
npx @hogancv/coordinate-agents web --port 3000
```

The CLI prints a URL such as `http://localhost:3000`. The server binds exactly
one canonical regular Git repository root at startup and refuses unsafe or
symlinked roots. Browser requests can never select another root. The primary
listener binds to `127.0.0.1`; when IPv6 loopback is available, `::1` is served
on the same port as a localhost compatibility alias. Both listeners are
loopback-only. Every read path accepts GET only; the sole mutation surface is
the guarded action endpoint below. Stop it with `Ctrl-C`.

## Guarded actions (POST /api/action)

The Workspace exposes exactly one additive, guarded action endpoint for later
controls: `POST /api/action`. It routes an explicit allow-list of structured
operations to the same shared Runtime services used by CLI and MCP
(`taskCreate`, `taskStatus`, `taskInspect`, `taskGraphStatus`,
`taskGraphInspect`, `taskGraphPlan`, `taskGraphValidate`, `recoverInspect`).
The gateway never shells out, parses CLI output, proxies MCP, accepts an
arbitrary operation name, or lets a request choose a different repository root.

Every non-GET request must carry the server-issued **per-launch capability** in
the `x-coordinate-agents-capability` header. The Workspace page receives it in a
`meta[name="coordinate-agents-capability"]` tag at load time; it changes on
every server start. Requests are validated in this order and fail closed before
any Runtime side effect:

1. Path must be `/api/action`; every other path stays a read-only GET surface.
2. `Host` and (when present) `Origin` must be loopback (`localhost`,
   `127.0.0.1`, or `::1`).
3. The per-launch capability must match.
4. `Content-Type` must be `application/json` and the body is bounded.
5. The body must be a JSON object with an allow-listed `action` name and a
   `params` object whose keys match the action schema (including an optional
   `root` that must equal the bound repository root).
6. The operation runs through `runtime-services.mjs` with the bound root
   injected. Responses preserve Runtime identity fields (`ok`, `command`),
   canonical error codes, recoverability, and bounded diagnostics, and carry a
   `correlation` value echoed from the request's `correlationId` or
   `x-correlation-id` header.

Concurrency and replay safety follow the existing Runtime locks and
deduplication rules: deterministic Task IDs make `taskCreate` replay-safe
(repeats return `TASK_STATE_CONFLICT`), graph validation and preflight stay
side-effect free, and read paths never launch an Agent or mutate graph/session
state. Process-launching, Session-input, stop, cleanup, integration, and review
operations require explicit UI confirmation and are added by later tickets.

## Start the Inspector (compatibility path)

The documented read-only Inspector command keeps its behavior and GET contract:

```sh
npx @hogancv/coordinate-agents inspector --port 3000
```

## Pages and panels

The Workspace overview opens with the **bound repository** identity (repository
name, current branch, HEAD commit, latest commit subject, origin remote, and the
canonical bound root path), followed by:

- **Tasks** — current Task title, status, round, and update time for ordinary Tasks, plus distinguishable Task Graph parent entries with subtask count, max concurrency, and subtask state tallies.
- **Agent flow** — the configured Planner → Implementer → Reviewer topology,
  including each Agent's current Agent Bus state.
- **Task detail & Task Graph topology** — for ordinary Tasks: sequence-ordered recorded event timeline, role assignments, specification, implementation commit, evidence, review history, and last error. For Task Graphs: an **interactive dependency map** (deterministic layered layout, one focusable node per bounded subtask, dependency arrows from each dependency to its dependent, state legend, keyboard focus/`Escape`, and a selected-node evidence panel with the same bounded authoritative facts as the graph API — Agent/Adapter/executable, Session/worktree/commit, Scope Audit, recovery, cleanup, and last error) above the text topology, frontier decisions, preflight waves, write-intent conflicts, integration facts, and review decisions. Large graphs degrade with a bounded deterministic truncation notice; the map renders no edges and no browser graph model of its own.
- **Sessions** — Session state, timestamps, linked Tasks, bounded recent output,
  and recorded Session event history.
- **Recent events** — timestamp, sequence, event type, Task, Session, Agent, and
  a bounded summary from the append-only journal.

## Endpoints

Read-only GET surface:

- `GET /api/repository` — bounded identity facts for the bound Git repository (name, branch or detached HEAD, HEAD short SHA/subject/date, origin remote).
- `GET /api/tasks` — mixed listing of ordinary Tasks and Task Graph parents.
- `GET /api/tasks/:id` — task detail or Task Graph detail by ID.
- `GET /api/graphs` — listing of persisted Task Graph parent summaries.
- `GET /api/graphs/:id` — exhaustive bounded Task Graph detail.
- `GET /api/agents` — configured Agents and current Agent Bus observation.
- `GET /api/sessions` — persistent Execution Sessions and recent bounded logs.
- `GET /api/events` — Event Journal records with query filtering.
- `GET /api/events/stream` — SSE event stream with `Last-Event-ID` resume support.

Guarded action surface (Workspace only):

- `POST /api/action` — allow-listed Runtime operations with per-launch
  capability, loopback Host/Origin, bounded JSON, and bound-root enforcement
  (see [Guarded actions](#guarded-actions-post-apiaction) above).

The dashboard receives new records through the localhost-only read-only
`GET /api/events/stream` SSE endpoint, resumes from `Last-Event-ID`, refreshes
periodically as a fallback, and has a manual Refresh button. Every read path is
side-effect free; use the action gateway for the allow-listed Runtime
operations or the Plugin/CLI for dispatch, review, resume, and stop.

## Data and security boundary

The Workspace reads only the selected repository's existing `.agent-bus` state
and derives a bounded repository identity from read-only Git helpers. It
validates the local Runtime path and uses bounded, redacted output for Session
logs, evidence details, messages, and error text. It does not add
authentication because the server is deliberately localhost-only; do not expose
the port through a proxy or network tunnel without adding an explicit security
boundary first.

`.agent-bus` remains local plaintext working data. Never put tokens, cookies,
passwords, private keys, or unnecessary production data in Bus messages or
evidence. The Workspace is a control-plane view, not a secret store.

## Compatibility and limitations

- History created before Event Journal support remains derived and may be
  incomplete; old history is never fabricated or backfilled.
- Recorded ordering uses repository-monotonic sequence values rather than
  timestamps.
- There is no authentication beyond the local per-launch capability, remote
  access, chat, multi-tenant mode, cloud sync, or benchmark/evaluation
  dashboard. Workspace mutations are limited to the allow-listed actions above;
  process-launching, Session-input, stop, cleanup, integration, and review
  controls (with explicit UI confirmation) arrive in later tickets.
- `coordinate-agents web` requires an initialized Git repository root; the
  compatibility `inspector` command keeps its existing validation behavior.
