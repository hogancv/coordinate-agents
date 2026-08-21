---
name: coordinate-review
description: >-
  Review a Coordinate Agents implementation as the Codex Reviewer. Verify the
  real commit, diff, tests, validation evidence, and specification without
  modifying the Implementer's product code.
---

# Coordinate Review

The Plugin bundles the Runtime and does not require a global
`coordinate-agents` command. Let `<skill-dir>` be the absolute directory
containing this loaded `SKILL.md`:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" ...
```

Review only observable evidence tied to the current Task and repository:

1. Read `task inspect --json` and the approved specification.
2. Verify the implementation commit exists and inspect its diff.
3. Re-run the relevant tests and check the recorded validation evidence.
4. Compare every acceptance criterion and negative control.
5. Return exactly one decision: `REVIEW_APPROVED` or `CHANGES_REQUESTED`.
6. Record that decision through the Task API; never edit a task JSON file or
   manually send a Bus message:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task review \
  --root "<repository>" --id task-... --decision REVIEW_APPROVED --json
```

For changes, include concrete feedback. The Runtime preserves it and the next
explicit `task dispatch` includes it in the new `IMPLEMENT` activation.

The Reviewer does not edit product source, tests, or build configuration. It
does not merge, tag, push, publish, or pass the human release gate.
