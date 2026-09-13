---
name: coordinate-agents
description: Route requests that explicitly use Coordinate Agents or operate on its existing Tasks to setup, execution, review, or recovery skills.
---

# Coordinate Agents

Use this router for Coordinate Agents workflows. Ordinary repository edits do
not require this workflow or an external Implementer.

| Intent | Focused skill |
| --- | --- |
| Discover or configure implementation agents | `coordinate-setup` |
| Create, run, inspect, or stop a Task or Task Graph | `coordinate-task` |
| Review a Task implementation or integrated graph | `coordinate-review` |
| Diagnose and resume a failed or stale Task | `coordinate-recover` |

Load only the skill needed for the requested operation. For an active workflow,
use the configured Planner/Implementer/Reviewer roles; the formal Reviewer is
read-only. Resolve the project root from repository context before dispatch and
use Runtime validation of the configured executable, rather than guessing from
its role label.

## Invocation and boundaries

Use structured Coordinate Agents MCP tools. The Task API is the user-facing
surface; Agent Bus is the canonical durable transport. Do not make the user
manage queues or PTY endpoints, create a second Bus, or hand-edit queue files.

Only when MCP is unavailable or debugging is requested, let `<skill-dir>` be the
absolute directory containing this file and use:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" <command> ...
```

The fallback resolves the active payload to `bin/coordinate-agents.mjs`. Do not
silently retry a failed mutation through another transport. Runtime errors stop
the current activation; inspect facts before an authorized recovery. Classify
`AUTH_REQUIRED` only from an explicit authentication failure.

An explicit tool call is not a new user approval gate. Continue the authorized
workflow through relevant verification and review; reuse authorization within
its stated scope. Review approval alone does not authorize release. The exact
`RELEASE_APPROVED` token belongs only to the Coordinate Agents release protocol.

## Read only when needed

- Task Graph operations: [graph workflow](../coordinate-task/references/task-graph.md).
- Session diagnostics: [session runtime](references/session-runtime.md).
  Sessions own persistent PTYs; Tasks only reference `sessionId`. Never control
  unrelated processes or automate the Codex App Terminal UI.
- Adapter authoring or registration: [adapter workflow](references/adapter-workflow.md).
- Bus protocol debugging or the Task release protocol: [protocol](references/protocol.md).
- A specification needing a workflow template: [task templates](references/task-templates.md).
