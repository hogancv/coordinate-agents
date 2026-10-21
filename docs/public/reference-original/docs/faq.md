---
layout: page
title: FAQ
description: Answers about Web Workspace setup, coding-agent pairs, source versus npm releases, local data, persistence, and optional structured workflows.
---

# Frequently asked questions

## What is Coordinate Agents now?

A local Web Workspace for two persistent coding-agent terminals. Default
Collaboration pairs Codex for clarification/delegation/review with Antigravity
for implementation. Custom Terminals lets you choose your own CLI pair and
prompts. The repository also retains a separate structured Plugin and Legacy
runtime for durable Tasks, Agent Bus, MCP, and Task Graphs.

## Why are features in the docs missing from my npm installation?

As checked on 2026-10-20, npm `latest` is 3.0.1. Current source includes later
Git Changes/review feedback, Custom Terminals, notification, Timeline, and Health
work. Run the source checkout to use those additions. A merge to main does not
publish npm; see [Getting started](./getting-started.html).

## Do I need a Codex Plugin or a global npm installation?

No. Start Web with `npx @hogancv/coordinate-agents@latest web`, or run the source
entry after `npm ci`. Install the Plugin only if you want the separate
[structured workflow](./structured-workflow.html). npm 3.x does not provide
`install`, `doctor`, `quickstart`, `config`, `task`, or `inspector`.

## Which CLIs can I use?

Default Collaboration expects `codex` and `agy`, with executable overrides in
settings. Custom mode launches two installed interactive CLIs through
`generic-cli`, including the same command twice. Executable fields take names
or absolute paths, without inline flags or shell syntax. Compatibility with an
unknown CLI's readiness and multiline paste must be checked by the user.
Custom mode does not add default roles, rounds, or Codex review handoff.

## Does local-first mean the agents work offline?

Workspace storage and coordination are local. Each CLI still uses its own
provider, login, networking, and permission settings. Coordinate Agents does
not share credentials or guarantee offline model inference. Never put tokens,
cookies, passwords, or private keys in `.agent-bus/`.

## Does creating a task isolate its file changes?

No. Web task terminal pairs share the selected project's working directory.
Use separate Git worktrees when independent writers need isolation; do not run
conflicting edits in the same worktree. The structured Task Graph workflow has
its own explicit worktree contracts, separate from Web tasks.

## What does APPROVED mean? Does it authorize a release?

It means Codex reported approval for that collaboration round. Reports are not
independently verified by the Workspace. `DONE` means the implementer reported
ready for review; `SENT` confirms dispatch only. Task running/closed status is
terminal lifecycle. Web prompts require user authorization for commit, push, and
release, but do not enforce a technical release gate. Structured
`REVIEW_APPROVED` and `RELEASE_APPROVED` have separate protocol semantics.

## Is a quiet terminal a failed task?

No. Health hints show missing receipts, quiet work/review, and linked Session
facts. They do not infer success or failure from silence and do not retry or
restart agents. Check the terminal and formal receipt before deciding how to
continue. A pending wait is not a reason to resend an instruction.

## What survives refresh or closing the browser?

Projects, task records, and collaboration history are local files. Independent
Session Hosts let a refreshed browser reconnect to running agents. Browser close
or Web server shutdown does not itself close those agents; use terminal-close
controls explicitly. Restarting a pair creates fresh Sessions, not restored
model context, while keeping recorded task history.

## How do notifications work?

Enable project preferences in the Desktop Notifications settings tab. Windows
10/11 and macOS are supported; Linux reports unsupported. Only formal Default
Collaboration receipts trigger them. Attempts are at most once per project/task/
round/status, so an OS failure can lose a notification without automatic retry.
The browser may be closed while backend and agents continue running. System
permissions and Focus mode control visible delivery.

## What does Git Changes include?

Current working-tree changes, including existing user edits. It is not an
agent-only diff or a review of committed history. In Default mode you can select
diff lines and send notes after confirming Codex is at a blank input prompt.
A successful send clears that confirmation. Custom mode supports viewing/copying.

## How do I archive or remove local history?

Right-click a task or project to archive it and close its terminals. Source
files remain. Settings can permanently clear archived conversations, including
their timeline history, across registered projects. Re-adding an archived folder
restores its project entry. A global npm install can be removed with
`npm uninstall -g @hogancv/coordinate-agents`; that does not remove project data.

## Where are the original protocol and adapter docs?

The optional structured system remains a local-first coordination protocol, runtime,
and Plugin with Codex/Antigravity reference adapters. The default reference workflow
uses Planner, Implementer, and Reviewer roles. Start with [Structured workflow](./structured-workflow.html),
then [Protocol](./protocol.html), [MCP](./mcp.html), or [Adapter author guide](./adapter-author-guide.html).
For Legacy Skill uninstall and backup restore, use [Legacy installation](./legacy-ai-install.html).
