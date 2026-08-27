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
See `../../docs/task-graph-v1.md` for the input shape and parent/subtask
identity facts.
