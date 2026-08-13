---
name: coordinate-cli-agents
description: Coordinate Codex CLI and Antigravity CLI as two persistent roles through a shared project-local file bus. Use when either CLI is asked to quick-start collaborative mode, pair with the other CLI, initialize or resume `.agent-bus`, exchange implementation/review messages, wait for the peer, or run the Codex-plans-and-reviews / Antigravity-implements workflow.
---

# Coordinate CLI Agents

Enter a resumable two-CLI workflow in the current Git repository. Use the bundled cross-platform Node.js script for all bus operations; do not hand-edit queue files.

## Quick-start a new collaboration

When asked to set up the two terminals, run the package CLI rather than asking the user to copy long role prompts:

```sh
npx @hogancv/coordinate-cli-agents@latest quickstart --root "<repository-root>" --template feature --task "<task summary>"
```

Choose `bug`, `feature`, or `refactor`. The command initializes `.agent-bus`, writes role prompts, and prints one copyable launch command for each terminal. Read `references/task-templates.md` only when the user needs help structuring the task.

## Establish context

1. Resolve the repository root with `git rev-parse --show-toplevel`.
2. Infer the current role from the running CLI:
   - Codex CLI -> `codex`
   - Antigravity CLI / `agy` -> `antigravity`
3. If identity is genuinely ambiguous, ask only which role to assume.
4. Locate this skill directory and use `scripts/agent-bus.mjs` within it as `<bus-tool>`.
5. Initialize idempotently:

```sh
node "<bus-tool>" init --root "<repository-root>"
```

Initialization uses `.git/info/exclude` so runtime messages do not dirty the repository.

## Role contract

### Codex

- Own requirement clarification, specifications, acceptance criteria, review, release plans, approved release actions, and post-release checks.
- Never edit product source, tests, build configuration, or implementation files.
- Write specifications under `.agent-bus/specs/` and reviews under `.agent-bus/reviews/`.
- Send `IMPLEMENT` or `CHANGES_REQUESTED` to Antigravity.
- Review only real commits and validation evidence. Return `REVIEW_APPROVED` or `CHANGES_REQUESTED`.
- Require the literal user authorization `RELEASE_APPROVED` before merge, tag, push, deployment, or publication.

### Antigravity

- Be the sole implementation writer for source, tests, UI, configuration, migrations, and build fixes.
- Read Codex specifications and review feedback.
- Run applicable format, lint, typecheck, tests, production build, and browser validation.
- Commit each completed implementation round before reporting it.
- Write evidence under `.agent-bus/evidence/` and send `IMPLEMENTATION_DONE` with the commit hash.
- Never publish or release.

## Send and wait

Send messages atomically:

```sh
node "<bus-tool>" send --root "<repository-root>" --from codex --to antigravity --type IMPLEMENT --subject "Implement approved specification" --body-file "<spec-path>"
```

Add `--dedupe-key "<stable-round-id>"` whenever a send may be retried.

Wait without busy-spinning; the command claims the oldest message into `processing` and prints its absolute path:

```sh
node "<bus-tool>" wait --root "<repository-root>" --role codex --timeout-minutes 120 --poll-seconds 5
```

After processing, archive it:

```sh
node "<bus-tool>" complete --root "<repository-root>" --message-path "<message-path>"
```

Update only the current role's state:

```sh
node "<bus-tool>" state --root "<repository-root>" --role codex --state WAITING --details "Waiting for implementation"
```

Allowed states are `IDLE`, `CLARIFYING`, `SPEC_READY`, `IMPLEMENTING`, `WAITING`, `REVIEWING`, `CHANGES_REQUESTED`, `APPROVED`, `RELEASING`, `STOPPED`, and `ERROR`.

## Collaboration loop

### When invoked by Codex

1. Initialize the bus and inspect `status`.
2. Process any already queued Codex message before starting new work.
3. For a new user request, clarify only decisions that materially affect implementation.
4. Save an implementation-ready specification, send `IMPLEMENT`, set `WAITING`, then call `wait`.
5. On `IMPLEMENTATION_DONE`, verify the commit, clean worktree, diff scope, tests, build, and evidence.
6. Send `CHANGES_REQUESTED` and wait again, or send `REVIEW_APPROVED`.
7. Prepare the release plan and stop at the human release gate.

### When invoked by Antigravity

1. Initialize the bus and inspect `status`.
2. Call `wait` immediately if no queued message exists.
3. On `IMPLEMENT` or `CHANGES_REQUESTED`, archive the claimed message only after reading it successfully.
4. Implement, validate, commit, save evidence, send `IMPLEMENTATION_DONE`, set `WAITING`, and call `wait` again.
5. On `REVIEW_APPROVED`, stop modifying code, report sign-off, and remain available for the next task.
6. On `STOP`, ensure no uncommitted implementation remains, set `STOPPED`, and exit the loop.

## Waiting limitations and recovery

- A wait remains active only while the CLI session and its Node.js process remain alive.
- On timeout, preserve all state, report `TIMEOUT`, and resume with another `wait` when asked.
- After a terminal restart, invoke this skill again; inspect `status`, then process `new` and role-owned `processing` messages.
- Recover an expired claim only after checking for a matching commit, evidence, or reply: `recover --role <role> --stale-after-seconds 14400`.
- Never claim completion from prose alone. Require files, commits, and command evidence.
- Never let both roles perform Git write operations simultaneously.
- Treat `.agent-bus/` as plaintext: it may retain prompts, code excerpts, logs, paths, commit hashes, and host/process metadata. Never store credentials there. Read the protocol security section before sharing or cleaning it.

Read `references/protocol.md` only for message schema, recovery rules, or troubleshooting.
