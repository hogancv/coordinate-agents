---
name: coordinate-task
description: >-
  Create, execute, inspect, or stop Coordinate Agents Tasks when requested,
  or continue an existing Coordinate Agents Task.
---

# Coordinate Task

Use this skill when the user asks Coordinate Agents to implement a feature
or fix a bug. Use MCP tools for the normal workflow and do not make the user construct shell commands:

```text
coordinate_agents_task_create
coordinate_agents_task_dispatch
coordinate_agents_task_status
coordinate_agents_task_inspect
coordinate_agents_task_review
coordinate_agents_task_resume
coordinate_agents_task_stop
```

Only if MCP is unavailable, or if the user explicitly requests debugging, let
`<skill-dir>` be the absolute directory containing this `SKILL.md` and use
the bundled fallback. The following shell syntax is fallback/debug only, not
the normal Plugin path:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" ...
```

Create a Task only for new work; inspect and continue the existing Task otherwise.
For standalone Runtime compatibility or explicit
debugging, use the fallback syntax below; never expose Agent Bus `send`, `wait`,
or `state` operations to the user:

```text
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
`ERROR`; follow `coordinate-recover` before another dispatch. Existing explicit
authorization to repair and continue covers resume and the subsequent dispatch
within that scope.
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

## Completion and authorization

For an implementation request, continue through implementation, relevant
validation, review, and in-scope rework until the acceptance criteria pass.
For inspect, stop, or review-only requests, complete only that operation.
An approved specification means it is within the user's authorized scope;
resolve material ambiguity without imposing a separate approval for routine details.

“Explicit dispatch” means a deliberate coordinator tool call, not a fresh user
confirmation. A bounded graph call ending at integration or review is a tool
boundary: the coordinator continues with the appropriate authorized operation.
Use bounded calls and inspect current state while work is running; do not
redispatch running work or poll unchanged state tightly. Stop for a new material
decision, recovery outside existing authorization, or an unauthorized release.
If repeated rework makes no progress, report the concrete blocker rather than loop.

For dependency-aware Tasks, read [Task Graph workflow](references/task-graph.md).
For Session diagnostics, read [Session runtime](../coordinate-agents/references/session-runtime.md).
