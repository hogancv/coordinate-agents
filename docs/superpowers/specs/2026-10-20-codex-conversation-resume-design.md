# Codex-Centric Collaboration Resume v1

The user-supplied goal is the product specification: Codex retains native context;
Antigravity is replaceable. Preserve Task ID, project, timeline, cooperation facts,
user CLI configuration and proxy behavior. No new orchestration service or protocol.

## Identity and confirmation

Use the existing immutable Native Conversation Identity Store. The first shippable
source is explicit human confirmation, labeled `manual-confirmation`, never automatic
verification. A user enters an exact UUID obtained from the Codex TUI `/status`.
Read only the exact native rollout's session metadata and require matching UUID,
canonical cwd and CLI source. This preflight establishes an available native target,
not the identity of the live TUI. After launch, require a fresh human confirmation
of `/status` UUID and project, fenced by current Session ID and runtime generation.
No process-start event, historical binding or metadata lookup counts as live proof.

Unknown/conflicting IDs, copied project bindings, duplicate Task occupancy,
archived Tasks and custom terminals fail closed. A closed unbound Task may specify
an explicit target; bind it only after its live confirmation. No latest-session
guessing, private profiles, modified global CLI config, prompt replay or silent new
Codex conversation. Exact native resume uses `codex resume <uuid>` with no prompt.

## Lifecycle

Serialize Close, Resume, Restart, startup, archive, dispatch and report using the
same cross-process per-Task lock. Preserve identity CAS and atomic config writes.
Retain successful Codex sessions if executor launch fails; retry reconnects to the
same owned generation rather than opening duplicate terminals. Persist pending
resume before opening either terminal, so a crash remains inspectable and cannot
silently replay uncertain writes. Onboarding for resumed Codex never sends a role
prompt; only fresh Antigravity receives its current role and workspace helper.

Every new owned CLI process receives its immutable Session/generation/Task/slot
environment. workspace-message mutation calls carry these claims to the locked
writer. After resume, missing or stale claims cannot mutate collaboration state.
Retain original cooperation round/revision/timeline. Record interruption separately;
new executor cannot report an old executor's round. Codex decides when to send a
new instruction; starting/reconnecting terminals never resends old work.

## UI and validation

Closed/exited unarchived default Tasks remain selectable and offer Resume
Conversation, exact ID input when missing, and a short manual-confirmation action
after inspecting the live TUI. Display starting, pending confirmation, complete,
partial and failed states. Preserve Timeline, Git Changes and generic custom tasks.

Test exact launch, metadata mismatch, immutable binding, concurrency, stale-runtime
receipts, interruption, executor reconnect/rebuild and partial failures. Validate
real macOS Codex native history using independent content and UUID, and real
Antigravity dispatch/receipt where CLI access allows. Windows tests establish
storage/PTY compatibility only, never real CLI acceptance. Independent review,
applicable CI and npm package acceptance gate merge. No version/publish/Release.
