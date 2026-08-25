---
layout: page
title: Plugin-first E2E workflow
description: Architecture audit, bundled Runtime resolution, Setup transaction, Task dispatch, state mapping, and Plugin-only acceptance gates.
---

# Plugin-first E2E workflow

This page records the implementation audit and the acceptance path for a user
who installs only the Codex Plugin. The Plugin is the product surface; the npm
CLI remains a standalone Runtime, compatibility, and debugging surface.

## Plugin-only Runtime and architecture audit

The current implementation has one canonical Runtime source:

| Surface | Actual implementation |
| --- | --- |
| Plugin manifest | `.codex-plugin/plugin.json`, with `skills: "./skills/"` |
| Five Skills | `coordinate-agents`, `coordinate-setup`, `coordinate-task`, `coordinate-review`, `coordinate-recover` |
| Canonical executable | `bin/coordinate-agents.mjs` |
| Plugin Skill resolver | `skills/coordinate-agents/scripts/runtime-entry.mjs` |
| Task persistence | `skills/coordinate-agents/scripts/task-runtime.mjs` under `.agent-bus/tasks/` |
| Execution Session | `skills/coordinate-agents/scripts/session-manager.mjs`, `session-service.mjs`, and `session-host.mjs` under `.agent-bus/sessions/` |
| PTY backend | `skills/coordinate-agents/scripts/pty-runtime.mjs`, preferring `node-pty` with bounded owned-stdio compatibility fallback |
| JSON contract | `skills/coordinate-agents/scripts/runtime-contract.mjs` |
| Machine configuration | `skills/coordinate-agents/scripts/user-config.mjs` at `~/.coordinate-agents/config.json` |
| Project orchestration | `.agent-bus/config.json`, inboxes, state, leases, and the existing Agent Bus scripts |
| Adapter registry | `skills/coordinate-agents/adapters/index.mjs`; public shape validation is frozen separately in Adapter Contract v1 |
| Task execution | `task dispatch` uses the Session Manager to validate, open/reuse, write, observe, and persist `sessionId`; legacy `launch` remains a compatibility path |
| npm payload | `package.json.files` includes `.codex-plugin`, `skills`, and `bin` |

The resolver is intentionally not a second Runtime. It starts the same
`bin/coordinate-agents.mjs` with `process.execPath` and an argument array. A
Plugin Skill uses:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" <command> ...
```

The active Skill supplies the concrete absolute directory. The resolver checks,
in order, the active Plugin ancestor, a canonical package resolution, a local
personal marketplace source, the Codex cached Git marketplace layout, and
known npm package roots. It never requires `coordinate-agents` to be on `PATH`.
The cached layout is expected to be equivalent to:

```text
<CODEX_HOME>/plugins/cache/<marketplace>/coordinate-agents/<version>/
├── .codex-plugin/plugin.json
├── bin/coordinate-agents.mjs
└── skills/
```

The resolver uses safe child-process argument arrays, so the Plugin path and
Implementer commands remain usable on Windows with spaces in the Plugin root,
absolute `.exe` paths, and `.cmd`/`.bat` wrappers. All five Skills use this one
invocation convention.

## Setup transaction

`coordinate-setup` separates discovery from configuration:

1. **Discover** reports executable facts and inferred Adapter candidates without
   mutating user or project configuration.
2. **Configure** accepts the chosen Agent identity and executable, infers a
   known Adapter where possible, and validates the Adapter contract. `generic-cli`
   is only `READY` when its argument template contains `{prompt}`; executable
   detection alone is not a compatibility claim.
3. The transaction writes the machine-specific command/args to
   `~/.coordinate-agents/config.json`, ensures the project Agent registration,
   assigns `workflow.implementer`, and leaves an absolute machine command out of
   `.agent-bus/config.json` unless the project already has an explicit override.
4. It runs the final Adapter compatibility and executable checks and returns a
   JSON `doctor.ok: true` result. Failure rolls back the configuration changes.

For example, choosing a custom Antigravity wrapper preserves the identity and
Adapter while selecting the wrapper as the executable:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" setup configure --agent antigravity --command agy-proxy --adapter antigravity-cli --root "<repository>" --json
```

The result contains `agent.id: "antigravity"`,
`agent.adapter: "antigravity-cli"`, `agent.command: "agy-proxy"`,
`agent.commandSource: "user"`, `project.registered: true`, and
`workflow.implementer: "antigravity"`.

## Task dispatch

Task creation remains separate from dispatch so Codex can hold a
conversation, clarify requirements, and approve a complete specification.
`task dispatch` owns the whole handoff:

```text
Task
  → validate state and non-empty specification
  → resolve workflow.implementer and Agent config
  → resolve Adapter and final command
  → executable check
  → Agent Bus IMPLEMENT message
  → Execution Session Manager open/reuse
  → one persistent PTY activation and bounded input/output
  → Task WAITING_IMPLEMENTER or REVIEWING
```

When the executable check fails, dispatch changes the Task to `ERROR`, records
the canonical `EXECUTABLE_NOT_FOUND`, records the Agent `ERROR` state when
possible, and does not send `IMPLEMENT` or start a child process. A non-zero
Implementer exit becomes `AGENT_EXIT_NONZERO`, preserves bounded output in the
existing error artifact, and stops the activation. There is no fallback, auto
retry, second Planner, or Autopilot.

An `IMPLEMENTATION_DONE` Bus message addressed to the Task Planner is promoted
by the Task Runtime into `implementationCommit`, bounded `evidence`,
`updatedAt`, and `REVIEWING`. The Bus remains durable transport; the Task is
the product-facing state source.

The Task stores the returned `sessionId` but does not own the process. A healthy
Session is keyed by repository root, Agent identity, and effective executable.
When review records `CHANGES_REQUESTED`, the next explicit dispatch writes the
new specification and feedback into the same healthy PTY context. An exited or
failed Session is a recovery fact; replacement happens only on an explicit
dispatch and never through an infinite retry loop. `recover inspect` reports
Session facts without restarting, replaying input, or controlling the Codex App
Terminal UI.

## Task state mapping

| Task status | Agent Bus / operation meaning |
| --- | --- |
| `CREATED` | Conversation/task record exists; no Implementer launch |
| `PLANNING` | Codex is still clarifying the requirement |
| `SPEC_READY` | Approved non-empty specification is persisted; dispatch is allowed |
| `IMPLEMENTING` | `IMPLEMENT` was sent and the bounded activation is running |
| `WAITING_IMPLEMENTER` | Activation ended without completion evidence; no automatic retry |
| `REVIEWING` | `IMPLEMENTATION_DONE` was synchronized with commit/evidence |
| `CHANGES_REQUESTED` | Review feedback is persisted and the next round is explicit |
| `APPROVED` | Review approved; this is not release authorization |
| `ERROR` | Executable, transport, spawn, or runtime failure; `lastError` is canonical |
| `STOPPED` | User/runtime stopped the Task; resume is explicit |

`CREATED`, `PLANNING`, `SPEC_READY`, and `CHANGES_REQUESTED` can dispatch.
`IMPLEMENTING` and `WAITING_IMPLEMENTER` reject another dispatch with
`TASK_ALREADY_RUNNING`; `APPROVED` rejects dispatch; `ERROR` requires
`task resume` before dispatch. `CHANGES_REQUESTED` increments `round`, and the
next `IMPLEMENT` includes the approved specification, feedback, round, and
previous commit/evidence reference.

`task review --decision REVIEW_APPROVED` maps `REVIEWING` to `APPROVED`.
`task review --decision CHANGES_REQUESTED --feedback "..."` maps it to
`CHANGES_REQUESTED` and sends the feedback through the Bus. Neither decision
authorizes push, merge, tag, publish, deploy, or any other release action;
the exact user gate `RELEASE_APPROVED` remains required.

## Plugin-only acceptance gates

The automated `test/plugin-e2e.test.mjs` fixture materializes a Plugin root in
a path containing spaces and runs with an empty executable `PATH`. It verifies:

- cached Plugin Runtime resolution and one-document JSON output;
- discovery-compatible `setup configure`;
- user config, project registration, Implementer assignment, and command precedence;
- `agy-proxy` → `antigravity` + `antigravity-cli` without falling back to `agy`;
- generic Adapter incompatibility as `UNSUPPORTED_CAPABILITY`;
- Task create → dispatch → `IMPLEMENT` → fixture completion → `REVIEWING`;
- `CHANGES_REQUESTED` round increment and explicit redispatch;
- `REVIEW_APPROVED` → `APPROVED` and release-gate separation;
- missing executable failure without Bus handoff or launch;
- non-zero fixture exit as `AGENT_EXIT_NONZERO`, Task/Agent `ERROR`, and explicit resume.
- Session open/status/inspect/write/read/close, bounded output, root/Agent isolation, and same-Session review rework.

The same fixture covers Windows `.cmd` wrappers and POSIX executable wrappers
according to the host platform. No MCP server, lifecycle Hook, Autopilot,
parallel Implementer, external daemon, database, Codex Terminal UI automation,
or third-party adapter loading is needed for this closure. Separately, trusted
local Contract v1 modules may now be loaded only through an explicit
`adapter register <local-file>` operation; that path is not part of this
historical built-in fixture. The three built-in adapters are created through
their public Contract v1 descriptors and pass the same deterministic
conformance runner used by external adapters. The Runtime continues to own
executable, process, Session, Task, and release behavior; the Session Host
exists only after an explicit Task/Session operation.
