# Resume a Codex collaboration conversation

Default Collaboration keeps Codex as the continuing planner/reviewer. Closing a
Task stops its owned terminals while retaining the Task, Git workspace, native
Codex binding and collaboration timeline. **Restart Pair remains a destructive
fresh pair restart; it is not Resume.** Custom Terminals keep their separate flow.

## First binding and continuing later

1. In the Task's Codex terminal, finish normal trust/login/startup and run `/status`.
2. Copy the exact **Session** UUID to **Codex Conversation ID**. Check **Directory**
   is this project's canonical path. Check the manual confirmation box and choose
   **Confirm conversation**. This binds the original native ID to this Task.
3. Close the Task. Later select the same closed/exited Task and choose
   **Resume Conversation / 继续对话**. If the Task has no previous binding, supply
   its exact native UUID explicitly. The native record must exist locally and
   belong to this project and a primary Codex CLI conversation.
4. Complete the CLI's normal startup screens, run `/status` again in the new
   Codex terminal, and check UUID **and** Directory before confirming the live
   conversation. Resume does not send the old role prompt or any history.

This v1 path uses **manual live confirmation**. Exact local metadata, launch
arguments, a running process and historical bindings do not automatically verify
which native conversation the TUI loaded. The UI shows awaiting confirmation,
manually confirmed, partial recovery and failed recovery distinctly. There is no
automatic main-conversation identity collector in this release. A wrong target,
project mismatch, conflicting original binding or another Task's reserved UUID
is refused; no replacement blank Codex conversation is silently created.

The configured built-in Codex adapter, user command/wrapper, authentication,
model/permission options and native TUI/PTY remain in use. Safe ordinary CLI
options and Node entry-script prefixes are preserved. Ambiguous positional,
prompt, remote, target and worktree options are refused for Resume. No `--last`,
private CLI profile or global CLI configuration rewrite is used. Native target
records are read from the effective `CODEX_HOME` or normal `~/.codex` sessions
and archived_sessions directories. Records are not moved between project paths.

## Executor and interrupted work

An existing healthy, correctly owned Antigravity Session is reconnected. Otherwise
a fresh Session uses the existing adapter, real user settings and proxy wrapper
(including agy-proxy arguments/environment). Only the current executor role and
Workspace helper are initialized. Old implementation instructions are not replayed.
If executor startup fails, Codex remains available; Resume retries the missing
executor. If role injection was interrupted, close and resume to replace that
executor rather than retrying an uncertain write.

Resume keeps roundId, Cooperation Revision and Timeline. An interrupted round is
shown for inspection, including uncertain dispatch delivery. Codex checks Git
Changes and prior records and decides when to send a new instruction. A new
executor cannot report completion of a prior executor's round. Resumed helpers
require the current owned Task/slot/Session/runtime generation inherited from the
CLI environment; old runtime operations and missing claims are rejected. These
claims are local runtime fences, not an OS-user security boundary.

Archived Tasks remain unavailable. Concurrent lifecycle and collaboration writes
serialize through the existing Task lock; dead-owner recovery uses an elected
reaper, never lock age. Startup intent is persisted before launching processes;
after a backend crash an exact owned pending Session can be adopted, while an
ambiguous orphan requires inspection. No automatic dispatch retries run.

## Validation boundary

Automated tests use deterministic native-record and CLI fixtures through the real
Session Host. They establish argument, ownership, lifecycle, concurrency, HTTP/UI
and package behavior; they do not establish model memory. Separate macOS native
CLI evidence is recorded after live acceptance. Windows CI storage/PTY checks do
not claim Windows 10 native CLI Resume acceptance.
