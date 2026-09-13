# Repository instructions for AI contributors

This file governs development and maintenance **after an agent has entered this repository**. It
is not the installation entry point. For installation, read [`AI_INSTALL.md`](./AI_INSTALL.md).

## Canonical identity

- Repository: `https://github.com/hogancv/coordinate-agents`
- npm package: `@hogancv/coordinate-agents`
- Package source of truth: `package.json`

Do not rename, mirror, or substitute these identities. Never add credentials, tokens, cookies,
recovery codes, private keys, personal email addresses, or raw `.agent-bus` data to commits,
fixtures, logs, documentation, or release artifacts.

## Repository map

- `bin/coordinate-agents.mjs`: thin executable and compatibility export surface. Argument parsing
  lives in `lib/cli/`; top-level command execution lives in `lib/commands/`; shared
  legacy-compatible domain operations remain in `lib/cli-core.mjs` while they are incrementally
  extracted.
- `.codex-plugin/plugin.json`: Codex Plugin manifest.
- `skills/coordinate-agents/`: canonical self-contained Skill and runtime source (`SKILL.md`, `agents/`, `adapters/`, `references/`, `scripts/`). The Session implementation is `scripts/pty-runtime.mjs`, `scripts/session-host.mjs`, `scripts/session-manager.mjs`, and `scripts/session-service.mjs`; `references/session-runtime.md` is the detailed protocol reference.
- `scripts/`: repository development and release tooling (`demo.mjs`, `sync-llms.mjs`).
- `AI_INSTALL.md`: canonical safe installation procedure for AI assistants.
- `README.md` and `README.zh-CN.md`: user-facing English and Simplified Chinese documentation.
- `docs/`: GitHub Pages source for stable, evidence-focused task and FAQ pages. `docs/llms.txt`
  is the canonical machine index; `npm run sync:llms` generates the repository-root copy.
- `test/`: Node.js tests, including cross-platform CLI, protocol, docs, and release checks.
- `.github/workflows/`: pinned CI and trusted npm publishing workflows.

## Required checks

Choose validation for the changed surface:

- Run focused tests for behavior changes; use `npm run check` for shared core changes
  and `npm run check:full` when slower integration boundaries are affected.
- Run `npm ci` when dependencies changed or the installed environment is missing or stale.
- Run `npm run demo` when the demo flow changes, and
  `npm pack --dry-run --ignore-scripts` when package contents change.
- Validate changed Skill metadata with the installed skill-creator
  `scripts/quick_validate.py`; validate Plugin metadata with plugin-creator
  `scripts/validate_plugin.py` when that metadata changes.

Local tests use disposable fixtures and must not access production or live model
accounts. Run affected tests, fix failures caused by the requested change, and rerun
those tests without asking at each step. Once relevant checks pass, stop expanding
validation unless new evidence warrants it. Do not claim cross-platform success
from a single local run; report the environments actually verified.

## Change rules

1. Apply configured Planner/Implementer/Reviewer roles only within an explicitly
   selected Coordinate Agents workflow. Ordinary repository development may be
   completed directly by the current agent. The formal Reviewer remains read-only.
2. Keep the Execution Session boundary explicit: Task records may reference `sessionId`, but
   Session Manager owns persistent PTY lifecycle, reuse, bounded I/O, recovery facts, and cleanup.
   Never automate the Codex App Terminal UI or attach to an arbitrary process. A healthy Session is
   reused across review rework; exited/failed Sessions require an explicit dispatch path and never
   trigger an infinite retry loop.
3. Keep configured executable identity exact. Project command > user command > Adapter default;
   `antigravity` configured as `agy-proxy` must launch `agy-proxy`, not guessed `agy`. Fail fast when
   the final executable is missing, incompatible, or unrunnable, and include root/Agent/Session facts.
4. Keep filesystem operations cross-platform and safe for paths containing spaces and shell
   metacharacters. Do not introduce shell-string interpolation when argument arrays are possible.
5. Refuse symlinks, junctions, path escapes, unrecognized installs, and destructive recovery by
   default. Preserve atomic publication, deduplication, leases, quarantine, and explicit cleanup.
6. Add or update focused tests when needed to verify changed behavior. Tests must use isolated temporary
   repositories and must not invoke live model accounts or modify a user's real project.
7. Keep `SKILL.md` concise. Put detailed protocol or template material one level down in
   `references/` and link it directly from `SKILL.md`.
8. Update documentation that directly describes the changed behavior. Keep corresponding
   English and Simplified Chinese pages semantically synchronized when affected.
   Update `docs/llms.txt` only when its index changes; never edit generated root `llms.txt` directly.
9. If installation payload contents change, update `package.json` `files`, package tests, and the
   package version as appropriate. Keep `package-lock.json` synchronized.
10. Do not use third-party mirrors, mutable unknown scripts, `curl | sh`, or long-lived npm tokens
   in project automation.

## Distribution and release strategy

- **Primary distribution**: Codex Plugin directly from GitHub repository marketplace (`https://github.com/hogancv/coordinate-agents`).
- **Compatibility distribution**: npm package (`@hogancv/coordinate-agents`) supporting the CLI/runtime, Antigravity skill installer, and legacy standalone Codex skill installer.
- **Version independence**: `.codex-plugin/plugin.json` (Codex Plugin version) and `package.json` (npm package version) evolve independently and are synchronized when co-releasing.
- **Workflow status**: CI and automated publishing workflows are paused (`.github/workflows/` disabled). Releases are managed explicitly by maintainers.
- **npm publishing is strictly manual**: npm publishing is triggered exclusively through manual `workflow_dispatch` with mandatory `PUBLISH` confirmation. All automatic publish triggers (push tag, release published, push main) are forbidden.

## Release restrictions

- Passing review or CI is not release authorization.
- Never merge, tag, push, publish, deploy, create a GitHub Release, or run a release workflow
  unless the user has approved the described action. Reuse existing explicit authorization
  for that same plan. The exact text `RELEASE_APPROVED` is required only for a Task
  using the Coordinate Agents release protocol; do not impose it on ordinary development.
- Keep GitHub Actions pinned to full commit SHAs.
- npm publishing must use the existing environment-limited trusted publisher with OIDC and
  provenance; never introduce `NPM_TOKEN` or `NODE_AUTH_TOKEN`.
- Verify the anonymous npm tarball, npm integrity/provenance, GitHub Release target, clean worktree,
  and successful CI after publishing before reporting release completion.
