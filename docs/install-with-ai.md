---
layout: page
title: Install with AI
description: Complete Codex App/CLI and Antigravity installation conversations, direct App usage, safe command boundaries, error recovery, and a verifiable result template.
---

# Install with AI

The canonical bilingual contract is
[`AI_INSTALL.md`](https://github.com/hogancv/coordinate-agents/blob/main/AI_INSTALL.md).
An AI installer should read that file first, verify identity, execute only the selected installation,
and prove the result with `doctor`. It must not treat a successful npm command as sufficient proof.

## Codex installation conversation

```text
User: Install coordinate-agents for Codex from the official project. Verify it and do not start
      a collaboration task.

Codex: I will verify the official repository and npm metadata, inspect AI_INSTALL.md, check Node,
       Git, and Codex CLI, install only the Codex Skill, then run doctor. I will not request or copy
       credentials and will not run quickstart.

[executes]
npm view @hogancv/coordinate-agents dist-tags.latest repository.url --json
node --version
git --version
codex --version
npx --yes @hogancv/coordinate-agents@<verified-version> install --codex
npx --yes @hogancv/coordinate-agents@<verified-version> doctor --codex

Codex: Installation verified. Package owner/name and repository matched; Node and Git passed;
       Codex CLI was found; the managed Codex Skill is healthy. Antigravity was not modified.
```

The AI should substitute the exact stable version returned by npm, not guess it and not silently
switch to a fork.

## Use directly in Codex App

After installation is verified and the user asks to start work, Codex App can invoke the Skill
directly:

1. Add or open the target Git repository as a Codex App project.
2. Set the thread project/workspace path to the repository root containing `.git`.
3. Start a new thread and invoke `$coordinate-agents`.

This path does not require manually opening two CLI windows. The runtime starts the Implementer as a
local child process, so the actual execution command must be installed and configured correctly,
for example `agy` or `claude`. The App thread and the Implementer command must use the same machine;
the project path and command are independent checks.

For another CLI, ask the active Codex App thread to inspect the installed executable and its help
output before saving a `generic-cli` configuration:

```text
Use $coordinate-agents to configure Claude Code as the Implementer for this project. Inspect the
installed `claude` executable and `claude --help`, register it with `generic-cli`, choose only flags
supported by this installed version for the prompt and project root, run `doctor`, and show me the
resolved configuration. Do not start a collaboration task until I confirm.
```

The runtime sets the project root as the child process working directory. Do not copy a guessed
vendor-specific `--dir` or prompt flag; verify the CLI's help output first.

## Antigravity installation conversation

```text
User: Install coordinate-agents for Google Antigravity CLI only. Keep my existing login.

Antigravity: I will verify the official package and AI_INSTALL.md, check prerequisites, install only
             the Antigravity Skill, and run the selected doctor check. I will not read, move, or
             print your agy credentials.

[executes]
npm view @hogancv/coordinate-agents dist-tags.latest repository.url --json
node --version
git --version
agy --version
npx --yes @hogancv/coordinate-agents@<verified-version> install --antigravity
npx --yes @hogancv/coordinate-agents@<verified-version> doctor --antigravity

Antigravity: Installation verified. The managed Antigravity Skill is healthy at the reported path;
             Codex was not modified and no collaboration task was started.
```

## Commands the AI may execute

- Read the official GitHub files and query public npm metadata.
- Run `node --version`, `git --version`, `codex --version`, and/or `agy --version`.
- Run exact-version `install`, `update`, or `doctor` for the user-selected target.
- Inspect an existing unknown Skill directory without changing it.
- Report a browser login action if the selected native CLI itself requires authentication.

## Commands the AI must not execute implicitly

- `curl ... | sh`, a third-party mirror, or a mutable unknown installer.
- `install --force`, `update --force`, `uninstall --force`, recursive deletion, or backup removal.
- Commands that print or copy tokens, cookies, passwords, recovery codes, or authentication files.
- `quickstart`, `launch`, model prompts, product-code edits, Git commits, pushes, or releases.
- Installation into both agent homes when the user selected only one.

Those actions require a separate, explicit request. Installation authorization is not task or
release authorization.

## Common failures and recovery

**Node.js is below 18.** Stop before installation, install a supported LTS from an official source,
open a fresh terminal, and verify `node --version` again.

**`codex` or `agy` is missing.** Install the native CLI from its official source, authenticate it,
and verify its own `--version` and model interaction before installing this Skill.

**Full permissions are unclear.** The built-in Antigravity Adapter does not add a permission bypass
flag. It passes configured `args` and appends `--prompt-interactive <prompt>`. If the installed
`agy --help` confirms `--dangerously-skip-permissions` and the user explicitly wants it, configure
it with `config set agent.antigravity.args '["--dangerously-skip-permissions"]'`; `config list` shows
the saved user arguments, while `doctor` checks executable/version readiness only. A native `agy`
configuration that already enables full permissions is not overridden by the Plugin.

**The target directory is unrecognized or modified.** Do not force it. Report the exact path,
inspect it for user content, and ask the user to choose backup/migration or a different Skill home.

**`doctor` exits non-zero.** Treat installation as incomplete. Preserve the full redacted output,
apply only the relevant printed suggestion after checking it for the detected platform, and rerun
the same selected-target `doctor` command.

For exact diagnostic examples, see [troubleshooting](./troubleshooting.html).

## Installation result report

```text
Package: @hogancv/coordinate-agents@<verified-version>
Repository: https://github.com/hogancv/coordinate-agents
Selected target: Codex | Antigravity | both
Node.js: <version, PASS/FAIL>
Git: <version, PASS/FAIL>
Codex CLI: <version, PASS/FAIL/not selected>
Antigravity CLI: <version, PASS/FAIL/not selected>
Installed path(s): <path(s) without credential data>
Managed Skill verification: PASS/FAIL
doctor command and exit status: <command>, <status>
Backups created: <none or exact path>
Credentials accessed or copied: no
Collaboration task started: no
Unresolved issues: <none or exact failure and next safe action>
```

Only a report with a healthy selected installation and `doctor` exit status `0` is complete.
