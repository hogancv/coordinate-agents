---
title: Compare workflows
description: Compare one coding agent, manually managed terminals, the local Web Workspace, and optional structured Plugin and Task Graph coordination.
---

<div id="工作流对比" class="doc-anchor" aria-hidden="true"></div>

# Compare workflows

Coordinate Agents adds a workspace and coordination tools around coding CLIs.
It does not change the underlying models' intelligence. Choose the amount of
coordination that helps your task.

| Approach | Setup and roles | Recorded state | Isolation and limits |
| --- | --- | --- | --- |
| Single agent | Use the agent directly; it plans, implements, and reviews. | Whatever that agent provides. | Lowest coordination overhead; independent review is optional. |
| Manual dual terminals | Start two CLIs and exchange instructions yourself. | Native CLI history and your notes. | Roles and routing are manual; both processes can share one worktree. |
| Coordinate Agents Web: Default | Start Web, configure `codex`/`agy`, create a task. Codex delegates/reviews; Antigravity implements. | Local projects, terminal bindings, collaboration receipts and timeline. | Prompts guide roles; no isolated worktree or independently verified completion. |
| Coordinate Agents Web: Custom | Choose two executables and optional prompts. | Local task/slot bindings and prompt snapshots. | You control coordination; no default roles, rounds, or Codex feedback handoff. |
| Coordinate Agents structured Plugin / Legacy CLI / MCP | Configure a registered Implementer and use durable Task APIs. | Agent Bus messages, evidence, review decisions, recovery and optional Task Graphs. | Separate protocol contracts and explicit execution/review/release boundaries. |

Web 3.0.2 packages the Git Changes/review, Custom, notification, Timeline, Health
and recovery additions made after 3.0.1. See [Getting started](./getting-started.html).

<div id="适合使用-web-工作台的场景" class="doc-anchor" aria-hidden="true"></div>

## When Web Workspace helps

Use it when you want two coding CLIs in one local browser, persistent sessions,
project/task history, and an explicit implementation/review handoff. Default
Collaboration supplies that handoff with lightweight role prompts and reports.
Custom mode suits a CLI pair whose behavior you want to control yourself.

Git Changes, review notes, timeline, health hints, and optional notifications
make the current source easier to observe. They do not verify correctness,
ensure the agent followed its prompt, or automatically recover failed work.

<div id="适合使用结构化工作流的场景" class="doc-anchor" aria-hidden="true"></div>

## When the structured workflow helps

The retained **Protocol & Runtime** adds durable Task dispatch, Agent Bus
claims, implementation evidence, review decisions, and explicit recovery.
Configured Implementer and Configured Reviewer identities are part of its
records, with Local persistent `.agent-bus` storage and Exact user authorization
for its release boundary. The default reference workflow uses Antigravity for
implementation and Codex for planning/review; adapters allow other agents.

Use [Structured workflow](./structured-workflow.html) when those records and
contracts matter. Task Graphs add explicit dependency planning and isolated
subtask worktrees. These APIs are not available through npm 3.x Web tasks.

<div id="以下情况不适合使用本项目" class="doc-anchor" aria-hidden="true"></div>

## Do not use this project when

- One agent already completes the task comfortably and an additional workspace adds no value.
- You need encrypted or remotely replicated coordination storage, multi-user access, or cross-machine sessions.
- You expect Web tasks to isolate concurrent edits automatically.
- You need a security sandbox or cryptographically enforced role/release policy.

Every Web task uses its project's worktree. Use separate worktrees for conflicting
writers. Agent CLI permissions remain authoritative, local state is plaintext,
and review reports do not authorize release. See [Security](./security.html).
