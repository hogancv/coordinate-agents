# Repository instructions for AI contributors

This file governs development and maintenance **after an agent has entered this repository**. It
is not the installation entry point. For installation, read [`AI_INSTALL.md`](./AI_INSTALL.md).

## Canonical identity

- Repository: `https://github.com/hogancv/coordinate-cli-agents`
- npm package: `@hogancv/coordinate-cli-agents`
- Package source of truth: `package.json`

Do not rename, mirror, or substitute these identities. Never add credentials, tokens, cookies,
recovery codes, private keys, personal email addresses, or raw `.agent-bus` data to commits,
fixtures, logs, documentation, or release artifacts.

## Repository map

- `bin/coordinate-cli-agents.mjs`: installer, updater, doctor, quickstart, launch, agent management, and uninstall CLI.
- `adapters/`: agent adapter subsystem (`codex-cli`, `antigravity-cli`, `generic-cli`, and registry).
- `scripts/config.mjs`: shared safe configuration loader, agent ID validator, and path containment checks.
- `scripts/agent-bus.mjs`: durable project-local message bus protocol engine.
- `scripts/demo.mjs`: isolated end-to-end demonstration.
- `SKILL.md`: runtime instructions installed into both agents.
- `references/`: protocol and task-template details loaded by the skill as needed.
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

Also validate the skill metadata:

```sh
uv run --with pyyaml python "$HOME/.codex/skills/.system/skill-creator/scripts/quick_validate.py" .
```

When the validator is not at that path, locate the installed `skill-creator` validator and report
the actual command used. Do not claim cross-platform success from a single local run; CI is the
authoritative Windows, macOS, Linux, Node.js 18, and Node.js 22 matrix.

## Change rules

1. Preserve the role boundary: Codex clarifies, specifies, reviews, and performs separately
   authorized releases; Antigravity writes product code and tests.
2. Keep filesystem operations cross-platform and safe for paths containing spaces and shell
   metacharacters. Do not introduce shell-string interpolation when argument arrays are possible.
3. Refuse symlinks, junctions, path escapes, unrecognized installs, and destructive recovery by
   default. Preserve atomic publication, deduplication, leases, quarantine, and explicit cleanup.
4. Add or update focused tests for every behavior change. Tests must use isolated temporary
   repositories and must not invoke live model accounts or modify a user's real project.
5. Keep `SKILL.md` concise. Put detailed protocol or template material one level down in
   `references/` and link it directly from `SKILL.md`.
6. Keep English and Simplified Chinese user flows semantically synchronized. If commands,
   prerequisites, paths, role behavior, or security rules change, review all of:
   `README.md`, `README.zh-CN.md`, `docs/`, `AI_INSTALL.md`, `SKILL.md`, `SECURITY.md`, and
   `docs/llms.txt`. Never edit the generated root `llms.txt` directly.
7. If installation payload contents change, update `package.json` `files`, package tests, and the
   package version as appropriate. Keep `package-lock.json` synchronized.
8. Do not use third-party mirrors, mutable unknown scripts, `curl | sh`, or long-lived npm tokens
   in project automation.

## Release restrictions

- Passing review or CI is not release authorization.
- Never merge, tag, push, publish, deploy, create a GitHub Release, or run a release workflow
  unless the user has approved the exact described action. The collaboration protocol requires
  the exact text `RELEASE_APPROVED` for a described release plan.
- A release tag must be `vX.Y.Z` and exactly match `package.json`.
- Keep GitHub Actions pinned to full commit SHAs.
- npm publishing must use the existing environment-limited trusted publisher with OIDC and
  provenance; never introduce `NPM_TOKEN` or `NODE_AUTH_TOKEN`.
- Verify the anonymous npm tarball, npm integrity/provenance, GitHub Release target, clean worktree,
  and successful CI after publishing before reporting release completion.
