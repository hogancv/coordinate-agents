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

- `bin/coordinate-agents.mjs`: installer, updater, doctor, quickstart, launch, agent management, and uninstall CLI.
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

Run all of these before proposing a commit:

```sh
npm ci
npm run check
npm run demo
npm pack --dry-run
```

Also validate the skill and plugin metadata:

```sh
uv run --with pyyaml python "$HOME/.codex/skills/.system/skill-creator/scripts/quick_validate.py" skills/coordinate-agents
uv run --with pyyaml python "$HOME/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py" .
```

When the validator is not at that path, locate the installed `skill-creator` validator and report
the actual command used. Do not claim cross-platform success from a single local run; CI is the
authoritative Windows, macOS, Linux, Node.js 18, and Node.js 22 matrix.

## Change rules

1. Preserve the role boundary: Codex clarifies, specifies, reviews, and performs separately
   authorized releases; Antigravity writes product code and tests.
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
6. Add or update focused tests for every behavior change. Tests must use isolated temporary
   repositories and must not invoke live model accounts or modify a user's real project.
7. Keep `SKILL.md` concise. Put detailed protocol or template material one level down in
   `references/` and link it directly from `SKILL.md`.
8. Keep English and Simplified Chinese user flows semantically synchronized. If commands,
   prerequisites, paths, role behavior, or security rules change, review all of:
   `README.md`, `README.zh-CN.md`, `docs/`, `AI_INSTALL.md`, `SKILL.md`, `SECURITY.md`, and
   `docs/llms.txt`. Never edit the generated root `llms.txt` directly.
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
  unless the user has approved the exact described action. The collaboration protocol requires
  the exact text `RELEASE_APPROVED` for a described release plan.
- Keep GitHub Actions pinned to full commit SHAs.
- npm publishing must use the existing environment-limited trusted publisher with OIDC and
  provenance; never introduce `NPM_TOKEN` or `NODE_AUTH_TOKEN`.
- Verify the anonymous npm tarball, npm integrity/provenance, GitHub Release target, clean worktree,
  and successful CI after publishing before reporting release completion.
