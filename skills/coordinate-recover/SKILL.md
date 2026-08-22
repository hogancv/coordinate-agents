---
name: coordinate-recover
description: >-
  Diagnose and safely resume Coordinate Agents Tasks after executable failure,
  non-zero exit, timeout, stale claim, processing message, or Implementer
  ERROR. Recovery is explicit and never an automatic retry loop.
---

# Coordinate Recover

Use `coordinate_agents_recover_inspect`,
`coordinate_agents_task_status`, and `coordinate_agents_task_resume` for
normal Plugin recovery. Recovery is facts-first and never an automatic retry.
If MCP is unavailable, or the user explicitly requests debugging, let
`<skill-dir>` be the absolute directory containing this loaded `SKILL.md` and
use the bundled fallback:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" ...
```

The normal Plugin path starts with `coordinate_agents_recover_inspect`, followed
by `coordinate_agents_task_status` or `coordinate_agents_task_resume` only when
the recovery decision requires them. The following commands are fallback/debug
syntax only:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task status --root "<repository>" --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" status --root "<repository>" --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" agent doctor --root "<repository>" --json
```

Inspect the Task's `lastError`, the bounded runtime artifact, Agent Bus state,
the `sessionId` Session status/inspect facts, and any matching commit or
evidence. Explain the concrete error code and the smallest repair. Session
inspection is read-only: do not restart, replay input, attach to a different
PID, or resume the Task while collecting facts. Do not claim a missing
capability as a successful result.

Only after the user explicitly asks to continue, invoke:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task resume --root "<repository>" --id task-... --json
```

`task resume` only clears the explicit recovery gate; it does not launch an
Implementer. After the user confirms the repair, use `task dispatch` so the
Task API performs executable validation, Bus handoff, launch, and state/error
propagation as one operation.

`TASK_NOT_FOUND`, `STALE_CLAIM`, `AGENT_EXIT_NONZERO`, `AGENT_TIMEOUT`, and
`AUTH_REQUIRED` remain facts to report; they do not authorize silent retries.
