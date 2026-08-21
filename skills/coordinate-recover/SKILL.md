---
name: coordinate-recover
description: >-
  Diagnose and safely resume Coordinate Agents Tasks after executable failure,
  non-zero exit, timeout, stale claim, processing message, or Implementer
  ERROR. Recovery is explicit and never an automatic retry loop.
---

# Coordinate Recover

The Plugin bundles the Runtime. Let `<skill-dir>` be the absolute directory
containing this loaded `SKILL.md`; use the same resolver for every operation:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" ...
```

Start with machine-readable state:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task status --root "<repository>" --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" status --root "<repository>" --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" agent doctor --root "<repository>" --json
```

Inspect the Task's `lastError`, the bounded runtime artifact, Agent Bus state,
and any matching commit or evidence. Explain the concrete error code and the
smallest repair. Do not claim a missing capability as a successful result.

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
