---
search: false
title: "Native Desktop Notifications Implementation Plan"
description: Retained technical reference; applicability follows the implementation stage described in this document.
---

::: info Historical engineering record
This page preserves the design, plan or acceptance evidence for its recorded implementation stage. Earlier behavior, proposed capabilities and old deployment settings do not supersede the [current Workspace guide](/inspector.html) or [release history](/changelog.html).
:::

<div id="技术参考-native-desktop-notifications-implementation-plan" class="doc-anchor" aria-hidden="true"></div>

# Native Desktop Notifications Implementation Plan

**Goal:** Implement the user-supplied Native Desktop Notifications v1 specification directly on `codex/native-desktop-notifications`, based on current origin/main.

**Architecture:** Project notification preferences and a bounded persistent dispatch ledger live under `.agent-bus`. A receipt captures only the committed task identity/title/status; after the cooperation lock releases, notification dispatch claims the event before invoking a bounded asynchronous OS command. Windows uses a per-user Start Menu shortcut with a stable AUMID and WinRT Toast; macOS uses fixed AppleScript with argv.

**Tech Stack:** Node >=18 ES modules, built-in filesystem/child_process, native HTML/CSS/JS, PowerShell 5.1/WinRT and osascript. No new dependencies or daemon.

**Spec:** User attachment `已粘贴的文本.txt` (Native Desktop Notifications v1).

## Constraints and decisions

- Follow the user's explicit instruction to implement directly; do not pause for plan approval, commit, create a PR, or publish.
- Defaults: disabled; DONE off, APPROVED and FAILED on. Preferences are project scoped and hot read.
- Claim persisted before OS invocation, no retry, no task-state mutation. Accepted command does not prove display.
- Ledger has at most 4096 event hashes and no message content. Remove entries only for deleted task records (which cannot report); fail closed at capacity rather than replay old events. Expose bounded diagnostic reason without OS stderr, prompts, paths, or tokens.
- No browser/SSE/polling hooks. No Custom terminal completion inference.

## Tasks

- [x] A: Write failing tests for schema/defaults, safe content, native adapters and bounded execution; implement config and notification core with injectable executor. Test unsupported platforms, Unicode and malicious text, missing tools, timeouts, denied permissions.
- [x] B: Write failing tests for cross-process claims and receipt integration; implement bounded ledger using existing safe-path/atomic-write helpers and a short notification-only transaction lock, then invoke from reportWorkspaceTask after successful persistence/lock release. Test invalid reports, summary changes, rounds, unavailable OS, corruption and symlinks, no browser/server dependency.
- [x] C: Write failing API/UI tests; add capability/root-bound save and fixed test operations, settings read capability, notification controls and bilingual result messages. Save failure retains form; test button is guarded.
- [x] D: Add precise npm allowlist/verifier entries, installed-package checks and short usage/platform acceptance notes. Run targeted tests, test:web, check:web, test:package, npm test and pack dry-run. Review the complete diff and record actual outcomes.

## Review focus

- Windows identity registration really uses a Shell shortcut property store, no borrowed AUMID or third-party module.
- Filesystem errors fail closed, linked files rejected, ledger bounded without allowing replay.
- A CLI can exit after reporting; retain the short native child until completion, never await OS inside task locks.
- Project switches/stale responses cannot save notification settings into another project.
- Permissions/Focus Assist may hide accepted notifications; never claim displayed.

## Execution record

- Base: origin/main `ddaddd1` fetched on 2026-10-15; clean checkout switched to the requested branch. No commits, pushes, PRs or releases.
- A–C: tests were written and observed failing before implementation; targeted config/adapter/receipt/multiprocess/API/UI tests pass. A real standalone report CLI uses a mocked native command without a Web server; its output remains compatible and it waits for native handoff before exiting.
- Ruling: use a short notification-only lock rather than the shared config lock. The existing shared lock can steal a newly created ownerless lock; the notification lock waits for initialization and serializes stale-owner recovery. No external OS command runs under it. This adds one small project-local recovery guard; an orphaned recovery guard fails closed rather than risking duplicate dispatch.
- Ruling: cap claims at 4096 and reclaim only deleted task identities. At capacity, fail closed with a diagnostic instead of evicting valid at-most-once markers; this may suppress new notifications until archived tasks are cleared.
- Independent whole-change review found a stale-recovery race and falsy-JSON corruption replay. Both were reproduced in failing regressions, fixed, and verified passing. No deferred review findings.
- Browser QA (ego-browser): English/Chinese notification section, defaults, enable/DONE save and reopen, restoration to disabled, and modal viewport fit verified. No real native notifications were sent.
- macOS AppleScript was compiled with system osacompile (syntax check only). Windows native execution and visible delivery on Windows 10/11 and macOS remain manual acceptance items.
- Earlier regression runs caught an expected settings-response key change and an isolated VM fixture missing the new rendering helper; both tests were updated and passed.

## Final verification

- `node --test test/workspace-notifications.test.mjs test/workspace-notification-settings.test.mjs`: 19/19 passed.
- `node --test test/workspace-message.test.mjs test/workspace-task-runtime.test.mjs test/action-gateway.test.mjs`: 38/38 passed.
- `npm test`: 297 tests, 296 passed, 1 platform skip, 0 failed (final run after UI project-binding guard).
- `npm run check:web`: Web suite 183 tests / 182 passed / 1 skip; shared suite 85 tests / 84 passed / 1 skip; 0 failed. This runs `test:web` and `test:shared`.
- `npm run test:package`: 7/7 passed, including real tarball installation and mocked installed native adapters.
- `npm pack --dry-run --ignore-scripts --json`: 53 files, all three notification runtime/script files included.
- `git diff --check`: passed. Temporary preview server and browser TaskSpace closed. Work is preserved uncommitted on the requested branch.
