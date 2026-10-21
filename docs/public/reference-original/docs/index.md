---
layout: home
title: Coordinate Agents
description: A local Web Workspace for persistent coding-agent terminal pairs, default Codex and Antigravity collaboration, and custom CLIs.
permalink: /
---

# A local workspace for coding-agent terminals

> **v2.4 users:** See [original v2.4.0 docs and v3 migration](./v2.4.html) for the
> product-direction change, historical documentation, and retained structured workflow.

Coordinate Agents brings two persistent agent terminals into a local browser
workspace. Use **Default Collaboration** for Codex to delegate implementation
to Antigravity and review the result, or **Custom Terminals** to choose your own
CLI pair and prompts. Projects and task history stay on your machine; each CLI
uses its own provider configuration and login.

## Start the Workspace

Install Node.js >=18, Git, and your agent CLIs. For the default pair, make sure
`codex` and `agy` work and are signed in. No Codex Plugin is required.

```sh
npx @hogancv/coordinate-agents@latest web --root "/path/to/project" --port 3000
```

Open the printed localhost URL, check settings, create a task, and enter your
request in Codex. The startup folder is registered automatically; a non-Git
folder is initialized without a commit.

**Source and release differ.** As checked on 2026-10-20, npm `latest` is 3.0.1.
The current source also includes Git Changes/review feedback, Custom Terminals,
desktop notifications, Collaboration Timeline, and Collaboration Health added
after that release. To use those additions:

```sh
git clone https://github.com/hogancv/coordinate-agents.git
cd coordinate-agents
npm ci
node bin/coordinate-agents.mjs web --root "/path/to/project" --port 3000
```

Merging source does not publish npm. See [Getting started](./getting-started.html)
for prerequisites, settings, first-task steps, and release differences.

## Everyday use

- [Workspace guide](./inspector.html): Default and Custom terminals, settings, Git Changes, review feedback, timeline, health, notifications, and archives.
- [Install with AI](./install-with-ai.html): choose Web or the optional structured Plugin before installing.
- [Troubleshooting](./troubleshooting.html): missing commands, ports, PTY limitations, receipts, and notifications.
- [Changelog](./changelog.html): published release history.
- [FAQ](./faq.html): local data, session persistence, supported CLIs, and workflow limits.
- [Comparison](./comparison.html): a single agent, manual terminals, Workspace, and structured coordination.
- [Security](./security.html): local storage, process permissions, loopback access, and diagnostics.
- [简体中文](./zh-CN/): Chinese introduction and documentation routes.

Task-list status describes terminal lifecycle. Collaboration states are explicit
agent reports, not independent proof of implementation or review. Web tasks
share the project's working directory; a terminal pair does not create an
isolated worktree. Role prompts guide behavior and do not enforce a sandbox or
release gate.

## Optional structured workflow

The GitHub Plugin and Legacy runtime retain the local-first Agent Bus, durable
Tasks, Task Graphs, evidence-based review, and explicit recovery. They share
Session infrastructure with Web, but have different APIs and workflow guarantees.
The npm 3.x Web package does not include the structured CLI or MCP server.

- [Structured workflow](./structured-workflow.html): Plugin installation, setup, dispatch, review, and recovery.
- [Legacy Skill installation](./legacy-ai-install.html): npm 2.4.0 installation, upgrade, uninstall, and backup steps.
- [Plugin end-to-end guide](./plugin-e2e.html), [MCP tools](./mcp.html), [MCP troubleshooting](./MCP_TROUBLESHOOTING.html).
- [Protocol](./protocol.html), [Task Graph](./task-graph-v1.html), [Runtime events](./event-journal.html).
- [Session Runtime](./session-runtime.html), [Adapter author guide](./adapter-author-guide.html), [Adapter conformance](./adapter-conformance.html).
- [Codex reference role](./codex-cli.html), [Antigravity reference role](./antigravity-cli.html).

[Machine-readable documentation index](./llms.txt)

Canonical sources: [GitHub](https://github.com/hogancv/coordinate-agents) · [npm](https://www.npmjs.com/package/@hogancv/coordinate-agents)
