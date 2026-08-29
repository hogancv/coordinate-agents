---
layout: default
title: Task Graph v1 Contract
description: Additive Task Graph input, deterministic execution, durable recovery, and ownership-safe cleanup.
---

# Task Graph v1 Contract

Task Graph v1 is an additive input contract over the canonical Coordinate
Agents Runtime. It does not reinterpret or replace schema-version-1 single
Tasks. The existing `task create`, `task dispatch`, `task status`, `task
inspect`, `task review`, `task resume`, and `task stop` operations keep their
current input and state semantics.

## Input

```json
{
  "schemaVersion": 1,
  "parentTask": {
    "id": "task-product-slice",
    "title": "Build the approved product slice",
    "planner": "codex",
    "reviewer": "codex"
  },
  "subtasks": [
    {
      "id": "backend",
      "implementer": "agent-backend",
      "spec": "Implement the approved backend changes.",
      "dependsOn": []
    },
    {
      "id": "frontend",
      "implementer": "agent-frontend",
      "spec": "Implement the approved frontend changes.",
      "dependsOn": ["backend"]
    }
  ],
  "maxConcurrency": 2
}
```

The parent uses the existing `task-*` identity format. Subtask identifiers are
scoped to that parent, use 1–64 lowercase alphanumeric, `_`, or `-` characters,
and start with a lowercase letter. A graph contains 1–256 subtasks;
`maxConcurrency` is an integer from 1–32. Every subtask has one explicit,
configured Implementer and a non-empty specification of at most 256 KiB. A
subtask may also carry an optional non-empty `title`. The parent Planner and
Reviewer identities are required; an existing parent `spec` and
`implementer` may be supplied as optional fields and, when supplied, must be
non-empty and configured. No Agent identity is inferred from an executable
name. The file-based CLI input is bounded to 64 MiB before JSON parsing.

The machine-readable input schema is
[`schemas/task-graph-v1.schema.json`](../schemas/task-graph-v1.schema.json).
Runtime validation additionally proves identifier uniqueness, configured Agent
membership, dependency existence, absence of self-edges and duplicate edges,
and acyclicity.

## Validation boundary

Use `coordinate_agents_task_graph_validate` through MCP, or the standalone
debugging command:

```sh
coordinate-agents task graph-validate --root <repository> --input <graph.json> --json
```

Validation runs before Agent Bus initialization or handoff, Adapter registry or
launch-plan resolution, worktree or Session creation, and process spawn. It is
read-only: success returns `validation.sideEffects: false`; failure returns the
stable non-recoverable `TASK_GRAPH_INVALID` Runtime error with stage
`graph-validation`.

The normalized result distinguishes the durable parent identity from every
subtask identity. Parent facts contain `kind: "parent-task"`, `taskId`, initial
`CREATED` state, and `maxConcurrency`. Subtask facts contain `kind: "subtask"`,
`parentTaskId`, `subtaskId`, exact Implementer identity, initial `PENDING`
state, and sorted dependency identifiers. Agent, Adapter, and executable
identities remain separate; graph validation never guesses or resolves an
executable.

## Durable graph create, status, and inspect

After validation, create the graph through the additive Runtime operation. The
CLI accepts the same bounded JSON input file:

```sh
coordinate-agents task graph-create --root <repository> --input <graph.json> --json
# equivalent nested form:
coordinate-agents task graph create --root <repository> --input <graph.json> --json
```

The MCP equivalent is `coordinate_agents_task_graph_create`. Creation writes
one atomic record at `.agent-bus/task-graphs/<parentTaskId>.json`; the record
contains the parent Task, every subtask, dependency edges, exact Implementer
assignments, timestamps, bounded `reason`/`evidence` fields, `maxConcurrency`,
and a deterministic `frontier`. It writes a `TASK_GRAPH_CREATED` Event Journal
entry and never resolves an Adapter, opens a Session, sends a Bus handoff, or
launches a child Implementer process.

The established `task status` and `task inspect` operations recognize a graph
parent ID without changing the single-Task response for ordinary Tasks. The
explicit aliases `task graph-status` and `task graph-inspect` are also
available. Status returns the graph and frontier; inspect adds bounded
append-only lifecycle events. A dependency-free subtask starts `READY`, a
subtask with unresolved dependencies starts `WAITING`, and a dependency whose
record is `FAILED`, `BLOCKED`, or `STOPPED` makes its dependents `BLOCKED` with
a deterministic reason. `TASK_GRAPH_SUBTASK_STATE_CHANGED` and
`TASK_GRAPH_STATUS_CHANGED` events record later durable transitions; repeated
identical transitions are idempotent.

## Read-only scheduling plan

Preview the next bounded scheduling decision without executing it:

```sh
coordinate-agents task graph-plan --root <repository> --id <parentTaskId> --json
# equivalent nested form:
coordinate-agents task graph plan <parentTaskId> --root <repository> --json
```

The MCP equivalent is `coordinate_agents_task_graph_plan`. The plan sorts all
subtasks by identifier, exposes the concurrency-eligible prefix and any
capacity-limited READY subtasks, and gives every decision a bounded reason plus
its dependency outcomes. Each decision carries the explicitly assigned Agent,
registered Adapter, effective configured command, and `project`, `user`, or
`adapter-default` command source. No fallback Agent is selected. Missing or
contradictory registry facts fail before execution.

Planning reads the persisted `maxConcurrency` and current RUNNING count. It is
idempotent: unchanged durable state produces the same plan and creates no
worktree, Bus message, Session, lifecycle event, or child process. The output
contract is `schemas/task-graph-v1-plan.schema.json`.

## Bounded parallel frontier execution

Execute the current eligible frontier concurrently:

```sh
coordinate-agents task graph-run --root <repository> --id <parentTaskId> --json
# equivalent nested form:
coordinate-agents task graph run <parentTaskId> --root <repository> --json
```

The MCP equivalent is `coordinate_agents_task_graph_run`; an optional
`sessionWaitMs` bounds the observation window for each selected subtask. The
Scheduler snapshots the deterministic plan once and launches only its eligible
prefix. Newly unlocked work is left READY for a later explicit run rather than
being launched recursively.

All selected subtasks share one exact graph base commit but use distinct
Runtime-owned worktree roots, branches/refs, Bus messages, and Session IDs.
The graph lock atomically checks both READY state and remaining concurrency
capacity, so concurrent callers cannot double-dispatch a subtask or exceed
`maxConcurrency`. Session records and events retain both `parentTaskId` and
`subtaskId`. Verified `IMPLEMENTATION_DONE` evidence unlocks dependents;
unresolved prerequisites remain WAITING, while a failed or stopped prerequisite
blocks only its downstream work. One selected failure is returned beside the
independent sibling outcomes and never triggers fallback or automatic retry.
The structured result contract is `schemas/task-graph-v1-run.schema.json`.

## Durable recovery, explicit resume, stop, and cleanup

`task graph-status` and `task graph-inspect` include a `recovery` array for
every subtask. Each entry is derived from the persisted graph state, the
parent/subtask/Agent identity, the Runtime-owned worktree path and branch, the
Session record, and verified completion evidence. A product filename or a
free-form message is never treated as proof of completion. The entry reports a
bounded classification such as `running`, `completed`, `completed-unverified`,
`interrupted`, `failed`, `stopped`, or `blocked`, plus `recoverable`,
`sessionHealthy`, and worktree ownership facts.

After a coordinator or Session host interruption, reconcile the durable facts
explicitly:

```sh
coordinate-agents task graph-recover --root <repository> --id <parentTaskId> --json
# one subtask only:
coordinate-agents task graph-recover --root <repository> --id <parentTaskId> --subtask <subtaskId> --json
# nested form:
coordinate-agents task graph recover <parentTaskId> [<subtaskId>] --root <repository> --json
```

The MCP operation is `coordinate_agents_task_graph_recover`. Recovery verifies
an existing `IMPLEMENTATION_DONE` message against the recorded worktree and
captured base commit. If the Session and worktree are not healthy, it records a
bounded `FAILED` transition with root, graph, subtask, Agent, Session, and
worktree facts. It never launches a replacement, replays a message, or retries
automatically. A verified completion is promoted to `SUCCEEDED`; no completion
inference is made from files or prose.

Resume is a separate, explicit operation and only clears the recovery gate:

```sh
coordinate-agents task graph-resume --root <repository> --id <parentTaskId> --subtask <subtaskId> --json
# nested form:
coordinate-agents task graph resume <parentTaskId> <subtaskId> --root <repository> --json
```

The MCP operation is `coordinate_agents_task_graph_resume`. A healthy,
Runtime-owned Session/worktree is reused without a second input or launch. An
exited or failed Session is marked for replacement and the selected subtask is
returned to `READY`; dispatch remains an explicit later
`task graph-dispatch`/`task graph-run` call. Dependents stay `BLOCKED` until
their failed prerequisite is explicitly resumed, then are deterministically
re-derived as `WAITING` or `READY`. Repeating resume is a no-op and never
enters an automatic retry loop.

Stop and cleanup are explicit and bounded:

```sh
coordinate-agents task graph-stop --root <repository> --id <parentTaskId> --reason "operator requested stop" --json
coordinate-agents task graph-cleanup --root <repository> --id <parentTaskId> --json
```

The MCP operations are `coordinate_agents_task_graph_stop` and
`coordinate_agents_task_graph_cleanup`; both accept an optional `subtaskId` and
bounded `timeoutMs`. Stop transitions active subtasks to `STOPPED`, closes only
matching Runtime-owned Sessions, and then removes only the exact
`.agent-bus/worktrees/<parentTaskId>/<subtaskId>` worktree after bounded
cleanup. Cleanup can be run independently for terminal subtasks; a still
`RUNNING` subtask is recorded as `SKIPPED` until it is explicitly stopped.
Unexpected paths, symlinks, unregistered worktrees, and Session ownership
mismatches are refused and recorded as bounded cleanup errors. Branches/refs,
successful implementation commits, evidence, and the user's checkout are
preserved even when cleanup is incomplete. Repeated recovery, resume, stop, and
cleanup calls are idempotent and do not duplicate messages, input, commits, or
worktrees. The shared output shape is
`schemas/task-graph-v1-recovery.schema.json`.

## Subtask dispatch in an isolated Git worktree

To execute one approved, dependency-ready subtask from a persisted graph, use
`coordinate_agents_task_graph_dispatch` through MCP or the CLI operation:

```sh
coordinate-agents task graph-dispatch --root <repository> --id <parentTaskId> --subtask <subtaskId> --json
# equivalent nested forms:
coordinate-agents task graph dispatch <parentTaskId> <subtaskId> --root <repository> --json
coordinate-agents task graph-dispatch <parentTaskId> <subtaskId> --root <repository> --json
```

Dispatching one subtask executes the canonical execution slice:
1. **Base Commit Capture**: Captures the exact HEAD commit SHA of the graph from the repository without staging, committing, resetting, or mutating the user's checked-out worktree or uncommitted files.
2. **Worktree Isolation**: Creates or reuses a Runtime-owned Git worktree at `.agent-bus/worktrees/<parentTaskId>/<subtaskId>` and branch `coordinate-agents/<parentTaskId>/<subtaskId>` (`refs/heads/coordinate-agents/<parentTaskId>/<subtaskId>`) rooted at the captured base commit. Symlinks, junctions, path escapes, and unsafe branch inputs are rejected.
3. **Agent & Adapter Resolution**: Resolves the configured Implementer using project > user > adapter-default configuration precedence with exact executable verification.
4. **Isolated Session Execution**: Opens or reuses a Runtime-owned persistent Session rooted strictly at the worktree directory. Sessions are scoped to the worktree path and never mixed across roots.
5. **Durable State & Frontier Updates**: On completion, records the implementation commit, bounded evidence, and transitions the subtask state to `SUCCEEDED` (or `FAILED` on non-zero exit/error without mutating sibling subtasks). Succeeded subtasks automatically unlock dependent subtasks in the graph frontier.

## Determinism and scope

Malformed graphs fail in a fixed validation order. Dependency checks and cycle
traversal use sorted identifiers, so equivalent invalid inputs produce stable,
bounded diagnostics. Graph creation, persistence, subtask dispatch, scheduling,
worktrees, parallel Sessions, integration, and cleanup are separate Runtime
operations; the v1 validation and dispatch contracts never authorize a merge,
push, tag, publish, deploy, or release.
