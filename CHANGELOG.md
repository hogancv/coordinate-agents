# Changelog

## Unreleased — v2.4 planning

- Added deterministic post-execution Scope Audit v1 for Task Graphs with an
  Intent Map. Durable evidence covers committed and dirty changes, both rename
  paths, bounded drift facts, and `observe`/`warn`/`strict` policy behavior
  before dependent eligibility is derived.

## 2.3.0 — Multi-Agent Task Graph v1

This is the release-candidate change set after `v2.2.0`. Publication remains
subject to the repository's separate `RELEASE_APPROVED` and `PUBLISH` gates.

### Added

- Additive Task Graph v1 validation and durable graph creation, status, and
  inspection while preserving the existing single-Task contract.
- Deterministic READY frontier planning with explicit dependency reasons and a
  bounded `maxConcurrency` limit.
- One Runtime-owned Git worktree and Runtime-owned Session per running subtask,
  with exact executable resolution and no mutation of the user's checkout.
- Bounded parallel execution with durable per-subtask commits, evidence,
  failures, and dependency outcomes.
- Durable interruption inspection plus explicit recovery, stop, and cleanup
  operations without automatic retries or destructive recovery.
- Deterministic isolated integration and review with structured conflict facts,
  `REVIEW_APPROVED`/`CHANGES_REQUESTED`, and no implicit merge or release
  authority.
- Additive CLI and MCP graph operations, stable JSON schemas, protocol-pure MCP
  stdio behavior, and end-to-end acceptance coverage.

### Changed

- Expanded Task, Session, security, protocol, MCP, and installation
  documentation for dependency-aware local orchestration.
- Synchronized the npm package and Codex Plugin to version `2.3.0` for this
  co-release; their version fields remain independently evolvable.
- Limited Plugin Security Scan automation to pull requests and explicit manual
  runs; the full acceptance matrix continues to run on `main` pushes and tags.

### Verification

The candidate is intended to be checked from one exact source commit with:

```sh
npm ci
npm run check
npm run demo
npm pack --dry-run
uv run --with pyyaml python "$HOME/.codex/skills/.system/skill-creator/scripts/quick_validate.py" skills/coordinate-agents
uv run --with pyyaml python "$HOME/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py" .
```

The complete acceptance suite covers Windows/macOS/Linux and Node.js 18/22.
After creating the candidate tarball, run
`npm run release:verify -- <artifact> --expected-version 2.3.0
--expected-source-commit <candidate-commit> --expected-tag v2.3.0`. The verifier
records the exact source commit, tag, package/Plugin identity, payload
completeness, offline external Adapter example, and isolated Plugin/runtime
discovery and doctor path.

The manually gated npm workflow repeats this isolated verification from the
exact `release_tag` before the OIDC trusted-publisher step.

## 2.2.0 — Adapter SDK Contract v1

This is the release-candidate change set after `v2.1.3`. Publication remains
subject to the repository's separate `RELEASE_APPROVED` and `PUBLISH` gates.

### Added

- Public Adapter SDK Contract v1 at `adapter-sdk.mjs`, covering adapter
  identity, capabilities, detection, configuration compatibility, launch plans,
  persistent-session input, and launch policy.
- Public Adapter Conformance Kit with bounded diagnostics and deterministic
  offline fixtures for built-in and external adapters.
- Explicit trusted-local registration for one `.mjs`, `.js`, or `.cjs` module,
  with canonical-path validation, transactional rollback, and no URL imports,
  downloads, directory scans, or automatic npm installation.
- Setup and MCP integration for one additive external-adapter registry snapshot,
  including discovery, configuration, Task dispatch, and persistent Session
  reuse.
- Minimal external Adapter example under
  `examples/minimal-external-adapter/`, including an offline conformance path.

### Changed

- Migrated the built-in Codex CLI, Antigravity CLI, and generic CLI adapters to
  validated Contract v1 descriptors while preserving exact executable identity
  and project > user > adapter-default precedence.
- Hardened the acceptance path for Windows/macOS/Linux and Node.js 18/22,
  including portable Session and Inspector paths, Node 18 PTY fallback behavior,
  scanner-safe example fixtures, and non-recursive package checks.
- Synchronized the npm package and Codex Plugin to version `2.2.0` for this
  co-release; the two version fields remain independently evolvable for future
  releases.

### Verification

The candidate is intended to be checked from one exact source commit with:

```sh
npm ci
npm run check
npm run demo
npm pack --dry-run
uv run --with pyyaml python "$HOME/.codex/skills/.system/skill-creator/scripts/quick_validate.py" skills/coordinate-agents
uv run --with pyyaml python "$HOME/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py" .
```

After creating the candidate tarball, run
`npm run release:verify -- <artifact> --expected-version 2.2.0
--expected-source-commit <candidate-commit> --expected-tag v2.2.0`. The verifier
records the exact source commit, tag, package/Plugin identity, payload
completeness, offline external example, and isolated Plugin/runtime discovery
and doctor path.

The manually gated npm workflow repeats this isolated verification from the
exact `release_tag` before the OIDC trusted-publisher step.
