# Agent Bus Protocol

## Queues

Each role owns `new`, `processing`, and `processed` beneath `.agent-bus/inbox/<role>/`.

- Writers create a temporary UTF-8 message under `.agent-bus/tmp/`, then atomically move it to `new`.
- A waiter claims the oldest message by atomically moving it from `new` to `processing`.
- The recipient moves a successfully handled message to `processed`.
- Claims have lease sidecars. `recover` returns expired claims to `new`; inspect for matching work or replies before recovery.
- Retry sends with a stable `--dedupe-key`; the same sender/recipient/key tuple is delivered once.
- Invalid messages move to `.agent-bus/quarantine/<role>/` with a local error record.

## Message types

- `REQUIREMENTS`: raw or clarified product request
- `IMPLEMENT`: implementation-ready specification
- `IMPLEMENTATION_DONE`: committed implementation plus evidence
- `CHANGES_REQUESTED`: blocking review findings
- `REVIEW_APPROVED`: review sign-off
- `RELEASE_REQUEST`: release plan awaiting authorization
- `RELEASE_RESULT`: verified release outcome
- `QUESTION` / `ANSWER`: bounded clarification
- `STOP`: end collaboration safely

## Recovery

Run `status` first. A message left in `processing` belongs to the role that claimed it. Read and finish it if the prior CLI died. Move it back to `new` only when it was never acted upon and no matching commit or reply exists.

Never delete queue history as part of normal recovery.

State is append-only under `.agent-bus/state/<role>/`. `status` selects the newest valid record and reports invalid records instead of failing on corrupt JSON.

## Local data and cleanup

The bus is plaintext and can include full prompts, specifications, review comments, code excerpts, paths, commit hashes, logs, host/process metadata, and evidence. Never put credentials in it. Local Git exclusion is not encryption and does not stop backups or other local processes from reading the directory.

After retention is no longer needed, remove the complete bus with `clean --confirm DELETE_AGENT_BUS`. Inspect and redact the directory before sharing it.

## Git ownership

- Antigravity alone writes implementation files and implementation commits.
- Codex may run read-only Git inspection. It may perform release Git writes only after `RELEASE_APPROVED` and after Antigravity is idle with a clean worktree.
- Every `IMPLEMENTATION_DONE` must identify a real commit and evidence file.

## Release gate

`REVIEW_APPROVED` is not release authorization. Only the user's exact `RELEASE_APPROVED` authorizes the specifically described release actions.
