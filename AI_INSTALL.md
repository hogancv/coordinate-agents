# AI installation guide / AI 安装指南

This is the canonical installation procedure for AI assistants installing
`coordinate-agents`. Human-readable usage remains in [README.md](./README.md) and
[README.zh-CN.md](./README.zh-CN.md).

本文件是 AI 助手安装 `coordinate-agents` 时必须遵循的唯一安装流程。面向用户的使用说明见
[README.md](./README.md) 和 [README.zh-CN.md](./README.zh-CN.md)。

## Contents / 目录

- [Canonical identity](#canonical-identity--官方身份)
- [Architecture & Scope: Host Skill vs Project Agent](#architecture--scope-host-skill-vs-project-agent--架构与范围-宿主技能与项目代理)
- [Installation Strategy by Target Host](#installation-strategy-by-target-host--按目标环境选择安装策略)
- [Security rules](#security-rules--安全规则)
- [Preflight checks](#preflight-checks--安装前检查)
- [Install both agents](#install-both-agents--安装两个代理)
- [Install Codex only](#install-codex-only--只安装-codex)
- [Install Antigravity only](#install-antigravity-only--只安装-antigravity)
- [Verify installation](#verify-installation--验证安装)
- [Use in Codex App](#use-in-codex-app--在-codex-app-中使用)
- [Configure executable commands](#configure-executable-commands--配置可执行命令)
- [Start the first task](#start-the-first-task--开始首个任务)
- [Upgrade](#upgrade--更新)
- [Uninstall](#uninstall--卸载)
- [Restore a backup](#restore-a-backup--恢复备份)
- [Troubleshooting](#troubleshooting--故障排查)

## Architecture & Scope: Host Skill vs Project Agent / 架构与范围：宿主技能与项目代理

`coordinate-agents` provides two distinct layers:

1. **Host Skill Installation (User Environment)**:
   - Installs the coordination Skill for OpenAI Codex App/CLI (Codex CLI standalone path at `~/.codex/skills/coordinate-agents`) and/or Google Antigravity CLI at `~/.gemini/skills/coordinate-agents`.
   - These first-party App/CLI hosts act as default reference adapters for interactive AI workflows.

2. **Project-Local Agent Registration & Protocol Runtime (Git Repository)**:
   - A durable, serverless `.agent-bus` protocol engine in each Git project.
   - Dynamic agents and custom tools can be registered into the project via `npx @hogancv/coordinate-agents agent add <id> --adapter <adapter>`.
   - Flexible workflow roles (`planner`, `implementer`, `reviewer`) are mapped to registered agents during `quickstart`.

`coordinate-agents` 包含两个不同层级：
1. **宿主技能安装（用户环境）**：将技能安装到 Codex App/CLI 与 Antigravity CLI 等宿主环境中，作为交互式默认参考适配器。
2. **项目级代理注册与协议运行时（Git 仓库）**：在具体项目中通过 `.agent-bus` 协调多代理，可通过 `agent add` 注册任意 CLI/桌面代理，并灵活分配角色（规划者、实现者、审查者）。

## Plugin-first onboarding / 插件优先的首次使用

Codex Plugin is the preferred product entry point. It discovers the local
Coding CLIs, configures an Implementer, and exposes a durable Task API over the
existing Agent Bus. The focused Skills are `coordinate-agents`,
`coordinate-setup`, `coordinate-task`, `coordinate-review`, and
`coordinate-recover`. The npm CLI remains the Runtime/fallback and advanced
debugging surface.

The Plugin homepage prompts are deliberately ordered as Discover → Configure →
Try. The Try prompt uses the ordinary Task workflow for the Todo web app; it
does not create a special demo path. Runtime state should be read through JSON:

```sh
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> setup --json
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> task status --json
```

Do not infer a usable Implementer from a role name. Resolve the actual local
executable and preserve user configuration outside the installed Skill.

## Installation Strategy by Target Host / 按目标环境选择安装策略

When an AI assistant is asked to install `coordinate-agents`:

- **Target is OpenAI Codex**:
  - **Recommended (GitHub Plugin Marketplace)**:
    ```sh
    codex plugin marketplace add hogancv/coordinate-agents
    codex plugin add coordinate-agents@coordinate-agents
    ```
  - **Fallback (Standalone / Unsupported Plugin environment)**: Use `npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> install --codex`.
- **Target is Google Antigravity**:
  - Use `npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> install --antigravity`.
- **Target is both CLI hosts via npm**:
  - Use `npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> install`.

当 AI 助手需要安装 `coordinate-agents` 时：
- **目标环境为 OpenAI Codex**：
  - **推荐（GitHub 插件市场）**：
    ```sh
    codex plugin marketplace add hogancv/coordinate-agents
    codex plugin add coordinate-agents@coordinate-agents
    ```
  - **回退（不支持插件环境/独立技能）**：使用 `npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> install --codex`。
- **目标环境为 Google Antigravity**：
  - 使用 `npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> install --antigravity`。
- **通过 npm 同时为两个 CLI 宿主安装**：
  - 使用 `npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> install`。

## Canonical identity / 官方身份

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
`github.com/hogancv/coordinate-agents`, and `dist-tags.latest` is a stable SemVer without a
prerelease suffix:

```sh
npm view @hogancv/coordinate-agents name version dist-tags.latest repository.url --json
```

Also confirm that the installation document was read from the canonical GitHub repository, not
from a fork. If any owner, repository, package name, or metadata differs, stop and report the
mismatch. Do not install.

安装前必须确认仓库 owner 为 `hogancv`、仓库名为 `coordinate-agents`、npm 包名为
`@hogancv/coordinate-agents`，并确认 `dist-tags.latest` 指向不含预发布后缀的稳定 SemVer。
任何一项不一致都必须停止并报告，不得继续安装。

## Security rules / 安全规则

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

AI 安装时不得使用第三方镜像、Fork、未知脚本或 `curl | sh`；不得索取或输出任何凭据；不得
修改产品代码或现有认证；未经用户另行要求，不得自动启动协作任务。验证失败时不得伪装成功。

## Preflight checks / 安装前检查

Run and record these checks without exposing credentials:

```sh
node --version
npm --version
git --version
codex --version
agy --version
npm view @hogancv/coordinate-agents name version dist-tags.latest repository.url --json
```

Requirements:

- `node --version` must report Node.js 18 or newer.
- `npm` and `git` must run successfully.
- `codex` and `agy` must both run successfully when installing both agents. For a single-agent
  install, the selected CLI is mandatory; still report the other CLI as present or missing.
- The npm identity checks in [Canonical identity](#canonical-identity--官方身份) must pass.

If a prerequisite is missing, stop before changing skill directories, report the exact failed
check, and use only the prerequisite vendor's official documentation or the platform's trusted
package manager. Do not improvise a downloaded shell script. Authentication may require the user
to complete the CLI's own browser flow; do not ask the user to provide the resulting credential.

## Install both agents / 安装两个代理

Let `VERIFIED_VERSION` mean the exact stable version returned by the identity check. Substitute
that literal version for `<VERIFIED_VERSION>`:

```sh
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> install
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> doctor --lang zh-CN
```

Do not use a version different from the verified `dist-tags.latest` value. The second command is
mandatory.

## Install Codex only / 只安装 Codex

```sh
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> install --codex
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> doctor --codex --lang zh-CN
```

This installs only the Codex skill copy. It does not install or authenticate the Codex CLI itself.

## Install Antigravity only / 只安装 Antigravity

```sh
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> install --antigravity
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> doctor --antigravity --lang zh-CN
```

This installs only the Antigravity skill copy. It does not install or authenticate `agy` itself.

## Verify installation / 验证安装

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

## Use in Codex App / 在 Codex App 中使用

After the Codex plugin installation is verified, Codex App can use this Skill directly. This is
the recommended interactive path when the user has Codex App: it does not require manually opening
two CLI windows or copying two launch commands.

1. Add or open the target Git repository in Codex App.
2. Set the thread's project/workspace path to the repository root, the directory containing `.git`.
3. Start a new thread and invoke `$coordinate-agents`.
4. Ask Codex to initialize or coordinate the task in that project.

The App thread remains the Planner/Reviewer side. The runtime starts the configured Implementer CLI
as a local child process, so the Implementer command must be installed and correct even though the
user does not open a second CLI window manually. Use the actual executable command, for example
`agy` or `claude`, not a role label or a command that exists only on another machine:

```sh
# Default Antigravity Implementer
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> config set agent.antigravity.command agy

# Custom Claude Code Implementer
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> agent add claude \
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

安装并验证 Codex 插件后，可以直接在 Codex App 中使用本 Skill。对于使用 Codex App 的用户，这是推荐的
交互方式：不需要手动打开两个 CLI 窗口，也不需要复制两条启动命令。

1. 在 Codex App 中添加或打开目标 Git 项目。
2. 将线程的项目/工作区路径指定为项目根目录，也就是包含 `.git` 的目录。
3. 新建线程并调用 `$coordinate-agents`。
4. 让 Codex 在这个项目中初始化或协调任务。

App 线程负责 Planner/Reviewer 侧；运行时会在本机以子进程启动已配置的 Implementer CLI。因此，即使用户不需要
手动打开第二个 CLI 窗口，执行端命令仍必须已安装且正确，例如 `agy` 或 `claude`，不能填写角色名称或另一台机器上才存在的别名：

```sh
# 默认使用 Antigravity 作为 Implementer
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> config set agent.antigravity.command agy

# 使用 Claude Code 作为自定义 Implementer
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> agent add claude \
  --adapter generic-cli --command claude \
  --args '["--print", "{prompt}"]'
```

项目路径和执行端命令是两项独立检查：项目路径错误会选错仓库，命令错误会导致 Implementer 无法启动。安装流程本身
不得启动协作任务；只有在用户另行要求处理选定项目后，才使用这条流程。

对于其他 CLI，推荐直接通过 AI 对话完成配置，让 AI 先检查本机可执行文件和真实帮助输出。例如在 Codex App
当前线程中说：

```text
使用 $coordinate-agents，帮我把 Claude Code 配置为这个项目的 Implementer 执行端。请先检查本机
`claude` 可执行文件和 `claude --help`，使用 `generic-cli` 注册，只选择当前版本支持的提示词和项目路径参数，
运行 `doctor` 并展示最终解析配置。配置完成且我确认之前，不要启动协作任务。
```

`generic-cli` 支持 `{prompt}`、`{root}`、`{agent}`、`{lang}` 占位符；运行时也会把选定项目根目录作为子进程工作目录，
因此不要假设厂商 CLI 一定存在 `--dir`。只有在检查对应 CLI 自己的帮助输出后，才保存 AI 生成的 `args`。

## Configure executable commands / 配置可执行命令

Machine-specific CLI commands belong in the user-level file below, not in the installed Skill or
Plugin tree:

```text
~/.coordinate-agents/config.json
```

For example, configure a custom Antigravity wrapper and inspect the result:

```sh
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> config set agent.antigravity.command agy-proxy
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> config get agent.antigravity.command
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> config list
```

Resolution is **explicit project command > user command > Adapter default**. A configured command
that is missing or fails its executable check is fatal for the current launch; it is never silently
replaced with `agy` or another default. `doctor` reports the final command. The runtime checks
executable readiness but does not probe login state, provider health, or model availability; those
errors are handled as runtime failures after launch. The user file is outside `skills/`,
`.codex-plugin/`, and npm package update payloads, so installation and updates preserve it.

Permission and sandbox flags are vendor-specific and explicit. The built-in `antigravity-cli` Adapter
only passes configured `args` and then appends `--prompt-interactive <prompt>`; it does not add
`--dangerously-skip-permissions` or another full-permission flag automatically. If the local `agy`
configuration already enables full permissions, it remains in effect. If the installed `agy --help`
confirms the explicit flag is required and the user asks to use it, configure it in the user file:

```sh
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> config set agent.antigravity.args '["--dangerously-skip-permissions"]'
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> config list
```

`config list` shows the configured user arguments; `doctor` verifies executable/version readiness,
not the provider's effective permission state. Never copy a permission flag between CLI vendors or
versions without checking that CLI's help output.

机器相关的 CLI 命令应写入下面的用户级文件，而不是已安装的 Skill 或 Plugin 目录：

```text
~/.coordinate-agents/config.json
```

例如配置自定义 Antigravity 包装命令并查询结果：

```sh
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> config set agent.antigravity.command agy-proxy
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> config get agent.antigravity.command
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> config list
```

解析优先级为**项目级显式命令 > 用户级命令 > Adapter 默认值**。已配置但不存在或未通过可执行
文件检查的命令会使当前启动失败，绝不会静默替换成 `agy` 或其他默认值。`doctor` 会报告最终
命令。运行时会检查可执行文件是否就绪，但不会探测登录状态、Provider 健康度或模型可用性；
这些错误在启动后按运行时失败处理。用户配置位于 `skills/`、`.codex-plugin/` 和 npm 包更新
载荷之外，因此安装和更新会保留它。

权限和沙箱参数由各厂商决定，并且必须显式配置。内置 `antigravity-cli` Adapter 只会传递已配置的 `args`，然后追加
`--prompt-interactive <prompt>`，不会自动添加 `--dangerously-skip-permissions` 或其他完全权限参数。如果本机 `agy`
自身配置已经开启完全权限，该配置会继续生效。如果 `agy --help` 确认必须显式传入该参数，且用户明确要求使用，才写入
用户级配置：

```sh
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> config set agent.antigravity.args '["--dangerously-skip-permissions"]'
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> config list
```

`config list` 会显示用户级参数；`doctor` 只验证可执行文件和版本是否就绪，不能证明 Provider 的实际权限状态。不要在
未检查对应 CLI 帮助输出的情况下，把权限参数跨厂商或跨版本复制。

## Start the first task / 开始首个任务

Only after verification succeeds **and the user explicitly asks to begin collaboration**, use the
following path from the user's Git repository.

For Codex App, add or open the repository as a project, set the thread project/workspace path to
the repository root containing `.git`, start a new thread, and invoke `$coordinate-agents`. Do not
manually open a second CLI window. The runtime still starts the configured Implementer executable
as a local child process, so verify the command is the real local command such as `agy` or `claude`.

For CLI-only hosts, run `quickstart`:

```sh
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> quickstart --root . --template feature --task "<USER_TASK>"
```

This creates project-local `.agent-bus/` data and adds `.agent-bus/` to the repository's local
`.git/info/exclude`. It prints two commands but does not launch them itself. The Codex App path does
not require manually running those two commands. Do not invent a task, run the printed commands, or
modify product code unless the user asked for those actions.

Codex App 中，只有在验证通过且用户**明确要求开始协作**后，才可将仓库添加或打开为项目，将线程项目/工作区路径指定为
包含 `.git` 的项目根目录，在新线程中调用 `$coordinate-agents`。不需要手动打开第二个 CLI 窗口；但运行时仍会以本地子进程
启动已配置的 Implementer，因此必须确认执行命令是真实存在的 `agy`、`claude` 或包装命令。

仅 CLI 宿主则运行上面的 `quickstart` 流程。

## Upgrade / 更新

Repeat the canonical identity check, record the newly verified stable version, then run the
appropriate exact-version update and matching doctor command:

```sh
# Both agents
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> update
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> doctor --lang zh-CN

# Or add --codex / --antigravity to both commands for one agent only.
```

The updater backs up a recognized package-managed copy, including a modified managed copy, before
replacement. It refuses to replace an unrecognized directory unless `--force` is explicitly
authorized.

## Uninstall / 卸载

Uninstall only package-managed copies, then verify that the selected targets are absent:

```sh
# Both agents
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> uninstall

# One agent only
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> uninstall --codex
npx --yes @hogancv/coordinate-agents@<VERIFIED_VERSION> uninstall --antigravity
```

The command refuses to remove an unrecognized or modified directory unless the user explicitly
authorizes `--force`. Uninstalling a skill does not remove Node.js, Git, Codex CLI, Antigravity CLI, native
accounts, npm cache data, previous sibling backups, product code, or project-local `.agent-bus`.
Do not delete any of those automatically.

## Restore a backup / 恢复备份

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

## Troubleshooting / 故障排查

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
