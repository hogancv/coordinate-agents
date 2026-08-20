---
name: coordinate-agents
description: >-
  Coordinate multiple AI coding agents in the same Git repository through a
  local-first, recoverable Agent Bus. Use for structured multi-agent workflows,
  role-based planning, implementation and review, durable handoffs, recovery,
  adapter-backed agent execution, and human-gated releases. Codex CLI and
  Google Antigravity CLI are the default first-party reference adapters.
  Do not use for ordinary single-agent tasks or unsafe concurrent writes to the
  same worktree.
---

# Coordinate Agents

A local-first coordination protocol and runtime for AI coding agents in a Git repository. Codex CLI and Antigravity CLI serve as the default first-party reference adapters and reference workflow. Use the bundled cross-platform Node.js script for all bus operations; do not hand-edit queue files.

## Quick-start a collaboration

When asked to set up collaboration, run the package CLI rather than asking the user to copy long role prompts:

```sh
npx @hogancv/coordinate-agents@latest quickstart --root "<repository-root>" --template feature --task "<task summary>"
```

Choose `bug`, `feature`, or `refactor`. The command initializes `.agent-bus`, writes role prompts under `.agent-bus/launch/`, and prints one copyable launch command for each terminal. To use custom registered agents, pass `--planner <agent>`, `--implementer <agent>`, or `--reviewer <agent>`. Read `references/task-templates.md` for task structure guidelines.

Launch lifecycle is Adapter-driven. The Codex reference adapter is one-shot; the Antigravity reference adapter is bus-supervised and keeps the parent `launch` process waiting between clean `agy` activations. The supervisor only observes queue/state changes and never claims messages. Stop it with Ctrl+C or a processed `STOP` message that records `STOPPED`; use `launch --once` only when one activation is intentionally required.

## Use from Codex App

When this Skill is invoked directly in Codex App, prefer the current App project instead of asking
the user to open two separate CLI windows or paste two launch commands:

1. Resolve the active project root with `git rev-parse --show-toplevel` and confirm it is the
   repository the user added to Codex App.
2. Initialize or inspect `.agent-bus` in that project and keep the current Codex App thread as
   Planner/Reviewer.
3. Start the configured Implementer through the runtime as a local child process; do not require a
   second manually opened Codex or Antigravity window.
4. Before launching, verify that the configured execution command is the actual local executable,
   such as `agy` or `claude`, rather than a role label or an unavailable alias.

The App workflow still requires the Implementer CLI and its dependencies to be installed locally.
The project path must be the Git repository root, and the command must be resolvable from the same
machine. Use the CLI quickstart and its two printed terminal commands only as a fallback for
automation or hosts that do not provide direct Codex App Skill execution.

## Executable configuration and fail-fast behavior

The final executable is resolved in this order:

1. an explicit `command` in the project agent record in `.agent-bus/config.json`;
2. the user-level command in `~/.coordinate-agents/config.json`;
3. the Adapter default (`codex` for `codex-cli`, `agy` for `antigravity-cli`).

User configuration is outside the installed Skill/Plugin and survives Skill, Plugin, and npm
updates. Configure it without editing the installed Skill:

```sh
npx @hogancv/coordinate-agents config set agent.antigravity.command agy-proxy
npx @hogancv/coordinate-agents config get agent.antigravity.command
npx @hogancv/coordinate-agents config list
```

For a non-reference CLI such as Claude Code, inspect the installed command's own `--help` output
first, register it with `generic-cli`, and save only verified argument templates. The supported
placeholders are `{prompt}`, `{root}`, `{agent}`, and `{lang}`; the runtime already sets the project
root as the child process working directory, so do not assume a vendor-specific `--dir` flag.

The `antigravity-cli` Adapter passes configured `args` and then appends only
`--prompt-interactive <prompt>`. It does not infer or add a full-permission/sandbox-bypass flag. If
the user explicitly requests one and `agy --help` confirms the exact flag, configure it explicitly
with `config set agent.antigravity.args`; otherwise preserve the local CLI's native configuration.

Before launch, Runtime checks the resolved executable itself. It does not probe login state,
provider health, or model availability. A missing, non-executable, or unsafe entrypoint sets the
Implementer to `ERROR`, records a bounded error artifact, and stops before starting the CLI.
After launch, spawn failures, Adapter launch failures, non-zero child exits, and runtime errors
also set `ERROR`, preserve only bounded stdout/stderr tails, and terminate the current activation.
An explicit command is fail-closed: Runtime never silently falls back to `agy` or another Adapter
default when that command is unavailable.

## Establish context

1. Resolve the repository root with `git rev-parse --show-toplevel`.
2. Infer the current agent identity from the running environment:
   - Codex CLI -> `codex`
   - Antigravity CLI / `agy` -> `antigravity`
   - Registered third-party agent -> `<agent_id>`
3. If identity is genuinely ambiguous, ask which agent identity or workflow role to assume.
4. Locate this skill directory and use `scripts/agent-bus.mjs` within it as `<bus-tool>`.
5. Initialize idempotently:

```sh
node "<bus-tool>" init --root "<repository-root>"
```

Initialization creates `.agent-bus/config.json` with registered agents and excludes `.agent-bus/` via `.git/info/exclude`.

## Workflow roles and default reference mapping

Workflow responsibilities are separated from Agent Identity:
- **Planner**: owns requirement clarification, specifications, acceptance criteria, review, release plans, and the release gate. Default: `codex`.
- **Implementer**: sole writer for product source, tests, UI, configuration, and build fixes. Default: `antigravity`.
- **Reviewer**: reviews real commits and validation evidence against specifications. Default: `codex`.

### Planner / Reviewer contract

- Clarify requirements, write specifications under `.agent-bus/specs/`, and reviews under `.agent-bus/reviews/`.
- Never edit product source, tests, build configuration, or implementation files.
- Send `IMPLEMENT` or `CHANGES_REQUESTED` to the implementer.
- Review only real commits and validation evidence. Return `REVIEW_APPROVED` or `CHANGES_REQUESTED`.
- Require the literal user authorization `RELEASE_APPROVED` before merge, tag, push, deployment, or publication.

### Implementer contract

- Be the sole implementation writer for source, tests, UI, configuration, migrations, and build fixes.
- Read specifications and review feedback.
- Run applicable format, lint, typecheck, tests, production build, and browser validation.
- Commit each completed implementation round before reporting it.
- Write evidence under `.agent-bus/evidence/` and send `IMPLEMENTATION_DONE` with the commit hash.
- Never publish or release.

## Send, wait, and state management

Send messages atomically to any registered agent:

```sh
node "<bus-tool>" send --root "<repository-root>" --from codex --to antigravity --type IMPLEMENT --subject "Implement approved specification" --body-file "<spec-path>"
```

Add `--dedupe-key "<stable-round-id>"` whenever a send may be retried.

Wait without busy-spinning; the command claims the oldest message into `processing` and prints its absolute path:

```sh
node "<bus-tool>" wait --root "<repository-root>" --agent antigravity --timeout-minutes 120 --poll-seconds 5
```

For a Planner or Reviewer wait, the bus also observes the configured Implementer state. If it
becomes `ERROR`, `wait` exits with an error instead of continuing until its normal timeout.

After processing, archive it:

```sh
node "<bus-tool>" complete --root "<repository-root>" --message-path "<message-path>"
```

Update the current agent's state:

```sh
node "<bus-tool>" state --root "<repository-root>" --agent antigravity --state WAITING --details "Waiting for review"
```

Allowed states are `IDLE`, `CLARIFYING`, `SPEC_READY`, `IMPLEMENTING`, `WAITING`, `REVIEWING`, `CHANGES_REQUESTED`, `APPROVED`, `RELEASING`, `STOPPED`, and `ERROR`.

## Collaboration loop

### Planner role (Codex by default)

1. Initialize the bus and inspect `status`.
2. Process any already queued message for this agent before starting new work.
3. For a new user request, clarify only decisions that materially affect implementation.
4. Save an implementation-ready specification, send `IMPLEMENT`, set `WAITING`, then call `wait`.
5. On `IMPLEMENTATION_DONE`, verify the commit, clean worktree, diff scope, tests, build, and evidence.
6. If the Implementer state is `ERROR`, or Runtime reports an executable, launch, spawn, non-zero-exit, or conversation failure, stop `wait` immediately. Do not send another `IMPLEMENT`, do not poll indefinitely, and do not automatically retry or recover. Tell the user the Agent, Adapter, configured command, error code, and suggested fix; continue only after the user fixes the environment or explicitly requests a retry.
7. Send `CHANGES_REQUESTED` and wait again, or send `REVIEW_APPROVED`.
7. Prepare the release plan and stop at the human release gate.

### Implementer role (Antigravity by default)

1. Initialize the bus and inspect `status`.
2. Call `wait` immediately if no queued message exists.
3. On `IMPLEMENT` or `CHANGES_REQUESTED`, archive the claimed message only after reading it successfully.
4. Implement, validate, commit, save evidence, send `IMPLEMENTATION_DONE`, set `WAITING`, and call `wait` again.
5. On `REVIEW_APPROVED`, stop modifying code, report sign-off, and remain available for the next task.
6. On `STOP`, ensure no uncommitted implementation remains, set `STOPPED`, and exit the loop.

## Waiting limitations and recovery

- A wait remains active only while the CLI session and its Node.js process remain alive.
- A bus-supervised launch remains active after a clean Agent exit and wakes for any valid `new` or Agent-owned `processing` work. Non-zero exits terminate supervision instead of restarting.
- `ERROR` is terminal for the current activation. Never continue polling indefinitely after an Implementer runtime failure. A later launch is an explicit user retry, not an automatic retry.
- On timeout, preserve all state, report `TIMEOUT`, and resume with another `wait` when asked.
- After a terminal restart, inspect `status`, then process `new` and agent-owned `processing` messages.
- Recover an expired claim only after checking for a matching commit, evidence, or reply: `recover --agent <agent_id> --stale-after-seconds 14400`.
- Never claim completion from prose alone. Require files, commits, and command evidence.
- Never let multiple agents perform Git write operations simultaneously.
- Treat `.agent-bus/` as plaintext: it may retain prompts, code excerpts, logs, paths, commit hashes, and host/process metadata. Never store credentials there.

Read `references/protocol.md` for adapter subsystem details, message schema, recovery rules, and desktop attachment models.
