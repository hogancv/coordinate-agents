---
name: coordinate-task
description: >-
  Run a Coordinate Agents Task from requirement clarification through
  planning, implementation, review, and the human release gate. Hide Agent Bus
  transport details behind the durable Task API.
---

# Coordinate Task

Use this skill when the user asks Coordinate Agents to implement a feature,
fix a bug, or build an onboarding Todo web app. The Plugin bundles the Runtime;
let `<skill-dir>` be the absolute directory containing this `SKILL.md` and use
the one shared entry point instead of assuming a global npm bin:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" ...
```

Create a Task instead of manually composing Agent Bus `send`, `wait`, and
`state` calls:

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
timestamps, status, and last error. The normal path is:

```text
CREATED/PLANNING -> SPEC_READY -> IMPLEMENTING -> WAITING_IMPLEMENTER
-> REVIEWING -> APPROVED
```

`task dispatch` is the Plugin-facing workflow operation. It validates the
state and approved specification, resolves the workflow Implementer and its
effective command, checks the executable, sends `IMPLEMENT`, starts exactly
one activation, and maps failure to Task/Agent `ERROR`. It never creates a
second Planner or silently retries. A durable `IMPLEMENTATION_DONE` message
maps the Task to `REVIEWING`, including `implementationCommit` and evidence.

Review feedback may enter `CHANGES_REQUESTED`. A failed activation enters
`ERROR`; an explicit user `task resume` is required before another dispatch.
`CHANGES_REQUESTED` is dispatched explicitly with the preserved feedback,
current round, and previous commit/evidence reference. Use `task review` for
the Runtime decision operation:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task review \
  --root "<repository>" --id task-... --decision CHANGES_REQUESTED \
  --feedback "<concrete review findings>" --json
```

`REVIEW_APPROVED` changes Task status to `APPROVED`; it never authorizes
merge, push, tag, publish, deploy, or any other release action.
