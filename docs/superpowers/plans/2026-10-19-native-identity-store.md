# Native Conversation Identity Store v1 implementation plan

**Goal:** Persist optional Task/Slot native identity facts without native capture,
Resume or changes to cooperation and input behavior.

**Design:** Keep Task schemaVersion 1. Add optional `nativeConversations` keyed by
the two default slots, plus optional runtime generation on slot associations.
An immutable original binding, first conflict, latest observation and identity
revision are durable facts. Current verification is never deserialized from disk:
all ordinary views return UNAVAILABLE because this release registers no sources.
Session Manager mints a generation per fresh Session; Host preserves it. Legacy
Sessions without a generation remain usable, but cannot accept identity events.

An internal store factory takes a trusted-code attestation verifier; there is no
HTTP, CLI, workspace-message, environment or project-config source registration.
The default verifier rejects every event. Tests inject an opaque deterministic
authority into a separate store instance, never into the production receiver.
An arbitrary event cannot claim its own trust by naming a source or setting a flag.
This is a local trusted Runtime code boundary, not protection against malicious
same-user code that can directly rewrite the Task files.

Accepted claims must match canonical project, Task, default Slot, actual Session
owner/adapter, active lifecycle and runtime generation. Expected identity revision
and increasing per-runtime sequence are checked under the existing config lock.
The same adapter/native UUID cannot be newly bound by a second Task in a project.
An existing binding is never replaced, even after Restart. Conflict retention is
coalesced: original binding, first conflict and latest accepted observation remain.
No unbounded new history or Timeline events are introduced.

## Implementation and verification

- [ ] Task 1: Add deterministic failing tests for the schema, trusted-entry,
  binding immutability, source rejection, generation/revision/sequence CAS,
  ownership, privacy, persistence and concurrent process writers.
- [ ] Task 2: Implement focused identity validation/transition module and locked
  Task store integration. Preserve current identity facts in all lifecycle writers
  so stale Close/startup/cooperation snapshots cannot erase them.
- [ ] Task 3: Preserve Session generation and adapter through Manager/Host records,
  associate default Task slots, expose observation-only UNAVAILABLE views and test
  real Session/Task lifecycle, legacy records, Close and Custom behavior.
- [ ] Task 4: Package the modules, run core, Web/shared regressions and Package
  Acceptance. Independent Code Review focuses on source trust, project/Task/Slot
  isolation, generation/revision races, stale lifecycle writes and restart reads.
  Fix findings, create PR, run cross-platform CI and merge only with required
  checks green and no unresolved blocking review findings.

**Global constraints:** No CLI argument/profile/hook/bridge changes; no new input
or cooperation protocol/status/Revision/round/Timeline semantics; no version bump,
publication, Release or large dependencies. Native-source verification is outside
this deliverable and does not block the store.

**Review focus:** copied identity data across projects; same-source events from a
different Task or Slot; a verifier finishing after Restart or Close; concurrent
first binding versus stale lifecycle writes; edited records pretending to persist
current VERIFIED state. Each has a deterministic storage/runtime test.

**Execution:** Native implementation in the isolated worktree, then independent
whole-branch Code Review. The user's explicit implementation/PR/merge instructions
authorize continuing without additional design approval handoffs.
