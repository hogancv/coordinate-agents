# Workspace archive follow-up — 2026-10-08

## Behavior

- Right-click a historical conversation: archive it, close its owned terminal pair, retain records and hide it from the sidebar.
- Right-click a project heading: archive its conversations and hide the entire project. Source files remain. Archived folders remain hidden across refresh/server startup; explicit re-add restores the folder entry while conversations remain archived.
- Settings: one-click permanent clearing of archived Workspace Task records and all owned Session transcripts, including Sessions older than the 32-entry retained restart history. Active/unarchived conversations, other-task Sessions and project source remain.
- Global archive cleanup remains available with no active projects or with an unavailable selected project. Unavailable directories are reported and skipped rather than recreated or recursively deleted.
- Context menus support right-click and Shift+F10; Escape restores focus. Unchanged sidebar rows stay mounted during refresh.

## Validation

- `node --test test/workspace-archive.test.mjs`: 10/10 passed, including running mock pair close, restart-history transcript deletion, ownership/path protection, unavailable folders, startup persistence and independent global settings status.
- Focused UI/HTTP regression: 29/29; broader Web/legacy gateway/message regression: 43/43.
- Final package/Workspace integration regression: 35/35 passed.
- `npm run test:full`: 384/384 passed, using an isolated home and offline fixtures.
- Actual `npm pack --ignore-scripts` tarball installed in an independent consumer passed dual-terminal, role, message, resize, project, reconnect/restart, archive and archive-clear checks. See [artifact verification](workspace-archive-verification.json).
- Current tarball: 232,097 compressed bytes, 911,380 unpacked bytes, 42 files. File whitelist and production dependencies remain unchanged; no Plugin/Graph/MCP payload added.
- Real Chromium browser QA used two isolated projects: right-click conversation/project archive, settings clear, all-projects-archived empty state, reload persistence, explicit folder re-add, stable refresh rows, keyboard focus restoration, and global cleanup while selected directory was unavailable. Source-marker files survived archive/clear. Test browser space and server were closed.
- No real-user records were archived or cleared and no paid model was called. Source-file deletion for the unavailable-folder scenario was performed only by the test fixture setup, not by the application.

The live localhost:3000 HTTP server was previously running the old checkout under Documents/Codex. It was restarted with the implementation from /Users/hezai/Desktop/code/coordinate-agents, preserving its original startup project. Detached Session Hosts were not terminated by this HTTP restart. The live page now serves archive controls and its guarded archive-status API responds successfully. Refresh the existing browser page to load the new UI.

Validation was local macOS/Node 24. Windows/Linux hosted CI was not dispatched. The in-process operation queue serializes lifecycle requests within one HTTP server; no claim of coordinating simultaneous independent server processes is made. No npm publish, tag, push, Release or workflow dispatch was performed during feature validation. The user subsequently requested committing and pushing the source changes only.
