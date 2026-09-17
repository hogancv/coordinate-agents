# Task Graph workflow

Read only for dependency-aware Coordinate Agents Tasks. The completion and
authorization boundaries in `../SKILL.md` also apply here.

For a dependency-aware run, validate the complete additive Task Graph v1
before creating or dispatching graph work. The validation operation is
read-only, requires explicit configured Implementer identities and bounded
`maxConcurrency`, and rejects duplicate/malformed IDs, missing or cyclic
dependencies, self-edges, empty specifications, and unconfigured Agents with
`TASK_GRAPH_INVALID`. It finishes before Bus, Adapter, worktree, Session, or
process side effects; existing single-Task operations remain unchanged. After
validation, `coordinate_agents_task_graph_create` (or `task graph-create`)
atomically persists the parent, subtasks, dependency frontier, reasons,
evidence, and lifecycle event without launching an Implementer. Use the
existing `task status`/`task inspect` operations, or the explicit
`task graph-status`/`task graph-inspect` aliases, to read the durable graph.
Use `coordinate_agents_task_graph_plan` (or `task graph-plan`) as a Graph
Preflight for deterministic dependency/capacity decisions, configured
Agent/Adapter/executable facts, scope policy, selected-wave Runtime resource
estimates, bounded risks, and explicit graph-run/review/release boundaries. If
Intent Map coverage is available, the plan greedily derives a stable
non-conflicting READY wave and bounded `WRITE_INTENT_CONFLICT` facts. Missing
coverage is `UNVERIFIED` and does not prove concurrent writes are safe.
Conflict deferral never rewrites `dependsOn`. Planning creates no worktree,
Bus message, Session, event, or process.
Use `coordinate_agents_task_graph_run` (or `task graph-run`) to execute the
current selected wave concurrently up to `maxConcurrency`. Each selected
subtask gets an isolated worktree, branch/ref, Bus message, and Runtime-owned
Session; the operation does not recursively launch work unlocked during the
same run. The graph lock rechecks write-intent compatibility against RUNNING
subtasks before any worktree, Session, or Implementer launch.
Use `coordinate_agents_task_graph_advance` (or `task graph-advance`) only with
an explicit `maxWaves` from 1–32. It re-plans before every wave and stops on
conflict, failure, blocked/stopped/running work, integration/review boundaries,
or the caller limit. It never recovers, retries, integrates, reviews, or releases.
To dispatch one ready subtask, use `coordinate_agents_task_graph_dispatch` (or
`task graph-dispatch --id <parentTaskId> --subtask <subtaskId>`), which executes
the subtask in an isolated Git worktree rooted at the exact graph base commit
without touching uncommitted user files, and updates the frontier upon completion.
If a coordinator or Session host is interrupted, use
`coordinate_agents_task_graph_recover` (or `task graph-recover`) to inspect
durable Session, worktree, commit, and evidence facts. It never infers success
from filenames or prose, replays verified side effects, or retries automatically.
Use `coordinate_agents_task_graph_resume` (or `task graph-resume`) only for an
explicit recovery decision: a healthy Runtime-owned Session/worktree is reused;
an exited or failed Session is returned to READY for a separate dispatch.
Use `coordinate_agents_task_graph_stop` and
`coordinate_agents_task_graph_cleanup` for bounded ownership-checked cleanup.
They preserve user worktrees, refs, commits, and evidence, record cleanup
failures, and are idempotent.
After all required subtasks are verified successful, use
`coordinate_agents_task_graph_integrate` (or `task graph-integrate`) to
create the separate aggregate review worktree and apply source commits in
deterministic subtask-id order. Use
`coordinate_agents_task_graph_review` (or `task graph-review`) to inspect
that aggregate and record `REVIEW_APPROVED` or `CHANGES_REQUESTED`.
Integration conflicts are durable and bounded; they do not modify the user
checkout or source worktrees and do not authorize release actions.
See `../../../docs/task-graph-v1.md` for the input shape and parent/subtask
identity facts.

When write-scope declarations are available, pass the optional `intentMap` to
creation: it must match the parent ID, cover each subtask once, and use normalized
repository-relative patterns. Empty `writeIntent` is explicit coverage; a missing
map is unavailable. Invalid maps stop creation before side effects.
With coverage, verified completion runs Scope Audit before enabling dependents:
`observe` records drift, `warn` preserves success with a warning, and `strict`
preserves the commit/worktree as a recoverable `INTENT_SCOPE_DRIFT` failure.
Missing coverage supplies no proof that concurrent writes are safe.
