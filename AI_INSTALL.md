# AI installation guide / AI 安装指南

This is the canonical installation procedure for AI assistants installing
`coordinate-cli-agents`. Human-readable usage remains in [README.md](./README.md) and
[README.zh-CN.md](./README.zh-CN.md).

本文件是 AI 助手安装 `coordinate-cli-agents` 时必须遵循的唯一安装流程。面向用户的使用说明见
[README.md](./README.md) 和 [README.zh-CN.md](./README.zh-CN.md)。

## Contents / 目录

- [Canonical identity](#canonical-identity--官方身份)
- [Security rules](#security-rules--安全规则)
- [Preflight checks](#preflight-checks--安装前检查)
- [Install both agents](#install-both-agents--安装两个代理)
- [Install Codex only](#install-codex-only--只安装-codex)
- [Install Antigravity only](#install-antigravity-only--只安装-antigravity)
- [Verify installation](#verify-installation--验证安装)
- [Start the first task](#start-the-first-task--开始首个任务)
- [Upgrade](#upgrade--更新)
- [Uninstall](#uninstall--卸载)
- [Restore a backup](#restore-a-backup--恢复备份)
- [Troubleshooting](#troubleshooting--故障排查)

## Canonical identity / 官方身份

Accept only this identity:

| Field | Canonical value |
| --- | --- |
| GitHub owner | `hogancv` |
| GitHub repository | `coordinate-cli-agents` |
| Official repository | `https://github.com/hogancv/coordinate-cli-agents` |
| Official npm package | `@hogancv/coordinate-cli-agents` |
| Required Node.js version | 18 or newer |

Before installation, query npm and confirm that `name` is exactly
`@hogancv/coordinate-cli-agents`, `repository.url` points to
`github.com/hogancv/coordinate-cli-agents`, and `dist-tags.latest` is a stable SemVer without a
prerelease suffix:

```sh
npm view @hogancv/coordinate-cli-agents name version dist-tags.latest repository.url --json
```

Also confirm that the installation document was read from the canonical GitHub repository, not
from a fork. If any owner, repository, package name, or metadata differs, stop and report the
mismatch. Do not install.

安装前必须确认仓库 owner 为 `hogancv`、仓库名为 `coordinate-cli-agents`、npm 包名为
`@hogancv/coordinate-cli-agents`，并确认 `dist-tags.latest` 指向不含预发布后缀的稳定 SemVer。
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
npm view @hogancv/coordinate-cli-agents name version dist-tags.latest repository.url --json
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
npx --yes @hogancv/coordinate-cli-agents@<VERIFIED_VERSION> install
npx --yes @hogancv/coordinate-cli-agents@<VERIFIED_VERSION> doctor --lang zh-CN
```

Do not use a version different from the verified `dist-tags.latest` value. The second command is
mandatory.

## Install Codex only / 只安装 Codex

```sh
npx --yes @hogancv/coordinate-cli-agents@<VERIFIED_VERSION> install --codex
npx --yes @hogancv/coordinate-cli-agents@<VERIFIED_VERSION> doctor --codex --lang zh-CN
```

This installs only the Codex skill copy. It does not install or authenticate the Codex CLI itself.

## Install Antigravity only / 只安装 Antigravity

```sh
npx --yes @hogancv/coordinate-cli-agents@<VERIFIED_VERSION> install --antigravity
npx --yes @hogancv/coordinate-cli-agents@<VERIFIED_VERSION> doctor --antigravity --lang zh-CN
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
~/.codex/skills/coordinate-cli-agents
~/.gemini/skills/coordinate-cli-agents
```

`CODEX_HOME`, `GEMINI_HOME`, `--codex-home`, and `--antigravity-home` can change those roots. The
installer writes a staging directory next to the target and then renames it into place. When it
updates a package-managed copy, it preserves the previous directory as a sibling named like:

```text
coordinate-cli-agents.backup-YYYY-MM-DDTHH-MM-SS-mmmZ
```

`npx` may also use the user's npm cache. Installation alone does not write `.agent-bus`, modify
the current product repository, or start an agent. Restart the selected CLI after installation so
it rediscovers the skill.

## Start the first task / 开始首个任务

Only after verification succeeds **and the user explicitly asks to begin collaboration**, run
`quickstart` from the user's Git repository:

```sh
npx --yes @hogancv/coordinate-cli-agents@<VERIFIED_VERSION> quickstart --root . --template feature --task "<USER_TASK>"
```

This creates project-local `.agent-bus/` data and adds `.agent-bus/` to the repository's local
`.git/info/exclude`. It prints two commands but does not launch them itself. Do not invent a task,
run the printed commands, or modify product code unless the user asked for those actions.

## Upgrade / 更新

Repeat the canonical identity check, record the newly verified stable version, then run the
appropriate exact-version update and matching doctor command:

```sh
# Both agents
npx --yes @hogancv/coordinate-cli-agents@<VERIFIED_VERSION> update
npx --yes @hogancv/coordinate-cli-agents@<VERIFIED_VERSION> doctor --lang zh-CN

# Or add --codex / --antigravity to both commands for one agent only.
```

The updater backs up a recognized package-managed copy, including a modified managed copy, before
replacement. It refuses to replace an unrecognized directory unless `--force` is explicitly
authorized.

## Uninstall / 卸载

Uninstall only package-managed copies, then verify that the selected targets are absent:

```sh
# Both agents
npx --yes @hogancv/coordinate-cli-agents@<VERIFIED_VERSION> uninstall

# One agent only
npx --yes @hogancv/coordinate-cli-agents@<VERIFIED_VERSION> uninstall --codex
npx --yes @hogancv/coordinate-cli-agents@<VERIFIED_VERSION> uninstall --antigravity
```

The command refuses to remove an unrecognized or modified directory unless the user explicitly
authorizes `--force`. Uninstalling a skill does not remove Node.js, Git, Codex CLI, Antigravity CLI, native
accounts, npm cache data, previous sibling backups, product code, or project-local `.agent-bus`.
Do not delete any of those automatically.

## Restore a backup / 恢复备份

1. List sibling directories matching `coordinate-cli-agents.backup-*` under the relevant
   `skills` directory.
2. Show the exact candidate path, timestamp, and current target state to the user.
3. Obtain explicit user confirmation for the selected backup.
4. If the current target is package-managed, uninstall it normally. Never overwrite an
   unrecognized target.
5. Rename the confirmed backup directory to exactly `coordinate-cli-agents` on the same volume.
6. Run the selected `doctor` command. A restored older copy may require invoking the matching
   package version recorded in its `.coordinate-cli-agents.json` metadata.

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
