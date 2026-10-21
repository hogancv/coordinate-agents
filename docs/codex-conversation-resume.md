# Resume a Codex collaboration conversation

Applies to the source implementation at **`f9f0210` and later**, checked on
2026-10-21. `package.json` still says **3.0.1**; this is a source-commit boundary,
not a claim that npm 3.0.1 contains this flow. Earlier designs and acceptance
records describe an additional manual-confirmation stage; see [historical scope](#historical-scope).

Default Collaboration keeps Codex as the continuing planner/reviewer. Closing a
Task stops its owned terminals while retaining the Task, Git workspace, native
Codex binding and collaboration timeline. **Restart Pair is not Resume.** Once a
Task has a native binding or reserved Resume target, fresh-pair restart is refused
before closing terminals: use Reopen for its original conversation, or create a
new Task for a new context. Unbound Tasks and Custom Terminals retain fresh restart.

## Action table

| Action and entry | Conditions and scope | Terminal behavior | Retained state and next step |
| --- | --- | --- | --- |
| Reconnect terminals — browser refresh/reconnect | Existing Session Hosts are still running | Reattaches browser terminal views to the same sessions; does not launch native Resume | Retains the existing sessions and available output; disconnected output is bounded, not guaranteed complete history |
| New task — **New task** | Current project; Default Collaboration or Custom Terminals | Opens fresh task-bound terminals; Default initializes both roles | Creates a new Task/context; does not restore another Task's conversation |
| Close task — red power icon | Selected task; the Web asks for confirmation | Stops that Task's owned terminals | Keeps Task, Git workspace, binding/reserved UUID, rounds and Timeline; closing does not dispatch work |
| Close all terminals — brand power icon | Current project only; the Web asks for confirmation | Closes each non-closed Task's terminals in that project | Same retention as Close task; does not affect other projects |
| Reopen task — recovery icon / fallback **Resume Conversation** | Unarchived Default task in CLOSED, EXITED, DEGRADED or ERROR; requires an exact valid original UUID and no latched conflict | Reuses valid active slots; starts a missing Codex with `codex resume <uuid>` and a missing executor with a fresh session | Preserves Task, Git changes, binding/target, rounds and Timeline; completes normal terminal startup, then becomes ready without manual identity confirmation |
| Recover executor — the same recovery icon with a different label | Default task with live owned Codex and inactive/missing Antigravity; same UUID validation as Reopen | Keeps the existing Codex session/generation; opens only the missing executor and initializes its current role/helper | Does not restore Antigravity's old conversation or replay old instructions; replacement executor cannot complete its predecessor's round |
| Continue startup — automatic Web refresh / `workspaceTaskContinue` | Existing Default task in STARTING or AWAITING_INPUT | Rechecks the existing terminals after login/trust; continues initialization | Does not create a new conversation; uncertain role injection is an error, not permission to resend |
| Restart Pair — `workspaceTaskRestart` runtime/HTTP operation, no separate current Web button | Unbound/unreserved Default tasks, or Custom Terminals; archived tasks refused | Closes old terminals and opens fresh sessions; bound/reserved Default tasks are refused before closing | Retains Task/workspace/history, resets the current cooperation state for Default tasks; a new context is not native Resume |
| Archive task — task context menu | Selected unarchived Task | Closes owned terminals and hides the Task | Keeps records until explicit archive-data deletion; archived tasks cannot reopen |

**Ready** requires both associated Task/slot/Session/generation owners to be
active, both startup slots to be `READY`, and no latched Codex identity conflict.
An inactive Codex or conflict yields `FAILED`; an inactive executor or incomplete
terminal startup yields `PARTIAL`. A pending launch can remain `STARTING`; a
closed/archived Task is shown as `CLOSED`. `AWAITING_CONFIRMATION` is accepted
when reading old data, but is not a current user step or readiness prerequisite.
Task lifecycle and these recovery states do not prove implementation completion.

The UUID dialog supplies a recovery target; it is not a post-resume verification
gate. Close confirmations, CLI login/trust prompts, Custom Prompt readiness and
review-feedback send confirmations remain separate operations. These are Web
Workspace Task actions, distinct from the Legacy structured `task resume` command
described in [structured workflow](structured-workflow.md).

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
longer displays READY, while persisted recovery metadata and legacy confirmation
history are retained. This is not a new live process or native identity probe. Codex checks Git
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

Archived Tasks remain unavailable. Resume preparation and final commit use the
existing Task lock, while slow CLI launch/readiness runs outside it so the current
executor can report its round. Identity/receipt commits retain their existing
ownership checks. Dead-owner recovery uses an elected reaper, never lock age.
Startup intent is persisted before launching processes;
after a backend crash an exact owned pending Session can be adopted, while an
ambiguous orphan requires inspection. No automatic dispatch retries run.

## Validation boundary

Automated tests use deterministic native-record and CLI fixtures through the real
Session Host. They establish argument, ownership, lifecycle, concurrency, HTTP/UI
and package behavior; they do not establish model memory. Separate [macOS native CLI evidence](diagnostics/codex-conversation-resume-macos.md)
records live conversation memory, executor completion and WORKING interruption. Windows CI storage/PTY checks do
not claim Windows 10 native CLI Resume acceptance. The cited native acceptance
reports are historical results, not fresh acceptance of the current readiness policy.

## Historical scope

| Document | Applicable implementation | How to use it now |
| --- | --- | --- |
| [Resume v1 design](superpowers/specs/2026-10-20-codex-conversation-resume-design.md) and [implementation plan](superpowers/plans/2026-10-20-codex-conversation-resume.md) | 2026-10-20 Resume v1; manual-confirmation phase before `f9f0210` | Design history; the old post-resume `/status` confirmation is superseded by the action table above |
| [Native identity store v1](native-conversation-identity-store.md) and [store plan](superpowers/plans/2026-10-19-native-identity-store.md) | PR #137 storage-only phase, before native Resume and automatic capture | Storage/CAS history; not the current source-registration, restart or recovery guide |
| [Automatic-binding plan](native-auto-binding-plan.md) | `5fad370`, automatic binding with the former confirmation stage | Historical source/transport decisions; does not reintroduce a confirmation UI |
| [macOS Resume acceptance](diagnostics/codex-conversation-resume-macos.md) | 2026-10-20, Codex CLI 0.162.1 and Resume v1 | Evidence for that tested flow only |
| [Native capture acceptance notes](codex-native-auto-binding.md#independent-native-acceptance) | 2026-10-21, CLI 0.163.0, automatic-binding stage before `f9f0210` | Historical native transport evidence; distinguish it from current readiness regressions |

These phases share the source package version 3.0.1. Commit/stage and native CLI
versions identify applicability; they are not distinct npm release claims. The
backend retains `workspaceTaskConfirmConversation` for compatibility and explicit
manual attestations, but the current Web has no confirmation entry and readiness
does not depend on that endpoint.
