---
title: FAQ
description: Answers about Web Workspace setup, coding-agent pairs, source versus npm releases, local data, persistence, and optional structured workflows.
---

<div id="常见问题" class="doc-anchor" aria-hidden="true"></div>

# Frequently asked questions

<div id="coordinate-agents-现在是什么" class="doc-anchor" aria-hidden="true"></div>

## What is Coordinate Agents now?

A local Web Workspace for two persistent coding-agent terminals. Default
Collaboration pairs Codex for clarification/delegation/review with Antigravity
for implementation. Custom Terminals lets you choose your own CLI pair and
prompts. The repository also retains a separate structured Plugin and Legacy
runtime for durable Tasks, Agent Bus, MCP, and Task Graphs.

<div id="为什么文档中的功能在我安装的-npm-包里找不到" class="doc-anchor" aria-hidden="true"></div>

## Why are features in the docs missing from my npm installation?

Verified on 2026-10-21, npm `latest` is **3.0.2**, matching the source package version.
Git Changes/review feedback, Custom Terminals, desktop notifications, Timeline,
Health and native Codex recovery are included in 3.0.2. Check your installed
version and `npm view @hogancv/coordinate-agents dist-tags`; use a current source
checkout only for development or changes after your selected release. A merge
to main does not publish npm; see [Getting started](./getting-started.html).

<div id="需要-codex-plugin-或全局安装-npm-包吗" class="doc-anchor" aria-hidden="true"></div>

## Do I need a Codex Plugin or a global npm installation?

No. Start Web with `npx @hogancv/coordinate-agents@latest web`, or run the source
entry after `npm ci`. Install the Plugin only if you want the separate
[structured workflow](./structured-workflow.html). npm 3.x does not provide
`install`, `doctor`, `quickstart`, `config`, `task`, or `inspector`.

<div id="可以使用哪些-cli" class="doc-anchor" aria-hidden="true"></div>

## Which CLIs can I use?

Default Collaboration expects `codex` and `agy`, with executable overrides in
settings. Custom mode launches two installed interactive CLIs through
`generic-cli`, including the same command twice. Executable fields take names
or absolute paths, without inline flags or shell syntax. Compatibility with an
unknown CLI's readiness and multiline paste must be checked by the user.
Custom mode does not add default roles, rounds, or Codex review handoff.

<div id="本地优先是否意味着智能体离线工作" class="doc-anchor" aria-hidden="true"></div>

## Does local-first mean the agents work offline?

Workspace storage and coordination are local. Each CLI still uses its own
provider, login, networking, and permission settings. Coordinate Agents does
not share credentials or guarantee offline model inference. Never put tokens,
cookies, passwords, or private keys in `.agent-bus/`.

<div id="创建任务会隔离它的文件变更吗" class="doc-anchor" aria-hidden="true"></div>

## Does creating a task isolate its file changes?

No. Web task terminal pairs share the selected project's working directory.
Use separate Git worktrees when independent writers need isolation; do not run
conflicting edits in the same worktree. The structured Task Graph workflow has
its own explicit worktree contracts, separate from Web tasks.

<div id="approved-是什么意思-它会授权发布吗" class="doc-anchor" aria-hidden="true"></div>

## What does APPROVED mean? Does it authorize a release?

It means Codex reported approval for that collaboration round. Reports are not
independently verified by the Workspace. `DONE` means the implementer reported
ready for review; `SENT` confirms dispatch only. Task running/closed status is
terminal lifecycle. Web prompts require user authorization for commit, push, and
release, but do not enforce a technical release gate. Structured
`REVIEW_APPROVED` and `RELEASE_APPROVED` have separate protocol semantics.

<div id="安静无输出的终端是否表示任务失败" class="doc-anchor" aria-hidden="true"></div>

## Is a quiet terminal a failed task?

No. Health hints show missing receipts, quiet work/review, and linked Session
facts. They do not infer success or failure from silence and do not retry or
restart agents. Check the terminal and formal receipt before deciding how to
continue. A pending wait is not a reason to resend an instruction.

<div id="刷新页面或关闭浏览器后-哪些内容会保留" class="doc-anchor" aria-hidden="true"></div>

## What survives refresh or closing the browser?

Projects, task records, and collaboration history are local files. Independent
Session Hosts let a refreshed browser reconnect to running agents. Browser close
or Web server shutdown does not itself close those agents; use terminal-close
controls explicitly. Restarting a pair creates fresh Sessions, not restored
model context, while keeping recorded task history.

<div id="通知如何工作" class="doc-anchor" aria-hidden="true"></div>

## How do notifications work?

Enable project preferences in the Desktop Notifications settings tab. Windows
10/11 and macOS are supported; Linux reports unsupported. Only formal Default
Collaboration receipts trigger them. Attempts are at most once per project/task/
round/status, so an OS failure can lose a notification without automatic retry.
The browser may be closed while backend and agents continue running. System
permissions and Focus mode control visible delivery.

<div id="git-changes-包含什么" class="doc-anchor" aria-hidden="true"></div>

## What does Git Changes include?

Current working-tree changes, including existing user edits. It is not an
agent-only diff or a review of committed history. In Default mode you can select
diff lines and send notes after confirming Codex is at a blank input prompt.
A successful send clears that confirmation. Custom mode supports viewing/copying.

<div id="如何归档或删除本地历史" class="doc-anchor" aria-hidden="true"></div>

## How do I archive or remove local history?

Right-click a task or project to archive it and close its terminals. Source
files remain. Settings can permanently clear archived conversations, including
their timeline history, across registered projects. Re-adding an archived folder
restores its project entry. A global npm install can be removed with
`npm uninstall -g @hogancv/coordinate-agents`; that does not remove project data.

<div id="原始协议和适配器文档在哪里" class="doc-anchor" aria-hidden="true"></div>

## Where are the original protocol and adapter docs?

The optional structured system remains a local-first coordination protocol, runtime,
and Plugin with Codex/Antigravity reference adapters. The default reference workflow
uses Planner, Implementer, and Reviewer roles. Start with [Structured workflow](./structured-workflow.html),
then [Protocol](./protocol.html), [MCP](./mcp.html), or [Adapter author guide](./adapter-author-guide.html).
For Legacy Skill uninstall and backup restore, use [Legacy installation](./legacy-ai-install.html).
