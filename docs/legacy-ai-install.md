---
title: Legacy Skill installation
description: Preserved npm 2.4.0 Skill installation, verification, upgrade, uninstall, and backup procedures; separate from npm 3 Web Workspace.
---

<div id="legacy-skill-installation-guide--旧版-skill-安装指南" class="doc-anchor" aria-hidden="true"></div>
<div id="legacy-skill-安装指南" class="doc-anchor" aria-hidden="true"></div>

# Legacy Skill installation guide

::: tip Structured workflow (v2.4 lineage)
This reference follows the retained Plugin / source Legacy runtime and may include later fixes;
it is not a frozen v2.4.0 snapshot. npm 3.x Web does not expose these structured APIs.
[Original v2.4.0 docs and migration](./v2.4.html) · [Current Web guide](./getting-started.html).
:::

::: warning Distribution boundary
npm 3.0 is Web-first: use `npx @hogancv/coordinate-agents@latest web`. All structured installation/doctor/setup/SDK instructions below refer to the GitHub Plugin/source or npm **2.4.0**. npm 3.x does not install Skills or provide the Legacy runtime. Plugin versions are independent; the current Plugin is version **2.4.0**, and its resolver selects `bin/coordinate-agents-legacy.mjs`.
:::

This guide preserves the optional Legacy Skill installation lifecycle.
For Web Workspace use [AI installation guide](./install-with-ai.html). Human-readable usage remains in [README.md](https://github.com/hogancv/coordinate-agents/blob/main/README.md) and
[README.zh-CN.md](https://github.com/hogancv/coordinate-agents/blob/main/README.zh-CN.md).

<div id="contents--目录" class="doc-anchor" aria-hidden="true"></div>
<div id="目录" class="doc-anchor" aria-hidden="true"></div>

## Contents

- [Canonical identity](#canonical-identity)
- [Architecture & Scope: Host Skill vs Project Agent](#architecture-scope-host-skill-vs-project-agent)
- [Plugin-first onboarding](#plugin-first-onboarding)
- [Installation Strategy by Target Host](#installation-strategy-by-target-host)
- [Security rules](#security-rules)
- [Preflight checks](#preflight-checks)
- [Install both agents](#install-both-agents)
- [Install Codex only](#install-codex-only)
- [Install Antigravity only](#install-antigravity-only)
- [Verify installation](#verify-installation)
- [Use in Codex App](#use-in-codex-app)
- [Configure executable commands](#configure-executable-commands)
- [Start the first task](#start-the-first-task)
- [Upgrade](#upgrade)
- [Uninstall](#uninstall)
- [Restore a backup](#restore-a-backup)
- [Troubleshooting](#troubleshooting)

<a id="architecture--scope-host-skill-vs-project-agent--架构与范围-宿主技能与项目代理"></a>

<div id="architecture--scope-host-skill-vs-project-agent--架构与范围宿主技能与项目代理" class="doc-anchor" aria-hidden="true"></div>
<div id="architecture--scope-host-skill-vs-project-agent" class="doc-anchor" aria-hidden="true"></div>

## Architecture & Scope: Host Skill vs Project Agent

`coordinate-agents` provides two distinct layers:

1. **Host Skill Installation (User Environment)**:
   - Installs the coordination Skill for OpenAI Codex App/CLI (Codex CLI standalone path at `~/.codex/skills/coordinate-agents`) and/or Google Antigravity CLI at `~/.gemini/skills/coordinate-agents`.
   - These first-party App/CLI hosts act as default reference adapters for interactive AI workflows.

2. **Project-Local Agent Registration & Protocol Runtime (Git Repository)**:
   - A durable, serverless `.agent-bus` protocol engine in each Git project.
   - Dynamic agents and custom tools can be registered into the project via `npx @hogancv/coordinate-agents@2.4.0 agent add <id> --adapter <adapter>`.
   - Contract v1 adapter modules are trusted local code and must be explicitly registered with `npx @hogancv/coordinate-agents@2.4.0 adapter register <local-file>`; the loader never scans directories or imports URLs.
   - Adapter authors can start with the offline [External Adapter Author Guide](./adapter-author-guide.html) and its bundled minimal example.
   - Flexible workflow roles (`planner`, `implementer`, `reviewer`) are mapped to registered agents during `quickstart`.

<a id="plugin-first-onboarding--插件优先的首次使用"></a>

## Plugin-first onboarding

Codex Plugin is the entry point for the optional structured workflow. It discovers the local
Coding CLIs, configures an Implementer, and exposes a durable Task API over the
existing Agent Bus. The focused Skills are `coordinate-agents`,
`coordinate-setup`, `coordinate-task`, `coordinate-review`, and
`coordinate-recover`. The npm CLI remains the Runtime/fallback and advanced
debugging surface.

The Plugin homepage prompts are deliberately ordered as Discover → Configure →
Try. The Try prompt uses the ordinary Task workflow for the Todo web app; it
does not create a special demo path. Normal Plugin machine operations use the
structured MCP tools and return the existing JSON Runtime contract. Task
dispatch opens or reuses a persistent Execution Session and stores a non-owning
`sessionId`; it does not automate the Codex App Terminal UI:

**A Codex Plugin user does not need `npm install -g @hogancv/coordinate-agents`.** All five Skills
use the bundled Coordinate Agents MCP server first, never by assuming a PATH command. If MCP is
unavailable, or the user explicitly requests debugging, use the fallback resolver.
The following shell syntax is fallback/debug/standalone only, not the normal
Plugin machine path:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" <command> ...
```

The active Skill supplies the absolute `<skill-dir>`. The resolver handles the active Plugin payload,
personal local marketplace sources, cached Git marketplace roots, Node/npm package fallback, and
Windows paths with spaces. The npm CLI remains a standalone Runtime, compatibility, and debugging
surface, not a Plugin prerequisite. Do not silently retry between MCP and fallback.

Fallback/debug examples only:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" setup --root "<repository>" --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task status --root "<repository>" --json
```

For example, after the user chooses native `agy`:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" setup configure --agent antigravity --command agy --adapter antigravity-cli --root "<repository>" --json
```

After discovery, the Skill must use one high-level `setup configure` transaction. It writes the
machine command, registers the project Agent with its Adapter, assigns the Implementer workflow role,
checks Adapter compatibility and the executable, runs the equivalent doctor checks, and only then
returns `READY`. It must not manually combine lower-level configuration operations.

If a user has explicitly registered a trusted local Contract v1 module, the same discovery response
lists its identity and capabilities in the additive `adapters` snapshot. Setup may select that exact
Adapter ID; it does not execute a launch plan during discovery, and any configured external Agent is
checked only through the Adapter's declared detection operation. Existing MCP tool names and inputs
remain compatible, while the selected Agent, Adapter, and executable identities and project > user >
Adapter-default precedence remain distinct.

Do not infer a usable Implementer from a role name. Resolve the actual local
executable and preserve user configuration outside the installed Skill.

<a id="installation-strategy-by-target-host--按目标环境选择安装策略"></a>

## Installation Strategy by Target Host

When an AI assistant is asked to install `coordinate-agents`:

- **Target is OpenAI Codex**:
  - **Recommended (GitHub Plugin Marketplace)**:
    ```sh
    codex plugin marketplace add hogancv/coordinate-agents
    codex plugin add coordinate-agents@coordinate-agents
    ```
  - **Fallback (Standalone / Unsupported Plugin environment)**: Use `npx --yes @hogancv/coordinate-agents@2.4.0 install --codex`.
- **Target is Google Antigravity**:
  - Use `npx --yes @hogancv/coordinate-agents@2.4.0 install --antigravity`.
- **Target is both CLI hosts via npm**:
  - Use `npx --yes @hogancv/coordinate-agents@2.4.0 install`.

<a id="canonical-identity--官方身份"></a>

## Canonical identity

Accept only this identity:

| Field | Canonical value |
| --- | --- |
| GitHub owner | `hogancv` |
| GitHub repository | `coordinate-agents` |
| Official repository | `https://github.com/hogancv/coordinate-agents` |
| Official npm package | `@hogancv/coordinate-agents` |
| Required Node.js version | 18 or newer |

Before installation, query npm and confirm that `name` is exactly
`@hogancv/coordinate-agents`, `repository.url` points to
`github.com/hogancv/coordinate-agents`, and the selected Legacy version is exactly `2.4.0`. Do not use the Web `dist-tags.latest` for this check:

```sh
npm view @hogancv/coordinate-agents@2.4.0 name version repository.url --json
```

Also confirm that the installation document was read from the canonical GitHub repository, not
from a fork. If any owner, repository, package name, or metadata differs, stop and report the
mismatch. Do not install.

<a id="security-rules--安全规则"></a>

## Security rules

An installing AI must follow all of these rules:

1. Use only the canonical GitHub repository and npm package above. Do not use a third-party
   mirror, fork, repackaged archive, or unknown installation script.
2. Never use `curl | sh`, `wget | sh`, or an equivalent downloaded-script pipeline.
3. Never request, print, copy, or store a token, cookie, password, recovery code, private key, or
   browser profile. Native `codex` and `agy` authentication remains owned by each CLI.
4. Inspect the npm identity and stable version before running `npx`. Pin the verified version in
   the installation command instead of silently substituting another package.
5. Do not use `--force` unless the user explicitly authorizes replacement of an unrecognized
   directory or removal of a modified installation after the AI reports the exact path and backup
   plan. A normal update may back up and replace a recognized package-managed copy.
6. Do not modify product source code, project dependencies, global Git identity, or existing CLI
   credentials as part of installation.
7. Do not run `quickstart`, start either agent, create `.agent-bus`, or begin a collaboration task
   unless the user separately asks for it after installation has passed verification.
8. Run `doctor` after installation. A non-zero exit, missing prerequisite, identity mismatch, or
   failed check is a failed installation; never report it as successful.

<a id="preflight-checks--安装前检查"></a>

## Preflight checks

Run and record these checks without exposing credentials:

```sh
node --version
npm --version
git --version
codex --version
agy --version
npm view @hogancv/coordinate-agents@2.4.0 name version repository.url --json
```

Requirements:

- `node --version` must report Node.js 18 or newer.
- `npm` and `git` must run successfully.
- `codex` and `agy` must both run successfully when installing both agents. For a single-agent
  install, the selected CLI is mandatory; still report the other CLI as present or missing.
- The npm identity checks in [Canonical identity](#canonical-identity) must pass.

If a prerequisite is missing, stop before changing skill directories, report the exact failed
check, and use only the prerequisite vendor's official documentation or the platform's trusted
package manager. Do not improvise a downloaded shell script. Authentication may require the user
to complete the CLI's own browser flow; do not ask the user to provide the resulting credential.

<a id="install-both-agents--安装两个代理"></a>

## Install both agents

Use the verified Legacy version `2.4.0` for every command in this guide:

```sh
npx --yes @hogancv/coordinate-agents@2.4.0 install
npx --yes @hogancv/coordinate-agents@2.4.0 doctor --lang zh-CN
```

For these structured installers, verify the fixed Legacy version with `npm view @hogancv/coordinate-agents@2.4.0 name version repository.url --json`. `dist-tags.latest` now selects Web; do not use it for Skill installation. The second command is
mandatory.

<a id="install-codex-only--只安装-codex"></a>

## Install Codex only

```sh
npx --yes @hogancv/coordinate-agents@2.4.0 install --codex
npx --yes @hogancv/coordinate-agents@2.4.0 doctor --codex --lang zh-CN
```

This installs only the Codex skill copy. It does not install or authenticate the Codex CLI itself.

<a id="install-antigravity-only--只安装-antigravity"></a>

## Install Antigravity only

```sh
npx --yes @hogancv/coordinate-agents@2.4.0 install --antigravity
npx --yes @hogancv/coordinate-agents@2.4.0 doctor --antigravity --lang zh-CN
```

This installs only the Antigravity skill copy. It does not install or authenticate `agy` itself.

<a id="verify-installation--验证安装"></a>

## Verify installation

The selected `doctor` command must exit with status 0 and report every prerequisite and selected
skill as healthy. Report at least:

- the exact verified npm version;
- versions detected for Node.js, Git, `codex`, and `agy`;
- which agent skill copies were installed;
- the resolved installation directories;
- the `doctor` exit status and any remaining warnings.

Default write locations are:

```text
~/.codex/skills/coordinate-agents
~/.gemini/skills/coordinate-agents
```

`CODEX_HOME`, `GEMINI_HOME`, `--codex-home`, and `--antigravity-home` can change those roots. The
installer writes a staging directory next to the target and then renames it into place. When it
updates a package-managed copy, it preserves the previous directory as a sibling named like:

```text
coordinate-agents.backup-YYYY-MM-DDTHH-MM-SS-mmmZ
```

`npx` may also use the user's npm cache. Installation alone does not write `.agent-bus`, modify
the current product repository, or start an agent. Restart the selected CLI or start a new Codex
App thread after installation so it rediscovers the skill.

<a id="use-in-codex-app--在-codex-app-中使用"></a>

## Use in Codex App

After the Codex plugin installation is verified, Codex App can use this Skill directly. This is
the recommended interactive path when the user has Codex App: it does not require manually opening
two CLI windows or copying two launch commands.

1. Add or open the target Git repository in Codex App.
2. Set the thread's project/workspace path to the repository root, the directory containing `.git`.
3. Start a new thread and invoke `$coordinate-agents`.
4. Ask Codex to initialize or coordinate the task in that project.

The App thread remains the Planner/Reviewer side. The Runtime opens or reuses a project/Agent-scoped
persistent PTY Execution Session for the configured Implementer CLI, so the Implementer command must
be installed and correct even though the user does not open a second CLI window manually. The Session
is independent of the Codex App Terminal UI. The Plugin Runtime is already bundled; do not ask the
user to install a global npm CLI. Use the actual executable command, for example `agy` or `claude`,
not a role label or a command that exists only on another machine. For advanced npm compatibility or
debugging, the older lower-level commands remain available:

```sh
# Default Antigravity Implementer

npx --yes @hogancv/coordinate-agents@2.4.0 config set agent.antigravity.command agy

# Custom Claude Code Implementer
npx --yes @hogancv/coordinate-agents@2.4.0 agent add claude \
  --adapter generic-cli --command claude \
  --args '["--print", "{prompt}"]'
```

The App project path and the Implementer command are independent checks: a wrong project path
selects the wrong repository, while a wrong command prevents the Implementer from starting. Do not
start a collaboration task during installation; use this flow only after the user separately asks
to work in the selected project.

For any other CLI, prefer an AI-assisted configuration conversation so the installed executable and
its actual help output are checked before arguments are saved. For example, ask the active Codex App
thread:

```text
Use $coordinate-agents to configure Claude Code as the Implementer for this project. Inspect the
installed `claude` executable and `claude --help`, register it with `generic-cli`, choose only flags
supported by this installed version for the prompt and project root, run `doctor`, and show me the
resolved configuration. Do not start a collaboration task until I confirm.
```

`generic-cli` supports `{prompt}`, `{root}`, `{agent}`, and `{lang}` placeholders. The runtime also
sets the selected project root as the child process working directory, so do not assume that a
vendor-specific `--dir` flag exists. Keep the exact `args` produced by the AI only after checking
the selected CLI's own help output.

For an adapter that implements the public Contract v1, register one exact local module before using
its adapter ID. Registration validates the descriptor before writing the user configuration and does
not touch the project Bus:

```sh
npx --yes @hogancv/coordinate-agents@2.4.0 adapter register "<absolute-local-adapter.mjs>" --json
npx --yes @hogancv/coordinate-agents@2.4.0 adapter list --json
```

Only regular `.mjs`, `.js`, or `.cjs` files without symlink/junction/hard-link paths are accepted.
The module runs with the current Node.js permissions; this is a trust boundary, not a JavaScript
sandbox. Failed registration leaves the user configuration and project `.agent-bus` unchanged.

::: warning Permission-version boundary
The permission examples below describe published npm 2.4.0. Web 3.0.2 and current source allow choosing Antigravity prompt mode or automatic approval in Workspace settings; the adapter default is `--dangerously-skip-permissions`, overridden by explicit saved args.
:::

<a id="configure-executable-commands--配置可执行命令"></a>

## Configure executable commands

Machine-specific CLI commands belong in the user-level file below, not in the installed Skill or
Plugin tree:

```text
~/.coordinate-agents/config.json
```

For example, use native Antigravity and inspect the result:

```sh
npx --yes @hogancv/coordinate-agents@2.4.0 config set agent.antigravity.command agy
npx --yes @hogancv/coordinate-agents@2.4.0 config get agent.antigravity.command
npx --yes @hogancv/coordinate-agents@2.4.0 config list
```

Resolution is **explicit project command > user command > Adapter default**. A configured command
that is missing or fails its executable check is fatal for the current launch; it is never silently
replaced with `agy` or another default. `doctor` reports the final command. The runtime checks
executable readiness but does not probe login state, provider health, or model availability; those
errors are handled as runtime failures after launch. The user file is outside `skills/`,
`.codex-plugin/`, and npm package update payloads, so installation and updates preserve it.

Permission and sandbox flags are vendor-specific and explicit. The legacy one-shot
`antigravity-cli` launch passes configured `args` and then appends `--prompt-interactive <prompt>`.
For a persistent Session, the adapter starts `--prompt-interactive ""` so current `agy`
parsers receive the required empty initial prompt value, then writes the first instruction through
the PTY unless configured args explicitly include `{prompt}`. The Adapter does not add
`--dangerously-skip-permissions` or another full-permission flag automatically. If the local `agy`
configuration already enables full permissions, it remains in effect. If the installed `agy --help`
confirms the explicit flag is required and the user asks to use it, configure it in the user file:

```sh
npx --yes @hogancv/coordinate-agents@2.4.0 config set agent.antigravity.args '["--dangerously-skip-permissions"]'
npx --yes @hogancv/coordinate-agents@2.4.0 config list
```

`config list` shows the configured user arguments; `doctor` verifies executable/version readiness,
not the provider's effective permission state. Never copy a permission flag between CLI vendors or
versions without checking that CLI's help output.

<a id="start-the-first-task--开始首个任务"></a>

## Start the first task

Only after verification succeeds **and the user explicitly asks to begin collaboration**, use the
following path from the user's Git repository. Codex remains Planner/Reviewer; it must not bypass the
configured Implementer or automate a Codex App Terminal panel. Persistent Session status, output,
input, and close are Runtime operations with bounded I/O; they are not UI automation.

For Codex App, add or open the repository as a project, set the thread project/workspace path to
the repository root containing `.git`, start a new thread, and invoke `$coordinate-agents`. Do not
manually open a second CLI window. The Runtime opens or reuses the configured Implementer Session,
so verify the command is the real local command such as `agy` or `claude`.

For CLI-only hosts, run `quickstart`:

```sh
npx --yes @hogancv/coordinate-agents@2.4.0 quickstart --root . --template feature --task "<USER_TASK>"
```

This creates project-local `.agent-bus/` data and adds `.agent-bus/` to the repository's local
`.git/info/exclude`. It prints two commands but does not launch them itself. The Codex App path does
not require manually running those two commands. Do not invent a task, run the printed commands, or
modify product code unless the user asked for those actions.

<a id="upgrade--更新"></a>

## Upgrade

Repeat the canonical identity check against Legacy `2.4.0`, then run its update
and matching doctor command. Do not upgrade a Skill install to the Web-only npm latest:

```sh
# Both agents
npx --yes @hogancv/coordinate-agents@2.4.0 update
npx --yes @hogancv/coordinate-agents@2.4.0 doctor --lang zh-CN

# Or add --codex / --antigravity to both commands for one agent only.
```

The updater backs up a recognized package-managed copy, including a modified managed copy, before
replacement. It refuses to replace an unrecognized directory unless `--force` is explicitly
authorized.

<a id="uninstall--卸载"></a>

## Uninstall

Uninstall only package-managed copies, then verify that the selected targets are absent:

```sh
# Both agents
npx --yes @hogancv/coordinate-agents@2.4.0 uninstall

# One agent only
npx --yes @hogancv/coordinate-agents@2.4.0 uninstall --codex
npx --yes @hogancv/coordinate-agents@2.4.0 uninstall --antigravity
```

The command refuses to remove an unrecognized or modified directory unless the user explicitly
authorizes `--force`. Uninstalling a skill does not remove Node.js, Git, Codex CLI, Antigravity CLI, native
accounts, npm cache data, previous sibling backups, product code, or project-local `.agent-bus`.
Do not delete any of those automatically.

<a id="restore-a-backup--恢复备份"></a>

## Restore a backup

1. List sibling directories matching `coordinate-agents.backup-*` under the relevant
   `skills` directory.
2. Show the exact candidate path, timestamp, and current target state to the user.
3. Obtain explicit user confirmation for the selected backup.
4. If the current target is package-managed, uninstall it normally. Never overwrite an
   unrecognized target.
5. Rename the confirmed backup directory to exactly `coordinate-agents` on the same volume.
6. Run the selected `doctor` command. A restored older copy may require invoking the matching
   package version recorded in its `.coordinate-agents.json` metadata.

Do not guess which backup to restore and do not delete unused backups without separate user
approval.

<a id="troubleshooting--故障排查"></a>

## Troubleshooting

| Symptom | Required response |
| --- | --- |
| Identity metadata differs | Stop. Report the mismatched field; do not install. |
| Node.js is older than 18 | Stop and update Node.js from an official/vendor or trusted platform source. |
| `codex` or `agy` is missing | Report it and use the CLI vendor's official installation documentation; do not use an unknown script. |
| Browser login is required | Ask the user only to finish the CLI's native browser flow, then rerun the check; never request the credential. |
| npm/network error | Preserve existing installs, report the command and sanitized error, then retry only after connectivity or registry identity is verified. |
| Unrecognized skill directory | Preserve it. Report its exact path and propose a backup/move; do not add `--force` automatically. |
| `doctor` exits non-zero | Treat installation as failed, run the printed non-destructive repair where appropriate, and rerun `doctor`. |
| Package-managed update fails | The installer attempts to restore its backup. Verify both target and backup paths, then report the actual state. |
| Skill is not discovered | Confirm the resolved home directory, restart the CLI, and rerun the selected `doctor` command. |

In every failure report, distinguish completed changes from attempted changes, redact secrets, and
give the exact remaining issue. Never infer success from files merely existing.
