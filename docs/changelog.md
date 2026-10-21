---
title: Changelog
description: Published Coordinate Agents release history for the Web package and retained structured workflow.
---

<div id="更新日志" class="doc-anchor" aria-hidden="true"></div>

# Changelog

For the v2.4 → v3 product-direction change and original v2.4.0 documentation,
see [v2.4 docs and migration](./v2.4.html).

<div id="302---2026-10-21" class="doc-anchor" aria-hidden="true"></div>

## [3.0.2] - 2026-10-21

<div id="web-工作台" class="doc-anchor" aria-hidden="true"></div>

### Web Workspace

- Add Git Changes with line-based review feedback, Custom Terminals, project-level desktop notifications, Collaboration Timeline and Collaboration Health.
- Simplify the task header with consistent status/action controls, red power icons and confirmation before closing one task or all task terminals in the current project. Move the Zen exit control to the top right and align sidebar environment status.
- Preserve task/project list elements across refreshes and keep terminal input, focus and output attached to the selected task.

<div id="对话恢复" class="doc-anchor" aria-hidden="true"></div>

### Conversation recovery

- Automatically retain the original native conversation for supported local Codex CLI 0.163.x, using process-scoped events and exact primary CLI metadata. Keep exact-UUID fallback for unsupported or unavailable capture.
- Reopen the original Codex conversation without replaying old prompts or work. Recover a missing Antigravity executor while retaining a valid Codex runtime, recorded rounds and Timeline.
- Derive readiness from current owned sessions, runtime generations, terminal initialization and identity-conflict facts; remove the extra post-resume UUID-confirmation step while keeping old records readable.
- Reject fresh-pair restart for bound/reserved Default tasks, fence stale runtime/round writes, and allow an unchanged executor to report its existing round during slow Codex recovery.

<div id="设置、文档与兼容性" class="doc-anchor" aria-hidden="true"></div>

### Settings, documentation and compatibility

- Expose Antigravity tool permission mode in Workspace settings. The adapter default remains automatic approval via `--dangerously-skip-permissions`; explicit saved argument arrays, including `args: []`, override it.
- Align English/Chinese recovery guides and action tables, mark historical designs and native acceptance results by implementation stage, and refresh the Workspace screenshot.
- Update close-confirmation test fixtures and use native canonical paths for Windows recovery ownership tests.
- Keep the Web-first npm payload, Node.js >=18 floor and existing PTY/fallback policy. The independently versioned Legacy Plugin remains 2.4.0. Historical native CLI acceptance is not a new cross-platform or continuous-identity guarantee.

<div id="301---2026-10-13" class="doc-anchor" aria-hidden="true"></div>

## [3.0.1] - 2026-10-13

<div id="windows-终端" class="doc-anchor" aria-hidden="true"></div>

### Windows terminals

- Restore verified native ConPTY sessions on Windows 10 with Node 22/24. Check native startup and real TTY behavior in an isolated Session Host; fall back safely after failed or timed-out probes and confirmed cleanup.
- Fix Session Host RPC errors, close-response races, and stale metadata overwriting final output. Confirm owned Host/CLI exit before reporting cleanup, and prevent status polling from terminating a reused historical PID.
- Add backend and sanitized platform diagnostics, explicit native/stdio modes, UTF-8-safe output tails, and bounded startup cleanup. Preserve independent Host reconnection and retry failed terminal resize requests while coalescing pending sizes.

<div id="web-工作台-1" class="doc-anchor" aria-hidden="true"></div>

### Web Workspace

- Simplify the sidebar with compact project/task navigation, project switching, repository details, and task/project search.
- Add draggable, persistent dual-terminal split sizing and individual Codex/Antigravity focus with split restoration and scrollback-preserving reflow.
- Add light/dark theme switching with a light default, saved preferences, and matching terminal palettes without restarting Sessions.
- Combine Workspace and task controls into one toolbar and place terminal role labels beside agent names to increase terminal space.
- Fix interactive startup detection for mixed OSC terminators and continuous terminal-title updates, preventing ready Codex terminals from being incorrectly closed after a timeout.
- Preserve empty Antigravity interactive prompts across proxy forwarding and improve terminal backend visibility and startup/lifecycle feedback.

<div id="性能与安全" class="doc-anchor" aria-hidden="true"></div>

### Performance and safety

- Reduce redundant Event Journal path resolution and UTF-8 byte counting while preserving path checks and bounded reads.
- Optimize Workspace archive discovery and cross-task references while retaining exact-file ownership/activity validation before deletion.
- Read only referenced Session records for single-task views and reject mismatched payload/file identities. Reduce unnecessary Inspector summary sanitization and graph-detail allocations in the GitHub source.

<div id="兼容性" class="doc-anchor" aria-hidden="true"></div>

### Compatibility

- Keep Node.js >=18, node-pty 1.1.0, and the Web-first npm payload. Node 18 continues to use stdio fallback; native PTY is selected only on supported, validated runtimes. Fallback does not provide native TUI or child-observed resize.
- The independently versioned GitHub Legacy Plugin remains at 2.4.0. This release adds no WebSocket transport or automatic multi-agent orchestration.

<div id="300--web-first-npm-distribution" class="doc-anchor" aria-hidden="true"></div>
<div id="_3-0-0-—-web-优先的-npm-分发" class="doc-anchor" aria-hidden="true"></div>

## 3.0.0 — Web-first npm distribution

- Added right-click archiving for Workspace conversations and whole project folders. Archive closes owned terminals, persists records and hides them; settings can clear archived conversation and owned Session transcripts across projects while preserving project source. Archived folders remain hidden on restart and explicit re-add restores their navigation entry.

- npm now ships only the lightweight Web Workspace, HTTP APIs, xterm assets, required shared Session/PTY/Workspace runtime and launch validation. Plugin manifests/Skills, MCP, Task Graph, Adapter SDK/conformance/examples, development tooling and large demo assets remain in GitHub and are excluded from the tarball.
- The Web command no longer imports the Legacy CLI, Inspector data model, Task Graph or Agent Bus. Default Web APIs expose projects, Workspace tasks, owned sessions and settings; structured operations remain source-only.
- Preserve dual terminals, custom commands and spaced paths/arguments, Codex model/reasoning settings, role injection, task-bound messaging, persistence, resize, close/restart and independent Session Host reconnection. Keep the existing platform PTY fallbacks and Node >=18 floor.
- Breaking npm API changes: only web/help/version remain; remove wildcard and Adapter SDK exports. Use `npx @hogancv/coordinate-agents@2.4.0 <command>` for the old npm CLI or `node bin/coordinate-agents-legacy.mjs <command>` in GitHub source. The Plugin resolver selects its complete bundled Legacy entry; Plugin version remains independently at 2.4.0.
- Replace Plugin-based npm artifact gates with an isolated production install, import/payload checks, offline mock dual terminals, role/message/task isolation, project/settings/reconnect/restart and cleanup checks. Plugin/MCP tests remain independent. Add a Windows/macOS/Linux × Node 18/22/24 acceptance matrix.
- Fix absent terminal read limits being treated as one byte/line, ensure the message helper runs through symlink/realpath aliases, and let the Session Host consume initialization before disconnecting IPC (validated with delayed imports and Node 22). Preserve loopback, Host/Origin, capability, bounded input and filesystem guards.
- No generated build is required for `npm pack --ignore-scripts`. The manually authorized Trusted Publishing/OIDC workflow publishes the exact verified tarball. No publication is performed by this change.
- Exact size/install/startup measurements and validation limitations: [V3 release evidence](./releases/v3-web-first.md).

<div id="240--lightweight-web-workspace" class="doc-anchor" aria-hidden="true"></div>
<div id="_2-4-0-—-轻量-web-工作台" class="doc-anchor" aria-hidden="true"></div>

## 2.4.0 — Lightweight Web Workspace

This release publishes the bilingual dual-terminal Web Workspace and its
low-overhead collaboration path. The structured Skill / CLI / MCP Task and
Task Graph workflows remain available with their existing contracts.

- Rebuilt Web Workspace as a bilingual dual-terminal task list with fresh Codex + Antigravity
  terminal pairs, with independent Workspace records, custom launch commands,
  model/reasoning settings, raw input, resize, and explicit pair lifecycle controls.
- Added separately versioned Web-lite role prompts and task-bound terminal messaging
  for low-overhead collaboration; structured Skill/CLI/MCP Task and Graph
  workflows remain available with their original contracts.
- Replaced the Web chat/Composer and management pages with interactive PTYs;
  preserved the read-only Inspector and static Composer compatibility resource.
- Documented the two modes and their different completion/recovery guarantees.
  Publication remains controlled by the explicit release workflow.
- The default test command runs the PTY/MCP/Graph suite serially to avoid
  resource contention in the release gate.
- Isolated the CLI launcher test from real user configuration and corrected
  executable permissions on user-configuration test fixtures.

- Added deterministic post-execution Scope Audit v1 for Task Graphs with an
  Intent Map. Durable evidence covers committed and dirty changes, both rename
  paths, bounded drift facts, and `observe`/`warn`/`strict` policy behavior
  before dependent eligibility is derived.
- Added explicit bounded `graph-advance` for 1–32 freshly planned waves with
  deterministic stop reasons and no automatic retry, recovery, integration,
  review, dependency mutation, or release authority.

<div id="230--multi-agent-task-graph-v1" class="doc-anchor" aria-hidden="true"></div>
<div id="_2-3-0-—-多智能体-task-graph-v1" class="doc-anchor" aria-hidden="true"></div>

## 2.3.0 — Multi-Agent Task Graph v1

This is the release-candidate change set after `v2.2.0`. Publication remains
subject to the repository's separate `RELEASE_APPROVED` and `PUBLISH` gates.

<div id="新增" class="doc-anchor" aria-hidden="true"></div>

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

<div id="变更" class="doc-anchor" aria-hidden="true"></div>

### Changed

- Expanded Task, Session, security, protocol, MCP, and installation
  documentation for dependency-aware local orchestration.
- Synchronized the npm package and Codex Plugin to version `2.3.0` for this
  co-release; their version fields remain independently evolvable.
- Limited Plugin Security Scan automation to pull requests and explicit manual
  runs; the full acceptance matrix continues to run on `main` pushes and tags.

<div id="验证" class="doc-anchor" aria-hidden="true"></div>

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

<div id="220--adapter-sdk-contract-v1" class="doc-anchor" aria-hidden="true"></div>

## 2.2.0 — Adapter SDK Contract v1

This is the release-candidate change set after `v2.1.3`. Publication remains
subject to the repository's separate `RELEASE_APPROVED` and `PUBLISH` gates.

<div id="新增-1" class="doc-anchor" aria-hidden="true"></div>

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

<div id="变更-1" class="doc-anchor" aria-hidden="true"></div>

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

<div id="验证-1" class="doc-anchor" aria-hidden="true"></div>

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
