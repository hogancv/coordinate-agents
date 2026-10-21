---
layout: page
title: Web Workspace guide
description: Use default and custom coding-agent terminals, Git Changes review feedback, collaboration timeline and health, notifications, projects, and persistent sessions.
---

# Web Workspace guide

This guide describes the **current source checkout**. npm `latest` was 3.0.1
when checked on 2026-10-20; Git Changes/review feedback, Custom Terminals,
notifications, Collaboration Timeline, and Collaboration Health were added
after that release. See [Getting started](./getting-started.html) to choose
between the published package and source.

## Start and select a project

```sh
# Published Web package
npx @hogancv/coordinate-agents@latest web --root "/path/to/project" --port 3000
# Current checkout, after npm ci
node bin/coordinate-agents.mjs web --root "/path/to/project" --port 3000
```

Open the printed localhost URL. `--port 0` selects a free port. A merge to main
does not publish npm. The server listens on `127.0.0.1` and, when available,
the same port on `::1`.

The startup folder is registered and selected automatically. Git subdirectories
resolve to the repository root. Ordinary startup folders initialize Git and
Workspace storage without a commit; symlinked roots are rejected. **New project**
can browse a local folder or accept its path, with confirmation before initializing
an ordinary folder. Unavailable registered directories remain visible for diagnosis.

The sidebar groups tasks by project. Switching projects keeps background sessions
running and restores the last selected task. Search filters project names and
loaded/cached task titles; projects whose tasks have not loaded are identified.
Clear search or press Escape to restore the prior expansion state.

## Default Collaboration

**New task → Default Collaboration** creates fresh Codex and Antigravity
Sessions, waits for readiness, and delivers the Web role prompts. There is no
separate requirements form: type your request in Codex.

Codex clarifies the requirement, sends implementation goals and acceptance
criteria to this task's Antigravity, waits for a receipt, then reviews the real
diff and validation. Antigravity reports `WORKING`, implements, then reports
`DONE` or `FAILED`. Codex reports `REVIEWING`, followed by `APPROVED` or
`CHANGES_REQUESTED`; requested corrections start a new round.

Current role prompt version is `2.3.0-web-lite-3`. Prompts initialize with one
short acknowledgement and no tools. They do not automatically invoke Skills,
scan Agent Bus, recover old Tasks, discover plugins, or create Task Graphs.
They prohibit commit, push, and release without user authorization and remain
behavioral guidance: this is **not an enforced state machine** or sandbox.

The task-supplied `workspace-message.mjs` helper supports `send`, `read`, `wait`,
`report`, and `changes`. Agents should use the exact helper path supplied in
their prompt. It verifies the saved task/agent/session binding; it does not find
a different task's most recent Session. Waiting uses a cursor and cooperation
revision. A timeout is pending and does not authorize resending.

**Workspace task status describes terminal lifecycle, not implementation or
review completion.** Cooperation states are agent reports, not independently
verified results. Ordinary terminal output and `idle` do not establish completion.
Web task records are separate from structured Tasks and Task Graphs.

Web groups share the bound repository; creating a group does not
create an isolated Git worktree. Avoid conflicting concurrent modifications.

### Reopen a closed conversation

A closed Default task shows a reopen icon immediately after its Closed status.
Click it to open the native Conversation ID dialog. The form overlays the Workspace
and does not reduce terminal space. After resuming, return to the terminals to run
`/status`; use the temporary Awaiting confirmation entry in the header to reopen
the identity confirmation step. That entry disappears after confirmation.
See [Codex conversation resume](./codex-conversation-resume.html).

## Custom Terminals

Choose **New task → Custom Terminals** to launch two independent Generic CLI
Sessions bound to the task and their terminal slots. The same command can be
used twice. Executable fields accept names or absolute paths, without inline
arguments or shell syntax; no shell command is evaluated by those fields.

Project defaults are saved atomically in `.agent-bus/workspace-custom.json`.
Each task snapshots its two commands and optional prompts, retaining that
snapshot across restarts. The shared prompt is limited to 8 KB UTF-8; each
terminal prompt to 4 KB. Saving defaults updates untouched command fields in
an open creation dialog while preserving temporary overrides.

Use each terminal's **Project Prompt** button to preview the shared and terminal
prompts, separated by `---`. Copy them, or explicitly confirm that the target
CLI is ready and supports multiline bracketed paste before sending. Readiness
of an unknown CLI is not inferred. Sending reserves the keyboard queue and
uses one raw Session write with a final Enter; uncertain delivery is not retried.
Closing the preview during preflight cancels a pending send. Dispatched input
cannot be recalled.

Custom mode does not inject the default roles, create collaboration rounds, or
enable Send to Codex review feedback. Git diff viewing/copying remains available.
Environment checks use the selected Custom task's command snapshot; without a
selected Custom task, checks use the default pair.

## Terminals and session lifecycle

Keyboard input, Enter, arrows, and Ctrl-C are sent as ordered raw terminal data.
Output uses resumable cursors and bounded polling; it is not reconstructed into
a chat transcript. The visible area drives `sessionResize`.

Drag the divider to change the split between 25% and 75%; double-click restores
50:50. The saved ratio survives refresh. Focus enlarges one terminal without
restarting it; restore returns to the saved split, and switch focuses the other.
Zen mode keeps the terminal controls. Narrow screens stack the terminals.
The UI supports Simplified Chinese and English.

Page load, task selection, and refresh never launch or retry agents. Refresh
reconnects to the saved independent Session Hosts. Close ends the selected
pair; restart creates two new Sessions and retains previous closed records.
Close all terminals applies only to the selected project. Startup failures
trigger owned-pair cleanup and a bounded error, not an automatic retry.

Closing the browser or pressing Ctrl-C in the Web server is not a terminal-close
operation. Use explicit close controls to stop agents. Session Runtime owns
only the processes it creates and does not attach to arbitrary PIDs.

Native PTY availability is platform/Node dependent. Node 18 keeps an owned-stdio
fallback. On Windows Node >=20, the runtime probes native PTY startup and real
TTY behavior in a disposable detached Session Host. Fallback is selected only
after owned-process cleanup is confirmed; actual Session failure never retries
a task automatically. Diagnostics expose `backend`. Stdio fallback cannot
provide full TUI behavior or child-observed resize.

## Workspace settings

Settings has three tabs with independent saves. Saving keeps the dialog open;
switching tabs retains unsaved edits. The fixed footer shows Close and the
active tab's save button.

| Tab | Scope and effect |
| --- | --- |
| Default Collaboration | `codex` and `agy` executable overrides, optional Codex model/reasoning. Applies to new launches and restarts; model choices use the local model cache. |
| Custom Terminals | Two executable defaults and shared/per-terminal prompts. New tasks snapshot them; existing Custom tasks keep their saved snapshot. |
| Desktop Notifications | Project-level notification preferences, read on the next formal receipt. |

Antigravity defaults to standard permission prompts, with an option in Workspace
settings to enable `--dangerously-skip-permissions` for automatic approval of tool requests.
Explicit saved argument arrays override the default; running Sessions retain their launch arguments.

Default terminal settings preserve unrelated arguments and use project > user >
adapter-default precedence. They do not reconfigure running CLIs. Executable
availability does not establish login, model access, provider health, or quota.

## Git Changes and review feedback

The Changes drawer shows bounded working-tree Git status and diffs. It includes
pre-existing user edits and does not attribute every change to an agent. A clean
working tree does not disprove changes already committed; inspect those commits
separately. This view is not a history review or isolated per-round diff.

In Default mode, select diff lines, add notes, and review the feedback preview.
Before each send, confirm Codex is at a blank input prompt. A successful send
clears that confirmation; editing previously sent feedback requires confirming
again. The preview is bounded to 40 selected lines and 8 KB.

Switching files, refreshing the diff, or closing the drawer during preflight
cancels pending feedback before terminal input is dispatched. Input already
sent cannot be recalled. Sending notes does not itself record approval or
prove that Codex acted on them. Custom tasks can view/copy diffs, but cannot
use this Codex-specific handoff.

## Collaboration Timeline

Expand the normally collapsed panel above Default Collaboration terminals to
view persisted `SENT`, `WORKING`, `DONE`, `REVIEWING`, `CHANGES_REQUESTED`,
`APPROVED`, and `FAILED` events. Entries include time, source agent, round ID,
transition, and a redacted short receipt. Filter current, all, or a specific
past round.

`SENT` confirms input dispatch only; the other states are formal reports from
agents. The panel does not independently verify results or dispatch, retry, or
review work. It is hidden in Custom mode and Zen mode. History survives page
refresh, Workspace restart, and terminal-pair restart. History not recorded by
earlier versions cannot be reconstructed.

Clearing archived tasks also removes their stored timeline.

## Collaboration Health

Task-list hints and the panel beside the timeline show waiting for a `WORKING`
receipt, quiet implementation/review, `DONE` awaiting review, formal `FAILED`,
and linked Session exits, failures, or unavailable records. Silence means a
lack of observable evidence, not proof that an agent is stuck or failed.

The attention threshold defaults to 30 minutes and can be set to 1–10080 minutes,
saved in the current browser. New formal receipts reset the timer, including
same-status progress summaries; identical duplicate reports retain idempotent
behavior. Closed/archived tasks and prior terminal pairs have no active hints.
Custom mode shows Session facts only.

Health uses ordinary Workspace refresh. It does not send system notifications,
resend instructions, create rounds, restart sessions, or change cooperation state.

## Desktop notifications

Supported on Windows 10/11 and macOS; Linux reports unsupported. In settings,
enable notifications for the current project and save the Notifications tab.
Notifications start disabled. `APPROVED` and `FAILED` are selected by default;
`DONE` is optional. The fixed **Send test notification** action does not create
a task or change cooperation. OS acceptance does not establish visible delivery;
check system permissions and Focus / Do Not Disturb if nothing appears.

Only validated, persisted Default Collaboration receipts trigger notifications.
They are dispatched from `workspace-message report`, independently of browser
connections. The browser can be closed while the backend, agents, and interactive
OS session keep running. Custom output, idle, Session exit, task close/restart,
and archive are not notification events.

Windows uses PowerShell 5.1 and WinRT Toast. On first enabled dispatch or test,
it creates a per-user Coordinate Agents Notifications Start Menu shortcut with
AppUserModelID `CoordinateAgents.Workspace`; no admin access or third-party
service is required. macOS uses `/usr/bin/osascript` with fixed script and
separate arguments. OS policy controls sender permissions and display.

Preferences live in `.agent-bus/workspace-notifications.json`; the bounded
ledger under `.agent-bus/notifications/` claims project/task/round/status before
OS dispatch. Attempts are at most once, including failures; a crash after claim
can lose a notification. Summary edits do not resend; a new round can notify
again. Notifications contain sanitized project/task labels, not prompts, output,
receipt summaries, or absolute paths. The ledger is capped at 4096 claims and
reclaims deleted-task entries; otherwise it reports capacity instead of risking
duplicates. Dispatch failures do not change the task receipt. Automated tests
mock native dispatch and do not prove real on-screen delivery.

## Storage and archives

The user configuration directory holds the locked, atomically written
`workspace-projects.json` registry. Each project keeps its own `.agent-bus/`:

- `.agent-bus/workspace-tasks/<id>.json`: Web task identity, mode, terminal bindings, and cooperation facts.
- `workspace-custom.json`: Custom defaults; tasks retain their own snapshots.
- `workspace-notifications.json` and `notifications/`: notification preferences and dispatch facts.
- Session Runtime records and bounded terminal output.

Right-click a task or project to archive it, close its terminals, and hide its
records while keeping project source files. Archived projects remain hidden
across refresh/restart; explicitly re-adding the folder restores the project
entry. Settings offers permanent clearing of archived conversations across all
registered projects. This removes their stored history, including timelines.

Web records are distinct from `.agent-bus/tasks/` and `.agent-bus/task-graphs/`.
The Web UI does not display, migrate, or delete those structured records.

## Local HTTP boundary

The page supplies a per-launch capability in `meta[name="coordinate-agents-capability"]`.
Requests send it as `x-coordinate-agents-capability`. The gateway checks loopback
Host/Origin, capability, bounded JSON, allow-listed actions, and repository binding.
Project APIs resolve their own project; browser tabs do not change a server-global
selection. `POST /api/action` handles explicit mutations such as task creation,
terminal input, resize, settings, and archiving.

The default Web API serves Workspace task/settings/health, repository/diff, and
bound Session data. It does **not** expose structured `/api/tasks`, `/api/graphs`,
Task Graph actions, or MCP. Those remain separate source/Plugin surfaces.
A capability protects local requests; it is not multi-user authentication.

## Read-only Inspector and structured workflows

The retained Inspector is a separate read-only UI, not the current Web Workspace:

```sh
node bin/coordinate-agents-legacy.mjs inspector --port 3001
# Older published CLI, pinned explicitly:
npx @hogancv/coordinate-agents@2.4.0 inspector --port 3001
```

It is absent from npm 3.x. See [Structured workflow](./structured-workflow.html),
[Session Runtime](./session-runtime.html), and [Event Journal](./event-journal.html)
for the corresponding contracts.

## Security

Keep the service on loopback; it has no cloud sync or multi-tenant mode.
Agent commands and wrappers are trusted local executables with their configured
permissions. HTTP root checks do not sandbox agent shell commands or prevent
repository edits. `.agent-bus/` is local plaintext; bounded redaction is not a
secret store. Do not put credentials in prompts, receipts, or diagnostics.
See [Security](./security.html) before sharing data.
