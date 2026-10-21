---
title: "Native Conversation Identity Store v1"
description: Retained technical reference; applicability follows the implementation stage described in this document.
---

<div id="技术参考-native-conversation-identity-store-v1" class="doc-anchor" aria-hidden="true"></div>

# Native Conversation Identity Store v1

> Historical storage-stage document — applies to PR #137's Identity Store v1
> implementation in the 3.0.1 source line, before native Resume and automatic
> capture were integrated. The storage schema remains v1, but the original
> source-registration and restart behavior below is not the current usage guide.
> Use the [current action table](codex-conversation-resume.md#action-table) for
> source `f9f0210` and later; the package version alone does not identify the flow.

Later integrations reuse this receiver for explicit human attestations and
supported native OTEL observations. `MANUAL_CONFIRMED` remains available through
the compatibility API, not as a required Web recovery step. Current readiness
does not depend on it and never claims continuous automatic verification. A
bound/reserved Default Task now refuses fresh restart before closing its terminals.
The default receiver still rejects observations without a trusted verifier.

The original storage-only stage stored optional native identity **facts**, without discovering CLI
identities or enabling Resume. CLI startup, PTY input, proxy wrappers, Custom
Terminals, workspace-message and formal cooperation are unchanged. No hooks,
collector, app-server bridge, private profile or global CLI configuration is added.

## Data and lifetime

Task `schemaVersion: 1` has an optional `nativeConversations` object with optional
`codex` and `antigravity` entries. Old Tasks need no migration. Each entry contains:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Identity entry schema, currently 1 |
| `projectRoot`, `taskId`, `slot`, `adapter` | Exact owner, including canonical project root |
| `revision` | Identity CAS revision, independent of Cooperation Revision |
| `binding` | Immutable first authenticated native conversation observation |
| `firstConflict` | First observation with a different UUID, or null |
| `lastObservation` | Latest accepted observation, including per-runtime sequence |

An observation contains only `conversationId`, `sessionId`, `runtimeGeneration`,
`source: {id, version}` and ISO `observedAt`; the latest also has `sequence`.
Native UUIDs and runtime generation UUIDs are different namespaces from Task and
Session IDs. Session Manager mints a random generation for each fresh Session;
Host retains it in metadata, including terminal state. Default Task slot
associations retain the same generation. Legacy Sessions remain interactive but
cannot attest without a generation and an adapter-qualified owning association.

Close retains bindings. Existing Restart creates new Sessions/generations but
retains the original native binding; a later different UUID records a conflict.
Archive retains the record until explicit archive data deletion. Identity history
is deliberately coalesced to the original, first conflict and latest observation;
it is not an unbounded native conversation log. A same-ID observation never
clears a conflict. Within a project an adapter/native UUID already bound to one
Task cannot become another Task's original binding, including archived Tasks.

Default Task views expose `sessions.<slot>.nativeIdentity`. Its `bindingState` is
`UNBOUND`, `BOUND` or `IDENTITY_CHANGED`, describing durable facts. Its separate
`verification` is always `{state: "UNAVAILABLE", reason: "NO_LIVE_SOURCE"}` in v1.
No live verification state is written to disk or revived by refresh or backend
restart. BOUND means a historical binding, not a claim about the current process
or the safety of a future input. Custom slots expose no native identity capability.

Moving/copying a Task with a binding to a different canonical project path is not
an implicit identity migration; it is rejected. There is no automatic rebinding,
deduplication or guessing from CLI history.

## Internal event contract

`createWorkspaceNativeIdentityStore({root, verifyAttestation})` is a trusted Runtime
code composition interface, not an HTTP action, Runtime operation, CLI command,
workspace-message command or configurable adapter capability. There is no global
source registry or environment/configuration bypass. With the verifier omitted,
every `observe(attestation)` call is rejected. No production source is registered
in v1, on any platform.

A future controlled Host/Adapter must supply a verifier that authenticates source
ownership, process identity and schema, then returns these exact claims:

```js
{
  schemaVersion: 1,
  projectRoot, taskId, slot, adapter,
  sessionId, runtimeGeneration,
  conversationId,
  source: { id, version },
  observedAt, sequence, expectedRevision
}
```

The verifier must derive claims from authenticated control state; it must not
simply return caller JSON or trust a `verified` flag/source name. This factory is
intended for trusted package code composition. It does not isolate malicious code
running as the same OS user, which could directly modify Task JSON anyway.
Deterministic tests inject an opaque fixture authority into their own receiver
instances; they never change production registration or imply native CLI support.

The receiver rejects nil/invalid UUIDs, extra fields, malformed source metadata,
noncanonical/mismatched roots, samples older than 15 seconds or over 1 second in
the future. Within the same Session/generation, sequence must increase and timestamp
must not go backwards. A new generation resets that runtime's ordering watermark.
Verification runs before the transaction; ownership and
freshness are checked again after acquiring the existing config lock. The Task
must be active and unarchived; Task slot, Session owner, adapter, cwd, generation
and expected identity revision must all agree. Closed/exited Sessions and late
old-runtime events cannot modify the binding. Store error diagnostics contain
fixed reason codes, not supplied payloads.

All Task writers share the same short lock and atomic JSON replacement. Lifecycle
and cooperation writers preserve the latest identity fields, including an event
committed while Close was awaiting Session shutdown. Cross-process CAS and native
UUID occupancy checks run in that same transaction. Config lock acquisition no
longer steals an unpublished or live owner based on age; dead-owner reaping elects
one waiter and rechecks ownership before removal. Unknown or foreign-host owners
time out closed and require explicit recovery/inspection rather than guessed death.

## Still outside this release

Codex primary-thread attribution and Antigravity profile inheritance remain source
integration tasks. Windows/Linux storage tests do not establish native CLI capture.
A historical identity event is not an atomic acknowledgement of PTY input.
Automatic Resume/dispatch still needs an authenticated live source, generation
and lifecycle ownership, a source-specific input fence, uncertain-write handling,
exact-target recovery and partial-pair behavior. This store grants none of those
permissions and changes no cooperation status, round, revision or Timeline event.
