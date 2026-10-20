# Codex-Centric Collaboration Resume Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline, with an independent final review.

**Goal:** Reopen a Task's original native Codex conversation and reconnect or rebuild its executor.
**Architecture:** Existing Identity Store plus exact native resume, explicit human live confirmation, serialized lifecycle and generation-fenced helper mutations. Reuse normal adapters, PTY and proxy settings.
**Tech Stack:** Node.js ESM, native CLI/PTY, existing browser JavaScript and node:test.
**Spec:** docs/superpowers/specs/2026-10-20-codex-conversation-resume-design.md

## Global Constraints

- Preserve local uncommitted work; base on latest main.
- No --last, prompt replay, automatic dispatch, global CLI config changes or Antigravity native resume.
- Preserve Task ID, workspace, round/revision and Timeline; manual proof never labeled automatic.
- No version changes, publication or Release. GitHub via gh/git.

## Review Focus

- Wrong project/UUID, symlinked or missing native records: refuse before launch.
- Duplicate Resume and Close racing dispatch: serialize without duplicate sessions or stale commits.
- Old runtime and replacement executor receipts: generation/round ownership fences.
- Partial recovery and interrupted startup: retain valid Codex; never replay uncertain inputs.
- UI project switches, archived Tasks and Custom Terminals: owner-bound actions and unchanged behavior.

### Task 1: Explicit native target and exact launch

**Files:** new scripts/codex-conversation.mjs under skills/coordinate-agents; adapters/codex-cli.mjs; session-service.mjs; session-manager.mjs; test/codex-conversation.test.mjs.
**Interfaces:** `readCodexConversation({conversationId, root, codexHome})` returns validated target metadata; adapter `resolveSessionLaunch({conversationId})` supports exact resume with no input.
- [ ] Write failing tests for exact UUID lookup, cwd/source/missing/unsafe record rejection and safe configured resume args.
- [ ] Run node --test test/codex-conversation.test.mjs; expect missing behavior failure.
- [ ] Implement metadata preflight and transport explicit UUID through Session Manager to native adapter; refuse ambiguous configured positional/prompt/resume arguments.
- [ ] Verify targeted tests and adapter/shared baseline; commit.

### Task 2: Resume lifecycle and manual identity confirmation

**Files:** workspace-task-runtime.mjs; new workspace-resume-state.mjs; workspace-native-identity.mjs; test/workspace-resume.test.mjs.
**Interfaces:** `runtimeWorkspaceTaskResume(input)` and `runtimeWorkspaceTaskConfirmConversation(input)`; persisted resume status and generation-bound manual confirmation reuse existing identity receiver.
- [ ] Add failing runtime tests for close/resume, no Codex reinjection, duplicate Resume, archived/custom rejection, conflicts, partial executor failure and fresh manual confirmation.
- [ ] Implement under common lifecycle lock, preserve history/identity and valid partial sessions; initialize only new executor.
- [ ] Test real Session Host fixtures, identity CAS and current-generation confirmation. Commit.

### Task 3: Collaboration isolation and interrupted rounds

**Files:** session-host.mjs; workspace-message.mjs; workspace-task-runtime.mjs; workspace-resume-state.mjs; test/workspace-resume.test.mjs; test/workspace-message.test.mjs.
**Interfaces:** helper mutators carry immutable runtime caller claims from owned process environment; resumed task rejects absent/stale claims; round executor ownership controls receipts.
- [ ] Write failing tests for old/missing runtime mutation, replaced executor receipt, Close/dispatch races and unchanged cooperation history after interruption.
- [ ] Inject immutable runtime environment, fence locked mutation, record interruption without automatic transition/replay.
- [ ] Verify current Codex can dispatch a fresh round and rebuilt executor can report it; run cooperation regression. Commit.

### Task 4: Web entry, acceptance and delivery

**Files:** workspace-services.mjs; action-gateway.mjs; web-workspace app.js/index.html/i18n.mjs/styles.css; package.json files list; tests; docs/codex-conversation-resume.md.
**Interfaces:** bounded project-owned Resume and Confirm HTTP actions; simple Task-local UI.
- [ ] Write failing HTTP/UI tests for closed Task reentry, manual ID, pending/partial/success/failure, stale project actions and archive/custom exclusions.
- [ ] Implement actions/UI and package inclusion, explain manual proof and limitations.
- [ ] Run core/web/shared/package tests, real CLI A-E evidence; fix failures using regression tests.
- [ ] Independent review, PR creation/attachment, applicable CI/npm Package Acceptance; merge only if passing and no blockers. Record truthful remaining limits.
