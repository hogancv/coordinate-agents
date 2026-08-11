# Agent Bus Protocol

## Queues

Each role owns `new`, `processing`, and `processed` beneath `.agent-bus/inbox/<role>/`.

- Writers create a temporary UTF-8 message under `.agent-bus/tmp/`, then atomically move it to `new`.
- A waiter claims the oldest message by atomically moving it from `new` to `processing`.
- The recipient moves a successfully handled message to `processed`.

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

## Git ownership

- Antigravity alone writes implementation files and implementation commits.
- Codex may run read-only Git inspection. It may perform release Git writes only after `RELEASE_APPROVED` and after Antigravity is idle with a clean worktree.
- Every `IMPLEMENTATION_DONE` must identify a real commit and evidence file.

## Release gate

`REVIEW_APPROVED` is not release authorization. Only the user's exact `RELEASE_APPROVED` authorizes the specifically described release actions.
