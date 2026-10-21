---
search: false
title: "Custom Terminal Workspace Implementation Plan"
description: Retained technical reference; applicability follows the implementation stage described in this document.
---

::: info Historical engineering record
This page preserves the design, plan or acceptance evidence for its recorded implementation stage. Earlier behavior, proposed capabilities and old deployment settings do not supersede the [current Workspace guide](/inspector.html) or [release history](/changelog.html).
:::

<div id="技术参考-custom-terminal-workspace-implementation-plan" class="doc-anchor" aria-hidden="true"></div>

# Custom Terminal Workspace Implementation Plan

**Goal:** Implement the supplied Custom Terminal Workspace v1 specification alongside the unchanged default collaboration flow.
**Architecture:** Mode-aware task slots and immutable custom snapshots; a bounded project config file; GenericCliAdapter → existing Session Manager/Host. No shell interpretation or automatic custom prompt injection.
**Tech Stack:** Node >=18, native ES modules/HTML/CSS, existing PTY and SSE.
**Spec:** User-provided Custom Terminal Workspace v1 (2026-10-14).

## Constraints and rulings
- Work directly on `codex/custom-terminal-workspace`, based on fetched `origin/main`; no publish, push, merge, tag, version change, or live model tasks.
- Explicit request to implement continuously supersedes repeated design/plan approval gates. Implement inline; review the whole diff independently at the end.
- Preserve legacy records and default slot IDs. Custom uses terminal1/terminal2 with generic adapter identity separate from command and role.
- Prompts: UTF-8 project 8192 bytes, each terminal 4096 bytes; no controls except TAB/CR/LF; no prompt payload in journal.
- Preserve exact executable resolution, safe paths, atomic writes, task ownership, and npm whitelist.

## Tasks
- [x] A: Add failing config/snapshot tests; implement strict config schema, atomic project persistence, create mode and record compatibility.
- [x] B: Add failing custom lifecycle/ownership/cooperation tests; implement task-only generic launch, independent sessions, restart/history/discovery/rollback/archive, explicit prompt delivery.
- [x] C: Add failing pure UI model/distribution tests; implement creation dialog, project custom settings, prompt preview/copy/confirmed send with input queue reservation, mode-aware labels/focus/review restrictions.
- [x] D: Sync English/Chinese docs and whitelist; run focused tests, check:web, test:web, test:package, npm pack dry-run; independent diff review and fixes.

## Review focus
- Same command must produce two task-and-slot-bound session IDs, never reuse sessions across tasks.
- Stale UI targets, swapped metadata, or changed project must never write/close an unrelated session.
- Failed second launch must reap the first session; rollback failures must stay visible.
- Project edits cannot change a historical task snapshot, including after restart.
- Prompt confirmation/unknown delivery cannot cause replay, default collaboration, or keyboard queue interleaving.

## Ledger
- Baseline Web tests started on Windows / Node 22.23.0 with existing dependencies.

- Final verification: Windows 10 / Node 22.23.0; check:web 148 Web + 84 shared tests (228 passed, 4 platform skips); check 263 (259 passed, 4 skips); package acceptance 7/7; pack dry-run 50 whitelisted files, 3.0.1 unchanged.
- Expanded custom lifecycle passed: swapped-slot refusal, stale-generation refusal, journal exclusion, archive cleanup of only this task, another task stays active.
- Independent read-only review resolved multiline paste, user-command precedence, and VM fixture issues; no remaining important finding reported.
- Browser mock smoke verified creation dialog, independent native PTYs/SSE, Prompt copy/confirmed send, refresh rebinding and immutable Prompt snapshots. Both test servers and all four browser fixture Hosts stopped. Temporary fixture directories retained after environment rejected recursive cleanup.
- Real Codex/agy TUI, macOS/Linux and Node 18 were not exercised; no live model accounts, release actions, commits or version changes.
