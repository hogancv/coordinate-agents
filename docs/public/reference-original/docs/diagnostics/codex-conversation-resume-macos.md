# Codex-Centric Resume v1: macOS native acceptance

> Historical acceptance — applies to the 2026-10-20 Resume v1 manual-confirmation
> implementation (source package 3.0.1, Codex CLI 0.162.1). That flow predates
> automatic binding at `5fad370` and confirmation-free readiness at `f9f0210`.
> `/status` and explicit confirmation below describe what was tested then, not
> steps required by the [current recovery guide](../codex-conversation-resume.md#action-table).
> These results do not certify the later readiness policy.

Date: 2026-10-20. Platform: macOS arm64, Node 24.17.0, native node-pty;
Codex CLI 0.162.1; Antigravity through the user's existing agy-proxy wrapper.
Real user model, authentication, environment and native approval settings were
retained. All implementation files used for the test lived in a disposable Git
project. No npm publication, version change or Release was performed.

## A — continuing native conversation

Task: `workspace-82fd905c20a64a1e8ac093f23b40d9a5`.
Codex native Conversation ID: `01a156e9-1b2d-7eb0-9b36-09dda6d253ef`.

A real Default Collaboration Task initialized both CLIs. Codex was asked to
remember `amber lantern 739182` only in its conversation and replied
`ACK-739182`. A separate followup asked for the first word; it replied `amber`.
The browser closed the Task and clicked Resume Conversation. The resumed TUI's
native `/status` showed the same Conversation UUID and canonical project directory;
the operator explicitly confirmed that live result in the Web UI.

| Runtime | Before Close | After Resume |
| --- | --- | --- |
| Codex | `session_a86db2f2587245e5b39ec874370bf07c` | `session_18b91cfa542a4268b0934d4ec85bb63b` |
| Antigravity | `session_dbd0bdda650d4a0486f69a4c6d720324` | `session_8fc45902ca6c40039919becc1296d046` |

After reopening, the question was: "What complete phrase did I ask you to remember
earlier? Reply with that phrase only. No tools." The response was
`amber lantern 739182`. The question did not contain the phrase. The application
sent no previous prompt or history to the new Codex process. Native launch used
the explicit UUID. This establishes real context continuity, beyond process startup.

## B — rebuilt executor completes a new implementation

After executor replacement and state inspection, Codex explicitly dispatched a
new instruction to update `resume-proof.txt` to `executor joined 42018` with one
newline. Native tool approval dialogs were handled in the executor terminal.
The completed round was `round-a8383c2d-2f36-437e-b6dc-a85886a6e31d`:

| Revision | Formal state |
| --- | --- |
| 7 | SENT |
| 8 | WORKING |
| 9 | DONE |
| 10 | REVIEWING |
| 11 | APPROVED |

Codex inspected the actual file and reported approval. A separate filesystem read
confirmed the exact 22 bytes `executor joined 42018\n`. Existing unrelated untracked
content was retained; neither agent committed, pushed or released test changes.

One earlier attempt exposed normal tool-approval behavior: Codex tried to answer a
native approval using `send`, creating a different round. The old DONE was refused;
no false approval was recorded. That executor was replaced, and subsequent
instructions explicitly left native approvals to the operator. Resume neither
answers native approval dialogs nor changes the user's permission configuration.

## C — interruption in WORKING

The real executor reported WORKING for
`round-d4e80ba2-c0b3-4051-94e9-ccbacb248924`, revision 6, then was closed.
Resume retained the same Codex Runtime, replaced the executor and recorded the
interrupted WORKING round for inspection. Before/after cooperation and Timeline
JSON were equal. No work was automatically dispatched. A call replaying the old
executor's actual Session/generation claims was rejected without a new event.
Only a subsequent explicit Codex dispatch started the successful round above.

## D/E — automated boundary and regression evidence

Deterministic native-record tests and real Session Host fixtures cover wrong UUID,
wrong project/source, canonical Windows aliases, duplicate Resume, pending-startup
adoption, uncertain dispatch, late old-runtime writes, old-round executor reports,
partial failures, login continuation, archived/custom refusal, HTTP capability and
project boundaries, and stale UI completion. Existing Web/shared suites cover
Custom Terminals, Timeline, Health, notifications, Git Changes, PTY and adapters.
The npm artifact is packed and installed in an isolated consumer/home; omission
checks enforce both new runtime modules. These tests are separate from real model
acceptance. Final counts and CI results are recorded on PR #139.

## Capability boundary

This is **manual live confirmation**, not automatic native identity attestation.
Local native metadata only preflights the exact target/project/source. Each new
Codex runtime requires a fresh operator `/status` check; its runtime identity and
original native Conversation ID remain separate. Arbitrary user wrapper internals
remain trusted configuration and unsupported resume arguments fail closed.
Windows compatibility tests do not establish Windows 10 real native CLI acceptance.
