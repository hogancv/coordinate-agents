---
search: false
title: "Collaboration Timeline v1"
description: Retained technical reference; applicability follows the implementation stage described in this document.
---

::: info Historical engineering record
This page preserves the design, plan or acceptance evidence for its recorded implementation stage. Earlier behavior, proposed capabilities and old deployment settings do not supersede the [current Workspace guide](/inspector.html) or [release history](/changelog.html).
:::

<div id="技术参考-collaboration-timeline-v1" class="doc-anchor" aria-hidden="true"></div>

# Collaboration Timeline v1

Observe formal Default Collaboration facts without changing dispatch, receipt transitions, prompts, terminal IO, notifications, or user workflow. The user authorizes autonomous design, implementation, checks, review, PR and merge.

## Design

The existing Task Record only holds the latest cooperation snapshot; Runtime Events do not contain the formal round history. Store an additive `collaborationEvents` array in that same atomic Task Record transaction. Reuse cooperation revision as the monotonic event identity. Each event has taskId, roundId, revision, timestamp, source agent, previous status, status and a sanitized short summary. Record only successful dispatches and new formal status transitions. Summary edits retain existing receipt semantics but do not create transitions. Lifecycle writers preserve the persisted array, including restart/reset. Never backfill unverifiable legacy history or derive facts from terminal activity. Existing workspace-message response shape and transitions remain unchanged.

Expose history via the existing selected Workspace Task API, excluding arrays from task list responses to keep polling lightweight. Default-collaboration detail uses a collapsed native details element above the terminals, a bounded scroll area and round filter (current/all/explicit historical). Show exact status codes, localized explanations, event time, agent and round ID. Hide in Custom and Zen. Render user content with textContent. Reuse guarded selected-task loading and add a request generation to discard same-project/task stale responses and selection ABA races.

Sanitize summaries before persistence and again on load: strip terminal controls, collapse whitespace, redact recognized credentials/private keys and credential URLs, cap Unicode text to 240 characters. No full terminal output, dispatch instruction or environment data enters history. Keep formal receipt summary compatibility.

## Implementation sequence

1. Fix the Windows baseline test: native canonical paths, callback observations asserted outside failure isolation, both actual locks checked. Preserve every original notification assertion. Verify focused notifications and cross-platform Web CI.
2. Add failing persistence tests for full flow, multiple rework rounds, duplicate/summary-only reports, concurrent processes, stale rounds, failed dispatch/persistence, session lifecycle changes, legacy/custom isolation, sanitization and fresh-process reload. Implement atomic history in workspace-task-runtime plus a small collaboration-history helper. Verify runtime, message and notification tests.
3. Add tested timeline view module, bilingual copy, default-collapsed markup and bounded CSS. Add request guards and behavioral DOM/race tests. Add modules to explicit server/package/acceptance whitelists. Verify selected-task HTTP reload and asset delivery across server restart.
4. Run npm test, npm run check:web, npm run test:package, npm run release:verify and npm pack --dry-run --ignore-scripts. Browser-check collapsed/expanded/round filtering/Custom/Zen/terminal layout. Request independent whole-branch review; fix blockers with regression tests. Push PR, inspect all CI and branch rules, then merge without publishing or version changes.

## Review focus

Atomic status/history writes and stale lifecycle preservation; no synthetic legacy transitions; privacy before truncation; duplicate formal receipts and revision gaps after summary updates; task/project ABA and overlapping refreshes; history surviving restart and package installation; Custom/Zen/PTY/SSE/notifications remain independent.
