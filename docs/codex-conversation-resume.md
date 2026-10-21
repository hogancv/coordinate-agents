# Resume a Codex collaboration conversation

Default Collaboration keeps Codex as the continuing planner/reviewer. Closing a
Task stops its owned terminals while retaining the Task, Git workspace, native
Codex binding and collaboration timeline. **Restart Pair is not Resume.** Once a
Task has a native binding or reserved Resume target, fresh-pair restart is refused
before closing terminals: use Reopen for its original conversation, or create a
new Task for a new context. Unbound Tasks and Custom Terminals retain fresh restart.

## First binding and continuing later

1. Create a Default Collaboration Task. With a supported local Codex CLI 0.163.x,
   the header first shows **Identifying conversation**, then **Conversation saved**.
   No `/status` or UUID input is needed to save the original conversation.
2. Close the Task. The **Reopen task** icon appears immediately after its **Closed**
   status in the header. Clicking it directly resumes the saved conversation.
   If automatic capture was unavailable and the Task has no binding, a recovery
   dialog accepts the original native UUID, then **Resume Conversation / 继续对话**. The native record
   must exist locally and belong to this project and a primary Codex CLI conversation.
3. Complete the CLI's normal login, trust and startup screens. Once both terminals
   are ready, the task can dispatch and review immediately, without `/status` or
   manual confirmation. Tasks saved by older versions in Awaiting Confirmation
   also become ready based on their current terminal state.
4. Resume does not send old role prompts or replay history. Custom and archived
   Tasks do not expose the native conversation recovery entry.

Failed or partial pairs also expose the recovery entry. A failed direct reopen
opens the fallback with the saved UUID prefilled. The dialog supports Escape, its close button, and clicking the backdrop. Switching
projects or Tasks dismisses it. Opening or dismissing
it does not resume a CLI; **Reopen task** or the dialog's explicit action starts recovery.

Resume uses the validated original UUID and current owned runtime. Automatic
binding uses a process-scoped native startup event plus exact primary CLI metadata.
A wrong target, project mismatch, conflicting original binding or another Task's
reserved UUID is refused; no replacement blank Codex conversation is silently created.
Readiness allows collaboration without claiming continuous native identity verification.

Running `/new` or switching conversations inside the same TUI may leave the
Runtime Session ID and generation unchanged. When a supported native event and
primary record expose a different UUID, the task latches an identity conflict
and blocks new dispatch/review. Event export is asynchronous, so detection is not
immediate or guaranteed. Stop collaboration after switching and inspect the
original task binding. A latched conflict cannot be cleared by entering a different UUID.

The configured built-in Codex adapter, user command/wrapper, authentication,
model/permission options and native TUI/PTY remain in use. Safe ordinary CLI
options and Node entry-script prefixes are preserved. Ambiguous positional,
prompt, remote, target and worktree options are refused for Resume. No `--last`,
private CLI profile or global CLI configuration rewrite is used. Native target
records are read from the effective `CODEX_HOME` or normal `~/.codex` sessions
and archived_sessions directories. Records are not moved between project paths.

Auto-binding leaves Hooks disabled and uses a dedicated local CLI process
(`--no-daemon`) with an in-memory loopback OTLP receiver. Its startup config sends
OTEL logs to that receiver for this invocation, overriding a configured log exporter;
prompt/response logging is disabled. Trace/metric exporters, native notifications,
model settings, permissions and login are retained. Nothing is written to global
Codex configuration. Unknown CLI versions, remote runtimes, unsupported provenance,
missing/ambiguous records or capture failure retain manual recovery. No newest-file
selection or unbounded polling runs. See the [source/trust and native acceptance notes](codex-native-auto-binding.md).

## Executor and interrupted work

An existing healthy, correctly owned Antigravity Session is reconnected. Otherwise
a fresh Session uses the existing adapter, real user settings and proxy wrapper
(including agy-proxy arguments/environment). Only the current executor role and
Workspace helper are initialized. Old implementation instructions are not replayed.
If executor startup fails, Codex remains available; Resume retries the missing
executor. If role injection was interrupted, close and resume to replace that
executor rather than retrying an uncertain write.

Resume keeps roundId, Cooperation Revision and Timeline. An interrupted round is
shown for inspection, including uncertain dispatch delivery. Resume presentation
is derived from the current recorded Session Facts on reads: an exited Codex no
longer displays READY, while the persisted recovery and confirmation history is
retained. This is not a new live process or native identity probe. Codex checks Git
Changes and prior records and decides when to send a new instruction. A new
executor cannot report completion of a prior executor's round. Resumed helpers
require the current owned Task/slot/Session/runtime generation inherited from the
CLI environment; old runtime operations and missing claims are rejected. These
claims are local runtime fences, not an OS-user security boundary.

While Codex is being recovered, an unchanged,
active Antigravity Session may still report WORKING/DONE/FAILED for its existing
round. Task/slot/Session/generation, round ownership, legal transitions and the
current Cooperation Revision are checked under the same lifecycle transaction.
Duplicate receipts remain idempotent. This exception does not permit new dispatch,
Codex review, archived/closed Task writes, old executors or wrong rounds; new
Codex instructions and review require its current owned runtime and completed startup.

Archived Tasks remain unavailable. Concurrent lifecycle and collaboration writes
serialize through the existing Task lock; dead-owner recovery uses an elected
reaper, never lock age. Startup intent is persisted before launching processes;
after a backend crash an exact owned pending Session can be adopted, while an
ambiguous orphan requires inspection. No automatic dispatch retries run.

## Validation boundary

Automated tests use deterministic native-record and CLI fixtures through the real
Session Host. They establish argument, ownership, lifecycle, concurrency, HTTP/UI
and package behavior; they do not establish model memory. Separate [macOS native CLI evidence](diagnostics/codex-conversation-resume-macos.md)
records live conversation memory, executor completion and WORKING interruption. Windows CI storage/PTY checks do
not claim Windows 10 native CLI Resume acceptance.
