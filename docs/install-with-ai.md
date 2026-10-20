---
layout: page
title: Install with AI / AI 安装指南
description: Canonical bilingual Web Workspace installation, verification, upgrade, uninstall, AI request examples, and separate Legacy Skill entry points.
---

# Install with AI / AI 安装指南

This is the canonical installation guide, consolidated from the former root
`AI_INSTALL.md` and this page. / 本页合并原根目录 AI 安装指南与使用 AI 安装说明。

> **v2.4 users / 旧版用户：** See [original docs and v3 migration / 旧文档与迁移](./v2.4.html)
> before replacing an existing structured installation with the Web package.

Install the **Web Workspace** by default when the user asks for Coordinate Agents.
The optional Codex Plugin / Legacy Skill / MCP workflow has its own
[structured guide](./structured-workflow.html) and
[Legacy installation lifecycle](./legacy-ai-install.html).

用户要求安装 Coordinate Agents 时，默认按本地 Web Workspace 处理。
只有明确要求 Plugin、Skill、MCP 或结构化 Task 时，才使用对应的结构化安装流程。
不要把 npm 3.x 当作旧版 Skill 安装器。

## Canonical identity / 官方身份

- GitHub owner: `hogancv`
- Canonical repository: https://github.com/hogancv/coordinate-agents
- npm package: `@hogancv/coordinate-agents`
- Expected `repository.url`: `git+https://github.com/hogancv/coordinate-agents.git`
- Main usage: [English README](https://github.com/hogancv/coordinate-agents/blob/main/README.md), [中文 README](https://github.com/hogancv/coordinate-agents/blob/main/README.zh-CN.md)

Check identity and the actual release before installing:

```sh
npm view @hogancv/coordinate-agents dist-tags.latest version repository.url --json
```

As checked on **2026-10-20**, `dist-tags.latest` is **3.0.1**. That is an
observed release, not a promise that all current-source features are in npm.
Git Changes/review feedback, Custom Terminals, desktop notifications, Timeline,
and Health were added later. Choose source when the user needs those additions.
Never substitute the npm latest version for the Legacy version 2.4.0.

## Check prerequisites / 安装前检查

```sh
node --version
git --version
# Default Collaboration only:
codex --version
agy --version
```

Require Node.js >=18 and Git. Default mode uses `codex` and `agy`; Custom mode
uses the user's selected executables. Provider login remains with each CLI.
Do not request, print, copy, or store credentials. Executable detection does not
prove login, provider access, or quota. Do not silently change CLI permissions.

检查 Node.js、Git 和所选 CLI；不要读取或搬运登录目录。
原生 PTY 取决于平台与 Node 版本，stdio 回退不能提供完整 TUI 或子进程可见的尺寸变化。

## Choose installation path / 选择安装方式

### Published Web package / 已发布 Web 包

A global install is optional. Start the verified package with an explicit root:

```sh
npx @hogancv/coordinate-agents@3.0.1 web --root "/path/to/project" --port 3000
```

Use the newly verified version in place of 3.0.1 if the user requested the latest
release. `--port 0` selects a free port. Opening Web initializes its local project
storage and, for a non-Git startup folder, Git without a commit. Choose an intended
project directory; do not launch it from an arbitrary folder for verification.

### Current source / 当前源码

```sh
git clone https://github.com/hogancv/coordinate-agents.git
cd coordinate-agents
npm ci
node bin/coordinate-agents.mjs web --root "/path/to/project" --port 3000
```

Reuse an existing checkout when appropriate; preserve local edits. Merging to
main does not publish npm. The npm package and Plugin have independent versioning.

需要当前新增功能时从源码启动。已有仓库不应覆盖本地修改；安装依赖后运行 Web 入口即可。

## Verify and report / 验证与汇报

For a package-only installation request, inspect the selected package's version
and help. Do not run `quickstart`, create a task, or start agent processes unless
the user separately asks. npm 3.x has no `doctor` or Skill `install` command.

```sh
npx @hogancv/coordinate-agents@3.0.1 --version
npx @hogancv/coordinate-agents@3.0.1 --help
# Source equivalents:
node bin/coordinate-agents.mjs --version
node bin/coordinate-agents.mjs --help
```

If starting Web is requested, verify the printed localhost URL, selected root,
and available executable settings. A non-zero command exit is a failed step;
report it and its bounded diagnostic rather than claiming success. Starting a
server alone does not verify a live model task, PTY TUI, or OS notification.

Report: repository/package identity, chosen version or source commit, Node/Git,
selected CLI executables, installation location, actual checks, and unresolved
login/platform issues. Separate installed, server started, and live task verified.

汇报安装版本或源码提交、目录、已验证项及未验证项。不要把安装成功等同于模型任务完成。

## Upgrade / 更新

For npm, re-check metadata and use the selected newer version. A global install
may be updated with `npm install -g @hogancv/coordinate-agents@<verified-version>`.
For source, inspect local changes before updating the checkout and rerun `npm ci`
when dependencies change. Stop/restart Web explicitly; handle persistent sessions
through their own close/restart controls. Existing task data is separate from
the installed code. Do not promise automatic data migration or session context restore.

## Uninstall / 卸载

If globally installed:

```sh
npm uninstall -g @hogancv/coordinate-agents
```

`npx` needs no global uninstall. Close owned agent sessions and stop the server
when asked to stop using it. Removing package/source code does not remove local
project history or the project registry. Prefer the Workspace's explicit archive
and clear controls when the user wants task history removed; clearing is permanent.
Do not delete project source or `.agent-bus/` merely to remove an installation.

## Optional structured installation / 可选结构化安装

For an explicitly requested Codex Plugin:

```sh
codex plugin marketplace add hogancv/coordinate-agents
codex plugin add coordinate-agents@coordinate-agents
```

The Plugin supplies its own runtime and does not require a global npm CLI.
For standalone Legacy Skill installation, pin npm **2.4.0** and follow
[Legacy installation](./legacy-ai-install.html) for selected-target `doctor`,
upgrade, uninstall, backup restore, and failure handling. Source commands use
`node bin/coordinate-agents-legacy.mjs`; npm 3.x does not provide those commands.

## Troubleshooting / 故障排查

See [Troubleshooting](./troubleshooting.html). Never use `curl | sh` to install
unreviewed code. Never request, print, copy, or store a token, cookie, password,
or private key. Review provider installation instructions separately when an
agent CLI is missing; do not infer permission to replace the user's setup.

## Request the Web Workspace

```text
Install Coordinate Agents from hogancv/coordinate-agents for local Web use.
Read docs/install-with-ai.md, verify the package identity and published version, and
check Node.js, Git, and my agent CLI commands. Keep my existing CLI login and
permission settings. Verify installation without creating an agent task.
```

For features added after npm 3.0.1, use this instead:

```text
Set up the current coordinate-agents source from the official repository so
I can use Custom Terminals, Git Changes review, Timeline, Health, and desktop
notifications. Reuse an existing checkout and preserve local changes. Install
dependencies and show me the Web startup command for my project.
```

As checked on 2026-10-20, npm `latest` is 3.0.1. The AI should check registry
metadata rather than assume the source and published package are identical.

## Commands the AI may execute

Within an installation request, read-only identity and prerequisite checks:

```sh
npm view @hogancv/coordinate-agents dist-tags.latest version repository.url --json
node --version
git --version
codex --version
agy --version
```

Install the chosen package or source dependencies, then inspect its `--version`
and `--help`. When the user asks to start Web, choose an explicit project root
and open the printed localhost URL. A non-Git startup folder initializes Git
and local storage without a commit. Creating a task launches real agent processes;
that is separate from package verification.

## Commands the AI must not execute implicitly

Do not run Legacy `install`, `doctor`, or `quickstart` against npm `latest`.
Do not create collaboration tasks just to prove installation. Do not change
CLI permission/sandbox settings, copy logins, or delete local task history.
Provider authentication stays with the selected CLI. Never pipe a downloaded
installer into a shell without review.

## Installation result report

A useful report states:

- Official repository/package and the selected release or source commit.
- Installation path, Node/Git versions, and configured executable names or paths.
- Actual version/help checks, plus the server URL if startup was requested.
- Missing login, provider, PTY, or OS notification checks that remain unverified.

A successful npm command is not proof that a live agent task or desktop toast
works. A non-zero exit must be reported as a failed step. For common failures
and recovery, use [Troubleshooting](./troubleshooting.html).

## Explicit Plugin or Legacy Skill requests

For Codex-native structured Tasks, ask for the GitHub Plugin and follow
[Structured workflow](./structured-workflow.html). Plugin-only installation
supplies its own runtime, without a global npm CLI prerequisite.

For the npm 2.4.0 Skill installer, use [Legacy Skill installation](./legacy-ai-install.html).
It preserves the Codex and Antigravity installation conversations, selected-target
`doctor` checks, update/uninstall, and backup restore. Never substitute npm's
current `dist-tags.latest` into that Legacy procedure.
