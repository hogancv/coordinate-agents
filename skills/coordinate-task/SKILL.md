---
name: coordinate-task
description: >-
  Run a Coordinate Agents Task from requirement clarification through
  planning, implementation, review, and the human release gate. Hide Agent Bus
  transport details behind the durable Task API.
---

# Coordinate Task

Use this skill when the user asks Coordinate Agents to implement a feature,
fix a bug, or build an onboarding Todo web app. Use MCP tools for the normal
workflow and do not make the user construct shell commands:

```text
coordinate_agents_task_create
coordinate_agents_task_graph_validate
coordinate_agents_task_graph_create
coordinate_agents_task_graph_plan
coordinate_agents_task_graph_run
coordinate_agents_task_graph_advance
coordinate_agents_task_graph_dispatch
coordinate_agents_task_graph_recover
coordinate_agents_task_graph_resume
coordinate_agents_task_graph_stop
coordinate_agents_task_graph_cleanup
coordinate_agents_task_graph_integrate
coordinate_agents_task_graph_review
coordinate_agents_task_dispatch
coordinate_agents_task_status
coordinate_agents_task_inspect
coordinate_agents_task_resume
coordinate_agents_task_stop
```

For explicit Session diagnostics, use the bounded Session tools:

```text
coordinate_agents_session_open
coordinate_agents_session_status
coordinate_agents_session_inspect
coordinate_agents_session_write
coordinate_agents_session_read
coordinate_agents_session_close
```

Only if MCP is unavailable, or if the user explicitly requests debugging, let
`<skill-dir>` be the absolute directory containing this `SKILL.md` and use
the bundled fallback. The following shell syntax is fallback/debug only, not
the normal Plugin path:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" ...
```

The normal Plugin call is a structured `coordinate_agents_task_create` followed
by the other Task tools above. For standalone Runtime compatibility or explicit
debugging, use the fallback syntax below; never expose Agent Bus `send`, `wait`,
or `state` operations to the user:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task graph-validate --root "<repository>" --input "<graph.json>" --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task graph-create --root "<repository>" --input "<graph.json>" --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task graph-plan --root "<repository>" --id task-... --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task graph-run --root "<repository>" --id task-... --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task graph-advance --root "<repository>" --id task-... --max-waves 3 --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task graph-dispatch --root "<repository>" --id task-... --subtask <subtaskId> --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task graph-recover --root "<repository>" --id task-... --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task graph-resume --root "<repository>" --id task-... --subtask <subtaskId> --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task graph-stop --root "<repository>" --id task-... --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task graph-cleanup --root "<repository>" --id task-... --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task graph-integrate --root "<repository>" --id task-... --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task graph-review --root "<repository>" --id task-... --decision REVIEW_APPROVED --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task create --root "<repository>" --title "<task>" --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task dispatch --root "<repository>" --id task-... --spec "<approved specification>" --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task status --root "<repository>" --id task-... --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task inspect --root "<repository>" --id task-... --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task resume --root "<repository>" --id task-... --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task stop --root "<repository>" --id task-... --reason "<reason>" --json
```

Task records are persisted under the project-local Agent Bus and contain the
Planner, Implementer, Reviewer, round, specification, commit, evidence,
timestamps, status, last error, and a non-owning `sessionId` reference. The
normal path is:

```text
CREATED/PLANNING -> SPEC_READY -> IMPLEMENTING -> WAITING_IMPLEMENTER
-> REVIEWING -> APPROVED
```

`task dispatch` is the Plugin-facing workflow operation. It validates the
state and approved specification, resolves the workflow Implementer and its
effective command, checks the executable, sends `IMPLEMENT`, then opens or
reuses one healthy persistent Execution Session. The Task stores the returned
`sessionId` but does not own the process. If the adapter did not consume the
initial prompt as launch arguments, dispatch writes it to the Session. A
durable `IMPLEMENTATION_DONE` message maps the Task to `REVIEWING`, including
`implementationCommit` and evidence; otherwise a bounded activation remains
observable as `WAITING_IMPLEMENTER`.

Review feedback may enter `CHANGES_REQUESTED`. A failed activation enters
`ERROR`; an explicit user `task resume` is required before another dispatch.
`CHANGES_REQUESTED` is dispatched explicitly with the preserved feedback,
current round, and previous commit/evidence reference. A healthy matching
Session is reused for this rework; an exited/failed Session is replaced only
by that explicit dispatch. Use `task review` for
the Runtime decision operation:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task review \
  --root "<repository>" --id task-... --decision CHANGES_REQUESTED \
  --feedback "<concrete review findings>" --json
```

`REVIEW_APPROVED` changes Task status to `APPROVED`; it never authorizes
merge, push, tag, publish, deploy, or any other release action.

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
See `../../docs/task-graph-v1.md` for the input shape and parent/subtask
identity facts.
