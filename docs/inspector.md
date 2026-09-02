---
layout: page
title: Web Workspace and Local Inspector
description: A localhost-only Web Workspace for Coordinate Agents with read-only project overview and a guarded browser-to-Runtime action gateway. The Inspector remains the compatible read-only UI.
---

# Web Workspace and Local Inspector

The **Web Workspace** is the primary local browser entry for Coordinate Agents.
It starts a loopback-only, **chat-first workbench** for one selected Git
repository — a three-column AI-chat layout with full `zh-CN` / `en-US`
bilingual UI — that answers "what is happening?" without requiring Codex
Plugin, a global installation, or a remote service. Chat rendering, refresh,
selection, and event replay are strictly read-only; a guarded action endpoint
routes a small, explicit allow-list of operations to the shared Runtime
without making the browser a second state owner. The **Inspector** command
remains a behaviorally compatible read-only UI over the same server and data
adapter.

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
(`setupDiscover`, `setupConfigure`, `taskCreate`, `taskDispatch`, `taskStatus`,
`taskInspect`, `taskStop`, `taskResume`, `taskReview`, `taskGraphStatus`,
`taskGraphInspect`, `taskGraphPlan`, `taskGraphValidate`, `taskGraphCreate`,
`taskGraphRun`, `taskGraphAdvance`, `taskGraphStop`, `taskGraphRecover`,
`taskGraphResume`, `taskGraphCleanup`, `taskGraphIntegrate`,
`taskGraphReview`, `sessionStatus`, `sessionInspect`, `sessionRead`,
`sessionWrite`, `sessionClose`, `recoverInspect`).
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

## Pages and layout

The Workspace is a **chat-first, three-column workbench** (a normal AI chat
product layout, not a dashboard of debug panels). It supports full `en-US` /
`zh-CN` bilingual UI with a top-right **中文 / English** toggle; the choice is
persisted in `localStorage` (`coordinate-agents.locale`) and applies instantly
without a reload. Locale defaults to `zh-CN` for `zh-*` browser languages and
`en-US` otherwise. Every visible string (navigation, buttons, form labels,
empty/loading/toast states, status badges, timestamps) is localised through one
I18N dictionary; user-supplied data (Task titles/specifications, IDs, commits,
paths, Agent IDs, code, logs) is never translated or rewritten, and unknown
backend statuses/events fall back to a localised generic label while preserving
the original code.

- **Left Sidebar** — Coordinate Agents brand, the **bound repository** chip
  (repository name, current branch or detached HEAD; expandable details show
  HEAD short SHA/subject/date, origin remote, and canonical bound root), a
  **New task** button, the Chat / Tasks / Agents / Sessions / Activity
  navigation, and a Recent list of Tasks and Sessions with the current
  selection highlighted. On screens ≤ 1024 px the sidebar becomes an
  off-canvas drawer opened from the top bar.
- **Chat (default view)** — a welcome card explains what the workspace can do.
  Selecting a Task or Task Graph turns the centre column into a truthful
  conversation timeline rebuilt from the authoritative Runtime record: the Task
  card (title, ID, status, specification text), each recorded status/event
  transition with Agent and Session identity, Session output, review decisions,
  and last error, plus actions you actually performed in this browser session.
  Nothing is fabricated — no invented agent thoughts, replies, or statuses.
- **Composer** — a bounded multi-line input (Enter creates, Shift+Enter adds a
  new line), an Agent select (populated from the configured Agents), and a Mode
  select. Single-task mode creates one durable Task through the guarded
  `taskCreate` action and opens it in the chat; Task Graph mode opens the
  Authoring drawer pre-filled with the title and specification. Clear feedback
  is shown when no Agent is configured, while a request is in flight, and on
  success or failure.
- **Right Context panel** — a compact summary of the selected Task/Graph
  (state, roles, subtask/concurrency facts) or the workspace counts, plus entry
  buttons that open the detail drawers. Agent flow (Planner → Implementer →
  Reviewer topology with current Agent Bus state) stays visible here. The panel
  is collapsed by default on narrow screens and slides in as a drawer.
- **Tasks view** — all durable Tasks and Task Graph parents (title, status,
  round, update time; graphs show subtask count, max concurrency, and state
  tallies), plus counts.
- **Agents view** — the Agent setup panel shows installed coding CLI detection
  and the Adapter registry on demand (manual Discover, no background scanning),
  with distinct Agent / Adapter / executable identity and command-source badges
  (project > user > adapter-default). A bounded form configures a project Agent,
  Adapter, exact executable command, and workflow role through the guarded
  `setupConfigure` transaction (validation first, atomic rollback on failure).
  Configured runtime Agents show adapter, roles, status, and queue depth. The
  panel states that loaded local Adapter modules are trusted local code, that
  configuration grants no browser filesystem/process bypass, and that no
  credential or secret is rendered or persisted.
- **Sessions view** — Session state, timestamps, linked Tasks, bounded recent
  output, and recorded Session event history. Active Runtime-owned Sessions show
  a bounded input control (explicit submit only) and a Close control; arbitrary
  PIDs, paths, commands, environment data, and unattached processes are always
  rejected by the Runtime ownership checks.
- **Activity view** — the recent Event Journal feed (timestamp, sequence, event
  type, Task, Session, Agent, and a bounded summary; recorded vs Derived /
  Legacy History labels; click a Task id to jump to it).
- **Detail drawer (Task & graph)** — opened from the Context panel: for
  ordinary Tasks the sequence-ordered recorded event timeline, role
  assignments, specification, implementation commit, evidence, review history,
  and last error; for Task Graphs the **interactive dependency map**
  (deterministic layered layout, one focusable node per bounded subtask,
  dependency arrows, state legend, keyboard focus/`Escape`, and a selected-node
  evidence panel with the same bounded authoritative facts as the graph API —
  Agent/Adapter/executable, Session/worktree/commit, Scope Audit, recovery,
  cleanup, and last error) above the text topology, frontier decisions,
  preflight waves, write-intent conflicts, integration facts, and review
  decisions. Large graphs degrade with a bounded deterministic truncation
  notice; the map renders no edges and no browser graph model of its own. The
  drawer also hosts the **Execution controls** and **Review & integrate**:
  - **Execution controls** are never triggered by page load, GET, SSE
    reconnect, or a double click. Dispatch, Run eligible wave, and Advance are
    armed only after the user checks an understanding box (an Agent process may
    write to the repository; failures are never retried automatically; no
    merge, push, tag, publish, deploy, or release occurs). Graph Advance
    requires an explicit bounded `maxWaves` (1–32) and Graph Run an optional
    bounded session-wait (0–10000 ms). Results surface the same Task/subtask,
    Session, worktree, commit, evidence, and stop facts as the shared Runtime
    operation; stale or invalid state returns a conflict and views refresh from
    the authoritative Runtime record via bounded SSE/refresh with `Last-Event-ID`
    resume. State-aware Recovery rows (Stop, Recover, Resume, Clean up
    worktrees) reuse the existing ownership and recovery semantics, are
    idempotency- and conflict-aware, and never retry automatically, silently
    discard verified commits/evidence/user files, or touch remote refs. Cleanup
    removes only Runtime-owned Sessions/worktrees. The Workspace never modifies
    the user's checked-out worktree or remote refs.
  - **Review & integrate** — an explicit integrate action (applies verified
    subtask commits only to the Runtime-owned aggregate review worktree) and a
    bounded review form that records `REVIEW_APPROVED` / `CHANGES_REQUESTED`
    with feedback/evidence through the shared Runtime operation; decisions are
    durable and visible after reload and requested changes never trigger an
    automatic retry. The surface shows commits, worktrees, Scope Audit, intent
    conflicts, recovery, integration, Sessions, Event Journal, and review
    history with parent identity preserved, and states plainly that review
    approval is not the human `RELEASE_APPROVED` gate — the Workspace offers no
    merge, push, tag, publish, deploy, or release control.
- **Authoring drawer** — opened from **New task** (or the Composer in Task
  Graph mode): creates one durable Task or a Task Graph v1 (with optional
  Intent Map v1) without dispatching anything. Bounded forms cover
  title/specification, role assignments from the configured Agents, subtask
  IDs/specs/dependencies, maxConcurrency, write-intent patterns, and scope
  policy. Validate runs the side-effect-free Runtime validation first (cyclic,
  duplicate, unknown-Agent, unsafe-pattern, oversized, and malformed input is
  rejected before any record exists); Create is the explicit user action that
  persists the validated Runtime-owned record (Task Graph record plus journal
  event only — no Session, worktree, Bus handoff, process, or dispatch). After
  Create the drawer shows the side-effect-free Graph Preflight
  (`task.graph-plan` facts: frontier, selected wave, write-intent conflicts,
  intent coverage, scope policy, risks, and estimated resources). Missing
  Intent Map coverage stays distinct from an explicitly empty write intent.

Drawers support `Escape` to close and keep keyboard focus; the Context panel
and Sidebar collapse to drawers on narrow screens (≤ 1180 px and ≤ 1024 px
respectively).

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
- There is no authentication beyond the local per-launch capability, no remote
  access, no multi-tenant mode, no cloud sync, and no benchmark/evaluation
  dashboard. Workspace mutations are limited to the allow-listed actions above;
  process-launching, Session-input, stop, cleanup, integration, and review
  controls are always behind an explicit UI confirmation and never run on page
  load, reconnect, or refresh.
- `coordinate-agents web` requires an initialized Git repository root; the
  compatibility `inspector` command keeps its existing validation behavior.
