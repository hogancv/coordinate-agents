---
title: "Native identity capture: implementation and acceptance"
description: Retained technical reference; applicability follows the implementation stage described in this document.
---

<div id="技术参考-native-identity-capture-implementation-and-acceptance" class="doc-anchor" aria-hidden="true"></div>

# Native identity capture: implementation and acceptance

Implementation sections below apply to source **`f9f0210` and later**, packaged in
**Web 3.0.2** (checked 2026-10-21). The native acceptance results and suite counts
are retained as a **historical snapshot of `5fad370`**, before the extra recovery
confirmation was removed. They are not a new npm release or a fresh acceptance
run of the current readiness policy. Use the [current action table](codex-conversation-resume.md#action-table)
for user-facing recovery steps.

## Audited sources (2026-10-21)

Official [Hooks documentation](https://learn.chatgpt.com/docs/hooks) documents
SessionStart (`session_id`, `cwd`, source startup/resume/clear/compact), trust review,
and the invocation-wide bypass flag. Workspace already disables Hooks; enabling or
bypassing all user Hooks would change its trust policy. We do not use that route.
[Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
documents the OTLP/HTTP JSON log exporter and per-invocation `-c` overrides.

The official Codex CLI `rust-v0.163.0` source was inspected using local `gh api`:
`otel/src/events/session_telemetry.rs` emits `codex.conversation_starts` and
`codex.user_prompt` (used to revisit lazy native records after the first input);
`otel/src/events/shared.rs` adds `conversation.id`, `event.timestamp`, `app.version`
and `originator`. `rollout/src/recorder.rs` writes primary SessionMeta. Background
subagents emit the same log event, so the event alone is insufficient.
`hooks/src/legacy_notify.rs` is turn-completion only and would replace the user's
notification command. Exec JSON would replace the interactive TUI. Neither is used.

## Boundaries and responsibilities

- `codex-identity-capture.mjs`: audited 0.163.x version gate; private random loopback
  endpoint; bounded OTLP JSON parser; exact UUID metadata preflight; bounded retries
  for delayed file publication/Task association. No raw telemetry is persisted.
- `session-manager.mjs` / `session-host.mjs`: opt in only owned default Codex slots,
  retain original executable and arguments, add private exporter config only in Host
  memory, use `--no-daemon` to keep exporter ownership local, close receiver on exit.
- `codex-conversation.mjs`: reuse exact native-record lookup, strict `source=cli`,
  canonical cwd and audited version/provenance for automatic capture. Known primary
  originators are codex_cli_rs, codex-tui and Codex Desktop (including underscore form).
  Unknown formats fail closed for capture, without changing manual preflight.
- `workspace-task-runtime.mjs`: compose trusted observations with the existing
  Identity Store; bind immutable Task/Session/generation claims, revision CAS,
  monotonically ordered observations and cross-task occupancy in its short atomic
  config transaction. File lookup and telemetry handling never hold that lock.
- Resume state and UI: historical binding gives a direct reopen action; missing
  capture or a failed reopen retains exact-UUID fallback. A live owned Codex with
  a missing executor uses **Recover executor**. Both current terminals must finish
  startup; no post-resume identity confirmation is required. Conflicts fence new
  Codex instructions. No second durable state machine.

DISCOVERED means a sanitized startup event is being checked. BOUND means the event
and primary metadata passed the existing transaction. Neither implies LIVE_VERIFIED.
OTEL export is asynchronous, has gaps, and is not an input fence; no automatic live
lease is claimed. Recovery readiness depends on current owned Session facts,
runtime generations, completed startup and the absence of a conflict, independently
of legacy manual-confirmation records. A `/new` event
can latch a conflict after its primary record becomes available, but immediate
switch detection is not guaranteed. Disk-only candidates never create bindings.

Limits: 1 MiB per request, four connections, one processing request, 4096 records
per payload and native search, 256 new candidate events per Host (same bound UUID
prompts are deduplicated), four publication
retries (250/500/1000/2000 ms), 15-second event age, no background disk polling.
Native metadata can be unavailable before the first turn; capture can complete
after the initial Workspace role turn. Closing before capture completes may require
manual recovery. A very large native archive that hits the scan bound also falls back.

The loopback capability ties events to the owned launch context, not an OS security
boundary against arbitrary same-user code. Same-user scripts can already edit
local Task/config/native files. A project or browser payload cannot claim trust,
configure the verifier or call an identity HTTP action. Capabilities are never
stored in Session argv, public views, diagnostics or Task identity records. Ordinary
OTEL log export is redirected locally for this invocation; configured trace/metric
exporters and native notify remain in place. Prompts/responses are not logged.

## Independent native acceptance

**Historical applicability:** the acceptance below was run for the automatic-binding
stage at `5fad370`, package 3.0.1, Codex CLI 0.163.0 on macOS arm64. It predates
`f9f0210` and its confirmation-free readiness. `scripts/pty-probes/codex-identity.integration.mjs`
still has the old `AWAITING_CONFIRMATION` assertions and explicit confirmation
call; those assertions need updating before that script can certify the current
flow. This documentation change does not claim a new real-CLI acceptance run.
Current Session/UUID recovery regressions are in `test/workspace-resume.test.mjs`,
`test/workspace-auto-binding.test.mjs` and `test/workspace-resume-ui.test.mjs`.

The historical command was `npm run test:native-identity` with an audited CLI installed. If its command is
a symlink rejected by the existing executable safety policy, set
`COORDINATE_AGENTS_NATIVE_CODEX` to the absolute real executable path. This check uses
the real TUI, detached Host and primary records, isolated temporary CODEX_HOME,
a loopback Responses stub and mock executor. It never uses a live model account or
changes global configuration. It tests automatic binding and original UUID resume
in a new generation, while requiring AWAITING_CONFIRMATION.

On 2026-10-21 this test passed with Codex CLI 0.163.0 on macOS darwin/arm64,
through the real detached Host, after an explicit fixture user input made the lazy
native record available. It restored the original UUID in a new generation and
remained AWAITING_CONFIRMATION. No real model account was contacted.
The same acceptance also passed a real `/new` switch (including the CLI's current
worktree picker), verified that its primary record produced a latched conflict,
and checked that prior manual confirmation no longer authorized the Task.

The test establishes native event transport and history identity only. It does not
establish model memory, real Antigravity completion, Windows/Linux native behavior,
remote/daemon behavior, other CLI versions, continuous verification, or a race-free
`/new` fence. Standard Web/Shared/Package/Legacy tests use isolated fixtures and are
separate evidence. Future versions should expand the compatibility gate only after
running this native check and checking source/provenance and event semantics again.

Regression coverage is split by boundary: `workspace-auto-binding.test.mjs` covers
creation, concurrent launches, UUID-free reopen, manual fallback and identity
switches; `workspace-native-identity.test.mjs` covers ownership, stale generations,
CAS, original bindings, pending Resume targets and duplicate occupancy;
`workspace-resume.test.mjs` covers timelines, repeated clicks, partial executor
recovery, interruption and dispatch/receipt fences. Receiver tests cover capability,
body/scan bounds, primary provenance, event ordering and long-running same-identity
prompts. UI tests execute dialog/action behavior, and Package tests install and
verify the real npm tarball with offline CLI fixtures.

Historical local verification at `5fad370` (macOS arm64, Node 24.17.0, 2026-10-21):

| Command | Passed | Skipped | Failed |
| --- | ---: | ---: | ---: |
| `npm test` (Core) | 406 | 1 | 0 |
| `npm run test:web` | 281 | 1 | 0 |
| `npm run test:shared` | 100 | 1 | 0 |
| `npm run test:package` | 7 | 0 | 0 |
| `npm run test:legacy` | 114 | 0 | 0 |
| `npm run test:plugin` | 27 | 0 | 0 |
| `npm run test:native-identity` (real CLI 0.163.0) | 1 | 0 | 0 |

Suite counts overlap. Platform-conditional skips are not cross-platform evidence.
`npm run check:llms`, `git diff --check`, syntax checks and npm dry-run payload
inspection also passed. No commit or release action was performed.
