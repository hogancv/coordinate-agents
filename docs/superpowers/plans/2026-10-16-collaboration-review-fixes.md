# Collaboration review fixes

Fix the two reported P2 issues in the current checkout. Keep cooperation revision semantics and preserve every recorded event.

1. Reproduce foreign/missing/invalid Session cwd in Default and Custom detail/list reads. Reuse `sessionBelongsToTask` in the view, fail closed and omit untrusted lifecycle evidence. Run collaboration health and runtime tests.
2. Keep at most 128 recent events in Task JSON. Move older events into immutable 128-event pages under `.agent-bus/workspace-tasks/collaboration-history/<taskId>/`. Store a constant-size committed page count, event count and last archived revision in Task JSON. Under the existing config lock, write pages before atomically committing the Task pointer; unreferenced pages from interrupted writes are harmless and may be overwritten on retry. Preserve archive metadata in stale lifecycle writes. Migrate legacy arrays on their next successful write without inventing events.
3. Let `readWorkspaceTask(root, id, { historyPage })` retrieve a bounded archive page. Forward the optional query through the selected-task API. Expose archive counts and a previous-page cursor. Add explicit older-history loading with task/project request guards, deduplicate revisions during polling, and localize the controls. Remove archive pages only when their archived Task is explicitly cleared.
4. Verify long/rework histories, summary revision gaps, migration, duplicate reports, restart, failures before the Task commit, pagination isolation, invalid cursors/paths, UI loading races and cleanup. Run focused regression tests and `npm test`, then review the diff.

Review focus: no event loss or renumbering; archive files never scanned by normal polling; failed writes cannot advance committed archive pointers; foreign Session state cannot change task health; stale UI page requests cannot attach to another selection; explicit archive cleanup remains contained.

## Verification

- `npm test`: 332 passed, 1 skipped, 0 failed.
- Focused collaboration persistence, timeline, health and archive tests: 41 passed.
- Workspace Task runtime and workspace-message tests: 29 passed.
- Independent read-only code review: no actionable findings.
- Accepted limits: legacy arrays migrate on the next successful Task write; polling can move earlier visible events behind explicit pagination, with all recorded history preserved.
