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
