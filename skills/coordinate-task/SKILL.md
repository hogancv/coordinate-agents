---
name: coordinate-task
description: >-
  Run a Coordinate Agents Task from requirement clarification through
  planning, implementation, review, and the human release gate. Hide Agent Bus
  transport details behind the durable Task API.
---

# Coordinate Task

Use this skill when the user asks Coordinate Agents to implement a feature,
fix a bug, or build an onboarding Todo web app. Create a Task instead of
manually composing `send`, `wait`, and `state` calls:

```text
coordinate-agents task create --root "<repository>" --title "<task>" --spec "<spec>" --json
coordinate-agents task status --root "<repository>" --id task-... --json
coordinate-agents task inspect --root "<repository>" --id task-... --json
coordinate-agents task resume --root "<repository>" --id task-... --json
coordinate-agents task stop --root "<repository>" --id task-... --reason "<reason>" --json
```

Task records are persisted under the project-local Agent Bus and contain the
Planner, Implementer, Reviewer, round, specification, commit, evidence,
timestamps, status, and last error. The normal path is:

```text
CREATED -> PLANNING -> SPEC_READY -> IMPLEMENTING -> WAITING_IMPLEMENTER
-> REVIEWING -> APPROVED
```

Review feedback may enter `CHANGES_REQUESTED`. A failed activation enters
`ERROR`; an explicit user `task resume` is required before another attempt.
Never poll or relaunch an errored Implementer automatically.
