---
layout: page
title: Compare multi-agent development approaches
description: Evidence-based comparison of single-agent coding, ad hoc dual terminals, and the asymmetric coordinate-cli-agents workflow.
---

# Compare multi-agent development approaches

This page compares workflow guarantees, not model intelligence. Codex CLI and Antigravity CLI can
each solve many tasks alone; `coordinate-cli-agents` is useful only when separation of duties and a
recoverable handoff are worth the additional process.

| Approach | Implementation owner | Review owner | State recovery | Release gate | Shared credentials |
| --- | --- | --- | --- | --- | --- |
| Single agent | Same agent | Same agent | Depends on the tool | Usually none | None |
| Manual dual terminals | Not fixed | Not fixed | Weak or manual notes | Manual | None |
| `coordinate-cli-agents` | Antigravity only | Codex only | Local persistent `.agent-bus` | Exact user authorization | Not required |

## What the differences mean

**Single agent.** This has the lowest coordination cost and is usually best for small, reversible
changes. The same context plans, edits, tests, and judges its own output. Independent review and a
durable cross-tool handoff are not provided by this project.

**Manual dual terminals.** Two CLIs can share a repository and communicate through chat or ad hoc
Markdown files. This is flexible, but role ownership, message claiming, interruption recovery,
deduplication, and release authorization depend on both prompts being followed perfectly. Two
processes can accidentally modify the same worktree.

**`coordinate-cli-agents`.** The roles are intentionally asymmetric. Codex clarifies requirements,
writes acceptance criteria, reviews the implementation commit and evidence, and controls the
release gate. Antigravity is the only product-code writer and creates the implementation commit.
Messages move atomically through `new`, `processing`, and `processed`; leases and recovery preserve
work across terminal exits. Neither agent reads or copies the other's authentication files.

## Observable guarantees and limits

The bus records who sent a message, its type, claim state, related commit, and evidence path. The
deterministic demo verifies `IMPLEMENT -> IMPLEMENTATION_DONE -> REVIEW_APPROVED` and reruns tests.
The installer refuses unrecognized or modified directories unless the user explicitly forces a
destructive action.

These are workflow controls, not a security sandbox. `.agent-bus` is local plaintext, any process
with filesystem access may read it, and the tool cannot prevent a deliberately disobedient CLI from
editing files. Git history, tests, OS permissions, and human release authorization remain necessary.

## Do not use this project when

- one agent can complete the task safely and independent review is unnecessary;
- both agents must edit product code or make concurrent Git writes;
- agents work in different repositories or on machines without a shared filesystem;
- the project requires encrypted or remotely replicated coordination state;
- an organization needs mandatory identity, policy, or cryptographic approval enforcement;
- the repository cannot tolerate a local ignored `.agent-bus/` directory;
- the task is only a general Codex-versus-Antigravity benchmark.

Use separate Git worktrees or a different orchestrator when concurrent implementation by multiple
writers is the actual requirement. For this workflow's exact ownership rules, read the
[Codex role](./codex-cli.html), [Antigravity role](./antigravity-cli.html), and
[security boundary](./security.html).
