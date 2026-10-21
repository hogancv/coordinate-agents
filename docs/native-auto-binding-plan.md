# Codex native auto-binding v1 implementation plan

> Historical implementation plan — applies to source `5fad370` (2026-10-21,
> package version 3.0.1), where automatic binding still composed the old manual
> recovery confirmation. Source `f9f0210` supersedes that confirmation requirement.
> Preserve the plan and verification results as history; current actions and
> readiness are defined in the [recovery guide](codex-conversation-resume.md#action-table).

Intent: automatically retain the original Codex conversation for a Workspace Task,
then reopen it with one click. Identity uncertainty must remain visible and must
never authorize collaboration. Use the existing Task identity transaction and
resume lifecycle; do not add another persistent identity store.

## Source audit / design

- Local main matches origin/main at the start of this change. Repository AGENTS.md
  was read as documentation, per the checkout override. Work stays in this checkout;
  no commit, push, tag, publish, or release is authorized.
- Session IDs identify owned PTYs. Runtime generations fence replacements. Native
  UUIDs identify Codex history. Historical metadata does not prove a live TUI.
- Existing Identity Store already validates ownership, generation, revision,
  ordering, duplicate occupancy, immutable bindings and atomic publication.
- Existing Resume already selects a stored UUID, checks native metadata, retains
  history, serializes repeated clicks, and preserves Codex if executor recovery fails.
- Hooks require trust; Workspace deliberately disables them. Exec JSON changes the
  interactive product. Native records alone cannot correlate concurrent launches.
- Selected source: process-scoped OTLP/HTTP JSON logs, received by the owned detached
  Session Host on loopback with a random capability, only for supported Codex CLI.
  Conversation-start and user-prompt events supply the exact UUID; native metadata supplies
  canonical cwd and primary CLI provenance. No newest-file inference or disk polling.
- OTEL is asynchronous and has no reliable TUI switch fence. It establishes BOUND,
  never LIVE_VERIFIED. Resume retains current manual confirmation. A received
  identity conflict invalidates manual confirmation and blocks new collaboration.

## Tasks (execute inline, test first)

1. Add isolated receiver/launch tests: reject unauthenticated requests, malformed,
   stale, non-primary, foreign-project and ambiguous records; bound body/scan/work;
   validate supported launch and manual fallback. Implement Host-scoped collector,
   reuse readCodexConversation and createWorkspaceNativeIdentityStore. Keep all
   native I/O outside identity locks. Dispose receiver with owned PTY.
2. Exercise real detached Host with mock CLI for create, concurrent task isolation,
   close/reopen without UUID, original history, late runtime, exit and switch cases.
   Preserve resume/legacy behavior and invalidate confirmation on conflict.
3. Add UI behavior tests for direct reopen with persisted UUID, manual fallback,
   failed retry, partial recovery, and stale project responses. Implement compact
   one-click entry and explicit discovery/binding/confirmation presentation.
4. Include modules in exact npm whitelist and artifact verification. Update English
   and Chinese docs, mechanism/trust documentation, and independent native acceptance.
5. Run focused tests, Web/Shared/Package, core and Legacy regression; inspect diff.
   Record real CLI transport evidence separately from mock and model-memory checks.

## Review focus

Authenticated event replay vs current generation; asynchronous startup before Task
association; subagent events; conflicting identities after manual confirmation;
collector failures must preserve ordinary launch; no capability or telemetry payload
in persistent Session metadata, browser data, diagnostics or logs; receipt locks
must not span native file scans or telemetry reads.

## Implementation decisions and review

- Native acceptance confirmed that JSONL publication is lazy until a submitted
  turn. Include the native user-prompt event to revisit that record, rather than
  guessing from disk or retrying/resending the Workspace role prompt.
- Independent read-only review found two Important issues: same-identity prompts
  exhausting the candidate budget, and unvalidated subagent candidates advancing
  the global event watermark. Both received failing regressions and fixes. Only
  successful primary observations advance the watermark, same-identity prompts
  are deduplicated, and distinct UUIDs may share a millisecond timestamp.
- First binding cannot take a UUID different from this Task's reserved Resume
  target. Existing bindings still latch conflicts without replacing the original.
- An explicitly requested fresh restart of a bound/reserved Task is refused before
  closing terminals. Otherwise automatic capture of its newly created UUID would
  irreversibly conflict with the original binding. Reopen continues the Task;
  existing New Task creates a fresh context. Unbound/custom restart is retained.
  Cost: callers that previously restarted a bound Task must choose one of those
  explicit operations. The old lifecycle test now checks this preservation rule.
- The pre-existing HTTP terminal-health fixture also failed on an untouched HEAD
  snapshot: it lacked Task/slot ownership on synthetic Sessions. Correct the
  fixture rather than relaxing production Session ownership checks.
- No commits, branches, pushes, tags, releases, publishes or global Codex changes.

## Final verification

Core 406 passed / 1 skipped; Web 281 / 1; Shared 100 / 1; Package 7 / 0;
Legacy 114 / 0; Plugin 27 / 0; native identity acceptance 1 / 0. No failures.
Counts overlap. Real native acceptance is CLI 0.163.0 on macOS arm64 with local
Responses/executor fixtures; model memory and other platforms remain unverified.
Independent review findings were fixed with RED→GREEN tests. No deferred minors.
