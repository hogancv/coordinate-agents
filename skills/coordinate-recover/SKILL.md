---
name: coordinate-recover
description: >-
  Diagnose and safely resume Coordinate Agents Tasks after executable failure,
  non-zero exit, timeout, stale claim, processing message, or Implementer
  ERROR. Recovery is explicit and never an automatic retry loop.
---

# Coordinate Recover

Start with machine-readable state:

```text
coordinate-agents task status --root "<repository>" --json
coordinate-agents status --root "<repository>" --json
coordinate-agents agent doctor --root "<repository>" --json
```

Inspect the Task's `lastError`, the bounded runtime artifact, Agent Bus state,
and any matching commit or evidence. Explain the concrete error code and the
smallest repair. Do not claim a missing capability as a successful result.

Only after the user explicitly asks to continue, invoke:

```text
coordinate-agents task resume --root "<repository>" --id task-... --json
```

`TASK_NOT_FOUND`, `STALE_CLAIM`, `AGENT_EXIT_NONZERO`, `AGENT_TIMEOUT`, and
`AUTH_REQUIRED` remain facts to report; they do not authorize silent retries.

