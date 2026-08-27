---
layout: default
title: Task Graph v1 Contract
description: Additive Task Graph input, identity facts, deterministic validation, and compatibility boundaries.
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

## Determinism and scope

Malformed graphs fail in a fixed validation order. Dependency checks and cycle
traversal use sorted identifiers, so equivalent invalid inputs produce stable,
bounded diagnostics. Graph creation, persistence, scheduling, worktrees,
parallel Sessions, integration, and cleanup are separate Runtime operations;
the v1 validation contract does not perform any of them and never authorizes a
merge, push, tag, publish, deploy, or release.
