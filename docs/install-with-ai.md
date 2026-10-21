---
title: Install with AI
description: Canonical Web Workspace installation, verification, upgrade, uninstall, AI request examples, and separate Legacy Skill entry points.
---

<div id="install-with-ai--ai-安装指南" class="doc-anchor" aria-hidden="true"></div>
<div id="ai-安装指南" class="doc-anchor" aria-hidden="true"></div>

# Install with AI {#install-with-ai-ai-安装指南}

This is the canonical installation guide, consolidated from the former root
`AI_INSTALL.md` and this page.

::: warning v2.4 users
See [original docs and v3 migration](./v2.4.html) before replacing an existing structured installation with the Web package.
:::

Install the **Web Workspace** by default when the user asks for Coordinate Agents.
The optional Codex Plugin / Legacy Skill / MCP workflow has its own
[structured guide](./structured-workflow.html) and
[Legacy installation lifecycle (English)](./legacy-ai-install.html).

Use structured installation only when the user explicitly requests Plugin, Skill,
MCP, or structured Tasks. npm 3.x is not the Legacy Skill installer.

<div id="canonical-identity--官方身份" class="doc-anchor" aria-hidden="true"></div>
<div id="官方身份" class="doc-anchor" aria-hidden="true"></div>

## Canonical identity {#canonical-identity-官方身份}

- GitHub owner: `hogancv`
- Canonical repository: https://github.com/hogancv/coordinate-agents
- npm package: `@hogancv/coordinate-agents`
- Expected `repository.url`: `git+https://github.com/hogancv/coordinate-agents.git`
- Main usage: [English README](https://github.com/hogancv/coordinate-agents/blob/main/README.md), [Chinese README](https://github.com/hogancv/coordinate-agents/blob/main/README.zh-CN.md)

Check identity and the actual release before installing:

```sh
npm view @hogancv/coordinate-agents dist-tags.latest version repository.url --json
```

This guide targets **Web 3.0.2**, which includes Git Changes/review feedback,
Custom Terminals, desktop notifications, Timeline, Health and native Codex recovery.
Verified on **2026-10-21**: npm `latest` and the source package version are **3.0.2**;
the independently versioned `.codex-plugin` Plugin is **2.4.0**.
Verify registry metadata before selecting `latest`; choose source for development
or changes made after the selected release.
Never substitute the npm latest version for the Legacy version 2.4.0.

<div id="check-prerequisites--安装前检查" class="doc-anchor" aria-hidden="true"></div>
<div id="安装前检查" class="doc-anchor" aria-hidden="true"></div>

## Check prerequisites {#check-prerequisites-安装前检查}

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

Check Node.js, Git, and the selected CLI without reading or moving login directories.
Native PTY support depends on the platform and Node version. The stdio fallback
cannot provide a complete TUI or resize events visible to the child process.

<div id="choose-installation-path--选择安装方式" class="doc-anchor" aria-hidden="true"></div>
<div id="选择安装方式" class="doc-anchor" aria-hidden="true"></div>

## Choose installation path {#choose-installation-path-选择安装方式}

<div id="published-web-package--已发布-web-包" class="doc-anchor" aria-hidden="true"></div>
<div id="已发布-web-包" class="doc-anchor" aria-hidden="true"></div>

### Published Web package {#published-web-package-已发布-web-包}

A global install is optional. Start the verified package with an explicit root:

```sh
npx @hogancv/coordinate-agents@3.0.2 web --root "/path/to/project" --port 3000
```

Use the newly verified version in place of 3.0.2 if the user requested the latest
release. `--port 0` selects a free port. Opening Web initializes its local project
storage and, for a non-Git startup folder, Git without a commit. Choose an intended
project directory; do not launch it from an arbitrary folder for verification.

<div id="current-source--当前源码" class="doc-anchor" aria-hidden="true"></div>
<div id="当前源码" class="doc-anchor" aria-hidden="true"></div>

### Current source {#current-source-当前源码}

```sh
git clone https://github.com/hogancv/coordinate-agents.git
cd coordinate-agents
npm ci
node bin/coordinate-agents.mjs web --root "/path/to/project" --port 3000
```

Reuse an existing checkout when appropriate; preserve local edits. Merging to
main does not publish npm. The npm package and Plugin have independent versioning.

Use source when you need current additions; install its dependencies and run the Web entry point.

<div id="verify-and-report--验证与汇报" class="doc-anchor" aria-hidden="true"></div>
<div id="验证与汇报" class="doc-anchor" aria-hidden="true"></div>

## Verify and report {#verify-and-report-验证与汇报}

For a package-only installation request, inspect the selected package's version
and help. Do not run `quickstart`, create a task, or start agent processes unless
the user separately asks. npm 3.x has no `doctor` or Skill `install` command.

```sh
npx @hogancv/coordinate-agents@3.0.2 --version
npx @hogancv/coordinate-agents@3.0.2 --help
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

Installation success does not mean that a model task completed.

<div id="upgrade--更新" class="doc-anchor" aria-hidden="true"></div>
<div id="更新" class="doc-anchor" aria-hidden="true"></div>

## Upgrade {#upgrade-更新}

For npm, re-check metadata and use the selected newer version. A global install
may be updated with `npm install -g @hogancv/coordinate-agents@<verified-version>`.
For source, inspect local changes before updating the checkout and rerun `npm ci`
when dependencies change. Stop/restart Web explicitly; handle persistent sessions
through their own close/restart controls. Existing task data is separate from
the installed code. Do not promise automatic data migration or session context restore.

<div id="uninstall--卸载" class="doc-anchor" aria-hidden="true"></div>
<div id="卸载" class="doc-anchor" aria-hidden="true"></div>

## Uninstall {#uninstall-卸载}

If globally installed:

```sh
npm uninstall -g @hogancv/coordinate-agents
```

`npx` needs no global uninstall. Close owned agent sessions and stop the server
when asked to stop using it. Removing package/source code does not remove local
project history or the project registry. Prefer the Workspace's explicit archive
and clear controls when the user wants task history removed; clearing is permanent.
Do not delete project source or `.agent-bus/` merely to remove an installation.

<div id="optional-structured-installation--可选结构化安装" class="doc-anchor" aria-hidden="true"></div>
<div id="可选结构化安装" class="doc-anchor" aria-hidden="true"></div>

## Optional structured installation {#optional-structured-installation-可选结构化安装}

For an explicitly requested Codex Plugin:

```sh
codex plugin marketplace add hogancv/coordinate-agents
codex plugin add coordinate-agents@coordinate-agents
```

The Plugin supplies its own runtime and does not require a global npm CLI.
For standalone Legacy Skill installation, pin npm **2.4.0** and follow
[Legacy installation (English)](./legacy-ai-install.html) for selected-target `doctor`,
upgrade, uninstall, backup restore, and failure handling. Source commands use
`node bin/coordinate-agents-legacy.mjs`; npm 3.x does not provide those commands.

<div id="troubleshooting--故障排查" class="doc-anchor" aria-hidden="true"></div>
<div id="故障排查" class="doc-anchor" aria-hidden="true"></div>

## Troubleshooting {#troubleshooting-故障排查}

See [Troubleshooting](./troubleshooting.html). Never use `curl | sh` to install
unreviewed code. Never request, print, copy, or store a token, cookie, password,
or private key. Review provider installation instructions separately when an
agent CLI is missing; do not infer permission to replace the user's setup.

<div id="请求安装-web-workspace" class="doc-anchor" aria-hidden="true"></div>

## Request the Web Workspace

```text
Install Coordinate Agents from hogancv/coordinate-agents for local Web use.
Read docs/install-with-ai.md, verify the package identity and published version, and
check Node.js, Git, and my agent CLI commands. Keep my existing CLI login and
permission settings. Verify installation without creating an agent task.
```

For source development or changes beyond the selected npm release, use this instead:

```text
Set up the current coordinate-agents source from the official repository so
I can use Custom Terminals, Git Changes review, Timeline, Health, and desktop
notifications. Reuse an existing checkout and preserve local changes. Install
dependencies and show me the Web startup command for my project.
```

The AI should check registry metadata rather than assume that source, the 3.0.2
release and the current npm `latest` are identical.

<div id="ai-可以执行的命令" class="doc-anchor" aria-hidden="true"></div>

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

<div id="ai-不得隐式执行的命令" class="doc-anchor" aria-hidden="true"></div>

## Commands the AI must not execute implicitly

Do not run Legacy `install`, `doctor`, or `quickstart` against npm `latest`.
Do not create collaboration tasks just to prove installation. Do not change
CLI permission/sandbox settings, copy logins, or delete local task history.
Provider authentication stays with the selected CLI. Never pipe a downloaded
installer into a shell without review.

<div id="安装结果汇报" class="doc-anchor" aria-hidden="true"></div>

## Installation result report

A useful report states:

- Official repository/package and the selected release or source commit.
- Installation path, Node/Git versions, and configured executable names or paths.
- Actual version/help checks, plus the server URL if startup was requested.
- Missing login, provider, PTY, or OS notification checks that remain unverified.

A successful npm command is not proof that a live agent task or desktop toast
works. A non-zero exit must be reported as a failed step. For common failures
and recovery, use [Troubleshooting](./troubleshooting.html).

<div id="明确请求-plugin-或-legacy-skill" class="doc-anchor" aria-hidden="true"></div>

## Explicit Plugin or Legacy Skill requests

For Codex-native structured Tasks, ask for the GitHub Plugin and follow
[Structured workflow](./structured-workflow.html). Plugin-only installation
supplies its own runtime, without a global npm CLI prerequisite.

For the npm 2.4.0 Skill installer, use [Legacy Skill installation (English)](./legacy-ai-install.html).
It preserves the Codex and Antigravity installation conversations, selected-target
`doctor` checks, update/uninstall, and backup restore. Never substitute npm's
current `dist-tags.latest` into that Legacy procedure.
