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

### Optional Intent Map v1 companion

Graph creation may receive a separate Intent Map without changing the Task
Graph v1 input schema:

```json
{
  "schemaVersion": 1,
  "parentTaskId": "task-product-slice",
  "scopePolicy": "warn",
  "subtasks": [
    { "id": "backend", "writeIntent": ["src/server/**"] },
    { "id": "frontend", "writeIntent": [] }
  ]
}
```

Use `--intent-map <intent-map.json>` beside CLI `--input`, or pass `intentMap`
to `coordinate_agents_task_graph_create`. `scopePolicy` is `observe`, `warn`,
or `strict` and defaults to `warn`. Every graph subtask must appear exactly
once. `writeIntent` may be empty; that is explicit empty coverage rather than
missing information. Patterns are bounded repository-relative path/glob data.
The Runtime normalizes backslash separators, repeated separators, and dot
segments, then sorts declarations and patterns deterministically.

Unknown, missing, or duplicate subtask declarations; duplicate normalized
patterns; absolute POSIX, UNC, drive-absolute, or drive-relative paths;
parent-directory escapes; control characters; negation; unsupported policies;
and oversized input fail with `TASK_GRAPH_INVALID` at
`intent-map-validation` before Agent Bus initialization or any worktree,
message, Adapter, Session, or process side effect. The normalized map is
published in the same graph record and graph lock transaction. Persisted maps
are revalidated on read; legacy records without a map remain valid.

Status, inspect, and plan return additive `intentCoverage` facts.
`available: false` and `writeIntent: null` mean no companion map exists;
`coverage: "explicit-empty"` and `writeIntent: []` mean the subtask was
deliberately declared with no write pattern. Intent Map v1 is declaration and
visibility input for conflict-aware scheduling and post-execution Scope Audit
v1.

After `IMPLEMENTATION_DONE` evidence and its implementation commit are
verified, but before dependent eligibility is derived, Scope Audit v1 compares
the graph base to that commit and also inspects staged, unstaged, and untracked
worktree changes. Additions, modifications, deletions, copies, and both sides
of renames are matched against the subtask's normalized `writeIntent`.
Evidence is persisted on the subtask with parent/subtask identity, both
commits, declared patterns, actual and outside-intent paths, change counts,
truncation flags, dirty-worktree availability, policy, and bounded
`INTENT_SCOPE_DRIFT` details. Git output is NUL-delimited and argument-vector
based, so spaces and shell metacharacters do not become shell input. An audit
that cannot inspect its required facts fails closed at `scope-audit`.

Policy behavior is additive: `observe` records findings without changing a
verified success; `warn` keeps success and adds a visible warning; `strict`
records a recoverable `INTENT_SCOPE_DRIFT` failure before prerequisites become
eligible, while preserving the implementation commit and Runtime-owned
worktree. Explicit empty `writeIntent` audits every actual write as outside
scope. A legacy graph with no Intent Map performs no audit and stores no
invented scope evidence. Scope Audit never checks out, resets, retries, removes
work, mutates the user checkout, or changes dependency edges.

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

## Read-only Graph Preflight

Preview the next bounded scheduling decision without executing it:

```sh
coordinate-agents task graph-plan --root <repository> --id <parentTaskId> --json
# equivalent nested form:
coordinate-agents task graph plan <parentTaskId> --root <repository> --json
```

The MCP equivalent is `coordinate_agents_task_graph_plan`. This additive Graph
Preflight preserves every v2.3 plan field, sorts all subtasks by identifier,
and derives one deterministic READY wave. Without an
Intent Map it preserves the v2.3 concurrency-eligible prefix and visibly marks
intent coverage unavailable. Its `concurrentWriteSafety` is `UNVERIFIED` and a
bounded `INTENT_COVERAGE_UNAVAILABLE` risk explicitly says that the selected
wave is not proof of safe concurrent writes. With a map it greedily selects non-conflicting
READY subtasks up to capacity. A normalized literal-prefix mismatch proves two
patterns disjoint; once glob syntax prevents proof, intersection is treated
conservatively. A later conflicting subtask is returned in `conflictDeferred`
with a bounded `WRITE_INTENT_CONFLICT` fact naming both subtasks and the first
relevant normalized pattern pair. Capacity-limited and dependency decisions
remain separate. Each decision carries the explicitly assigned Agent,
registered Adapter, effective configured command, and `project`, `user`, or
`adapter-default` command source. No fallback Agent is selected. Missing or
contradictory registry facts fail before execution.

Planning reads one graph snapshot under the existing graph lock, including the
persisted `maxConcurrency`, current RUNNING count, and normalized Intent Map.
Execution uses the same wave derivation and rechecks the claim under that lock.
The additive `preflight` object reports the effective scope policy, selected-wave
worktree, branch, Bus message, Session, and process estimates, plus at most
three bounded risk summaries. Its boundary facts state that planning does not
change dependencies, dispatch an Agent, authorize review or release, or replace
the explicit `graph-run` operation and exact human `RELEASE_APPROVED` gate.

Planning is idempotent: unchanged durable state produces the same plan and creates no
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
Scheduler snapshots the deterministic plan once and launches only its selected
wave. Newly unlocked work is left READY for a later explicit run rather than
being launched recursively.

All selected subtasks share one exact graph base commit but use distinct
Runtime-owned worktree roots, branches/refs, Bus messages, and Session IDs.
The graph lock atomically checks both READY state and remaining concurrency
capacity, so concurrent callers cannot double-dispatch a subtask or exceed
`maxConcurrency`. When an Intent Map exists, the same locked claim also rejects
a selected subtask that conflicts with a currently RUNNING subtask before any
worktree, Bus message, Adapter, Session, or Implementer launch. Conflict
constraints never add, remove, or infer a dependency edge, never mutate a
sibling, and never trigger fallback or automatic retry. Session records and
events retain both `parentTaskId` and
`subtaskId`. Verified `IMPLEMENTATION_DONE` evidence unlocks dependents;
unresolved prerequisites remain WAITING, while a failed or stopped prerequisite
blocks only its downstream work. One selected failure is returned beside the
independent sibling outcomes and never triggers fallback or automatic retry.
The structured result contract is `schemas/task-graph-v1-run.schema.json`.

## Explicit bounded multi-wave advance

Move through a caller-authorized number of freshly planned waves:

```sh
coordinate-agents task graph-advance --root <repository> --id <parentTaskId> --max-waves 3 --json
# equivalent nested form:
coordinate-agents task graph advance <parentTaskId> --root <repository> --max-waves 3 --json
```

The MCP equivalent is `coordinate_agents_task_graph_advance`. `maxWaves` is a
required integer from 1–32. Before each wave, advance reads a fresh Graph
Preflight and uses that exact plan through the existing graph-run claim path;
the graph lock still rechecks READY state, capacity, and write-intent safety.
The result contains each executed plan, selected subtask IDs, bounded outcomes,
wave summary, final graph/frontier, and an explicit stop code.

Advance stops before dispatch when Preflight reports a write-intent conflict.
It stops after a wave when an outcome fails or remains RUNNING after the bounded
observation window. Existing failed, blocked, stopped, or RUNNING work,
integration failure/conflict, and `CHANGES_REQUESTED` also stop progress rather
than invoking recovery or retry. Reaching the caller limit returns
`MAX_WAVES_REACHED`; all successful subtasks return `COMPLETED`. A completed
repeat executes zero waves. The operation never rewrites dependencies,
recursively dispatches, retries, integrates, reviews, changes the user checkout,
or authorizes merge, push, tag, publish, deploy, or release. The structured
contract is `schemas/task-graph-v1-advance.schema.json`.

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

## Deterministic integration and aggregate review

After every required subtask is SUCCEEDED, integrate the verified
IMPLEMENTATION_DONE commits explicitly:

```sh
coordinate-agents task graph-integrate --root <repository> --id <parentTaskId> --json
# equivalent nested form:
coordinate-agents task graph integrate <parentTaskId> --root <repository> --json
```

The MCP equivalent is coordinate_agents_task_graph_integrate. Integration
refuses any graph with an unresolved, failed, stopped, or unverified subtask.
It captures one base commit, sorts source subtasks by identifier, verifies the
exact Runtime branch/ref and commit reachability, then cherry-picks the
verified commits into the separate Runtime-owned
.agent-bus/worktrees/<parentTaskId>/__integration__ worktree and
coordinate-agents/<parentTaskId>/__integration__ branch. The current user
checkout, subtask worktrees, source branches, and source commits are not
modified.

The integration record is part of the atomic graph record and retains the
base, source fingerprint, ordered source refs, applied refs and aggregate
commit. A conflict is a bounded structured failure that leaves the aggregate
worktree and Git conflict state inspectable; it never silently resolves,
retries, resets, or deletes source work. graph-status reports the durable
integration record, while graph-inspect additionally probes the aggregate
worktree and aggregate diff. The result contract is
schemas/task-graph-v1-integrate.schema.json.

Send the aggregate through the existing reviewer boundary explicitly:

```sh
coordinate-agents task graph-review --root <repository> --id <parentTaskId> \
  --decision REVIEW_APPROVED --json
# or:
coordinate-agents task graph-review --root <repository> --id <parentTaskId> \
  --decision CHANGES_REQUESTED --feedback "Bounded review notes" --json
```

The MCP equivalent is coordinate_agents_task_graph_review; task review also
recognizes a persisted graph parent ID. The reviewer rechecks the subtask
evidence/refs, exact integration source fingerprint, aggregate HEAD, and the
Runtime-owned aggregate worktree before recording REVIEW_APPROVED or
CHANGES_REQUESTED with bounded evidence. A stale-source or dirty aggregate is
refused.
REVIEW_APPROVED changes only the durable graph/review state: it is not merge,
push, tag, release, deploy, or publish authorization. Integration cleanup is
explicit through graph-cleanup or an unscoped graph-stop; it removes only the
Runtime-owned aggregate worktree and retains the integration branch, commits,
conflict facts, and review evidence.

## Repository acceptance gate

The repository acceptance gate exercises one complete deterministic graph from
creation and read-only planning through bounded parallel execution, dependency
unlocking, integration, explicit review, and ownership-safe cleanup. Every
subtask must produce an isolated worktree, Runtime-owned Session, implementation
commit, and matching evidence. The fixture also keeps tracked and untracked user
changes in the checked-out worktree unchanged at every major stage.

Focused negative controls cover malformed DAGs and Agent assignments, unsafe
paths and refs, symlink or junction boundaries, missing executables, Session and
dependency failures, cleanup ownership failures, stale integration sources,
cherry-pick conflicts, and dirty or stale aggregate review. CLI and MCP calls
must expose the same durable graph facts; MCP stdio remains JSON-RPC-pure and
returns domain failures through structured content rather than protocol errors.

Run the local gate from a clean checkout:

```sh
npm ci
npm run check
npm run demo
npm pack --dry-run
```

The authoritative matrix is defined in
`.github/workflows/adapter-sdk-acceptance.yml`. It runs the complete regression
suite on Windows, macOS, and Linux with Node.js 18 and Node.js 22 when the package
version changes; version tags and explicit manual dispatches remain available. Local results
prove only the current host. Passing the gate or recording `REVIEW_APPROVED`
does not authorize merge, push, tag, publish, deploy, or release.

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
