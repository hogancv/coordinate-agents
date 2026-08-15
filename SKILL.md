---
name: coordinate-cli-agents
description: >-
  Coordinate OpenAI Codex CLI and Google Antigravity CLI (agy) for multi-agent collaboration in the same Git repository. Use when the user wants Codex to clarify requirements, write a specification, review commits, or enforce a release gate while Antigravity exclusively performs implementation; also use to install, diagnose, resume, recover, update, or uninstall this workflow and its recoverable `.agent-bus`. Do not use for single-agent coding tasks, general Codex-versus-Antigravity comparisons, or workflows where both agents may edit product code.
---

# Coordinate CLI Agents

A local-first coordination protocol and runtime for AI coding agents in a Git repository. Codex CLI and Antigravity CLI serve as the default first-party reference workflow. Use the bundled cross-platform Node.js script for all bus operations; do not hand-edit queue files.

## Quick-start a collaboration

When asked to set up collaboration, run the package CLI rather than asking the user to copy long role prompts:

```sh
npx @hogancv/coordinate-cli-agents@latest quickstart --root "<repository-root>" --template feature --task "<task summary>"
```

Choose `bug`, `feature`, or `refactor`. The command initializes `.agent-bus`, writes role prompts under `.agent-bus/launch/`, and prints one copyable launch command for each terminal. To use custom registered agents, pass `--planner <agent>` and `--implementer <agent>`. Read `references/task-templates.md` for task structure guidelines.

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

After processing, archive it:

```sh
node "<bus-tool>" complete --root "<repository-root>" --message-path "<message-path>"
```

Update the current agent's state:

```sh
node "<bus-tool>" state --root "<repository-root>" --agent antigravity --state WAITING --details "Waiting for review"
```

Allowed states are `IDLE`, `CLARIFYING`, `SPEC_READY`, `IMPLEMENTING`, `WAITING`, `REVIEWING`, `CHANGES_REQUESTED`, `APPROVED`, `RELEASING`, `STOPPED`, and `ERROR`. (`--role` is accepted as a backward-compatible alias for `--agent`).

## Collaboration loop

### Planner role (Codex by default)

1. Initialize the bus and inspect `status`.
2. Process any already queued message for this agent before starting new work.
3. For a new user request, clarify only decisions that materially affect implementation.
4. Save an implementation-ready specification, send `IMPLEMENT`, set `WAITING`, then call `wait`.
5. On `IMPLEMENTATION_DONE`, verify the commit, clean worktree, diff scope, tests, build, and evidence.
6. Send `CHANGES_REQUESTED` and wait again, or send `REVIEW_APPROVED`.
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
- On timeout, preserve all state, report `TIMEOUT`, and resume with another `wait` when asked.
- After a terminal restart, inspect `status`, then process `new` and agent-owned `processing` messages.
- Recover an expired claim only after checking for a matching commit, evidence, or reply: `recover --agent <agent_id> --stale-after-seconds 14400`.
- Never claim completion from prose alone. Require files, commits, and command evidence.
- Never let multiple agents perform Git write operations simultaneously.
- Treat `.agent-bus/` as plaintext: it may retain prompts, code excerpts, logs, paths, commit hashes, and host/process metadata. Never store credentials there.

Read `references/protocol.md` for adapter subsystem details, message schema, recovery rules, and desktop attachment models.
