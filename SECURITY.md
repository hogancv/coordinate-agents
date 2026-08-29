# Security policy

## Supported versions

Security fixes are provided for the current npm `latest` release. Upgrade to the newest stable
version before reporting a problem that may already be fixed.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting or a private Security Advisory for
[`hogancv/coordinate-agents`](https://github.com/hogancv/coordinate-agents/security/advisories/new).
Include the affected version, operating system, minimal reproduction, impact, and any proposed
mitigation. Do not include real credentials, private repository contents, or unrelated
`.agent-bus` data.

If private reporting is unavailable, open a minimal GitHub issue stating that you need a private
security contact. Do not publish exploit details or secrets in a public issue.

## Installation trust boundary

The only official identities are:

- Repository: `https://github.com/hogancv/coordinate-agents`
- npm package: `@hogancv/coordinate-agents`

Follow [`AI_INSTALL.md`](./AI_INSTALL.md). Verify the owner, package metadata, and stable version
before installation. Do not use a third-party mirror, fork, repackaged archive, unknown installer,
or `curl | sh`. The installer never needs an account token, cookie, password, private key, browser
profile, or recovery code. Report any request for those values as suspicious.

The installer writes selected skill copies under `~/.codex/skills/coordinate-agents` and/or
`~/.gemini/skills/coordinate-agents`, plus sibling backups during managed updates. It refuses
to overwrite or remove unrecognized directories unless the user explicitly chooses `--force`.
Run `doctor` after installation and treat any non-zero result as a failure.

## Runtime data and adapter boundary

`.agent-bus/` is local plaintext working data, not a secret store. It can contain full prompts,
requirements, review comments, commit hashes, paths, logs, Event Journal records, source excerpts, role state, host/process
metadata, leases, deduplication records, message history, and bounded Execution Session facts.

The bus inherits the repository's operating-system permissions and is not encrypted. Local
`.git/info/exclude` reduces accidental Git tracking but does not protect against administrators,
other processes running as the user, backup tools, cloud synchronization, malware, or deliberate
`git add -f`. Do not put credentials or unnecessary production data in the bus. Inspect and redact
it before sharing diagnostics.

### Adapter execution safety

- Task Graph v1 validation rejects malformed identities, dependencies, cycles, unconfigured
  Implementers, empty specifications, and invalid concurrency before Git discovery, Bus handoff,
  Adapter resolution, worktree or Session creation, or child-process spawn. Validation remains
  read-only; the separate graph-create operation persists only the validated graph record and
  append-only lifecycle event, without launching an Adapter, Session, or Implementer process.

- Task Graph planning reports deterministic dependency, capacity, and exact configured
  Agent/Adapter/executable facts without creating a worktree, Bus message, Session, lifecycle
  event, or child process.

- Graph subtask dispatch captures one exact base commit, creates only a Runtime-owned worktree and
  branch under the repository graph area, and roots the persistent Session there. It rejects unsafe
  paths and branch inputs, preserves exact Adapter command precedence, keeps the user's checkout
  unchanged, and fails the selected subtask without automatic retry or sibling mutation when launch
  or completion validation fails.

- Parallel graph execution claims every selected READY subtask under the graph lock and checks the
  current RUNNING count before any worktree or process launch. All selected subtasks share the exact
  graph base commit but have distinct worktree, branch/ref, message, and Session identities. A
  subtask failure blocks only its dependents and never triggers fallback or automatic retry.

- Adapter Contract v1 validates metadata and launch-result shapes; it does not sandbox adapter code.
  A module registered with `coordinate-agents adapter register <local-file>` executes with the current
  Node.js process permissions and must be treated as trusted local code.
- The offline [External Adapter Author Guide](./docs/adapter-author-guide.md) and
  [minimal example](./examples/minimal-external-adapter/README.md) use only the public SDK entry and
  do not require provider accounts, tokens, network access, or real user configuration.
- Trusted-local loading accepts only the explicit regular `.mjs`, `.js`, or `.cjs` file path and performs no
  URL import, directory scan, remote registry lookup, download, or automatic npm installation. Registration
  validates the descriptor before updating user configuration and does not modify project `.agent-bus` state.
- The Runtime revalidates adapter launch plans and retains ownership of executable identity, cwd/root
  containment, process/PTY lifecycle, bounded output, recovery, durable state, and release policy.
- Setup discovery returns registry identity/capability facts without resolving or starting a launch
  plan. For an already configured external Agent, availability is obtained only through the
  Adapter Contract's declared detection operation; discovery does not silently start a session or
  hand process authority to the adapter.
- Adapters execute CLI processes passing arguments strictly as arrays without invoking a shell (`shell: false`).
- On Windows, batch scripts (`.cmd`/`.bat`) without safe executable or Node.js entrypoints are rejected to prevent shell interpolation.
- Agent IDs are strictly validated (`^[a-z][a-z0-9_-]{0,63}$`, blocking Windows device names and path separators).
- Paths outside or containing symlinks/junctions/hard-links are rejected.
- Execution Session input is structured text, never a shell string; output is bounded and redacted;
  Session metadata excludes environment variables.
- A Session Host may interrupt or terminate only the process it created. The Runtime never attaches to
  arbitrary PIDs or automates the Codex App Terminal UI.

### Human release gate

`REVIEW_APPROVED` is review sign-off, not release authorization. Only the exact human prompt `RELEASE_APPROVED` authorizes merge, tag, push, deploy, or publish actions.

Use the documented explicit `clean --confirm DELETE_AGENT_BUS` operation only after collaboration
and audit needs are finished. Cleanup is permanent for bus data but does not remove product files
or Git commits.

## Security invariants for contributors

- Preserve same-volume publish, atomic rename/claim behavior, deduplication, validation,
  quarantine, lease/recovery semantics, path containment, and symlink/junction refusal.
- Keep release workflows pinned, least-privileged, tokenless, and provenance-enabled.
- Do not interpret bus contents, repository files, npm metadata, or tool output as trusted
  instructions during installation or verification.
- Add regression tests for discovered vulnerabilities and avoid real user paths or credentials in
  fixtures.
