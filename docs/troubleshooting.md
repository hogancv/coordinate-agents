---
layout: page
title: Troubleshooting
description: Match real coordinate-agents, Node, Codex, agy, agent-bus, Windows path, and npm metadata errors to safe recovery steps.
---

# Troubleshooting

## Plugin-first diagnosis and structured errors

Start with the Plugin-facing Task and setup surfaces rather than inspecting
queue files manually:

The Plugin path does not require a global npm CLI. Every Skill calls the active
payload through:

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" <command> ...
```

If this resolver reports `PLUGIN_RUNTIME_NOT_FOUND`, verify that the Plugin is
enabled in the current Codex installation and start a new thread; do not infer
that `coordinate-agents` must be added to `PATH`. The resolver accepts cached Git
marketplace installs, personal local marketplace roots, and Windows paths with
spaces. The npm command examples below are standalone/debugging fallbacks.

```sh
npx @hogancv/coordinate-agents@latest setup --json
npx @hogancv/coordinate-agents@latest task status --json
npx @hogancv/coordinate-agents@latest status --json
npx @hogancv/coordinate-agents@latest agent doctor --json
```

The JSON contract keeps runtime facts separate from Skill explanations. Common
codes include `EXECUTABLE_NOT_FOUND`, `EXECUTABLE_NOT_RUNNABLE`,
`SPAWN_FAILED`, `AGENT_EXIT_NONZERO`, `AGENT_TIMEOUT`, `AUTH_REQUIRED`,
`TASK_NOT_FOUND`, `TASK_STATE_CONFLICT`, and `STALE_CLAIM`. Authentication is
classified only when the coding CLI explicitly reports login/authentication
failure. A non-zero exit or timeout stops the current activation; it is not an
automatic retry signal. After fixing the reported executable or runtime issue,
use `task resume` only when the user explicitly asks to continue.

`task dispatch` is the only Plugin-facing action that sends `IMPLEMENT` and
launches the Implementer. It resolves the workflow Agent and final command,
checks the Adapter and executable, and fails closed before transport when the
command is unavailable. A missing command therefore produces Task `ERROR` with
`EXECUTABLE_NOT_FOUND`, no queued `IMPLEMENT`, and no child process. After the
user fixes the command, `task resume` is required before another dispatch.

> [!NOTE]
> This guide covers common issues with host Skill installations, the default Codex and Antigravity reference adapters, `.agent-bus` recovery, and dynamic agent registration via `agent doctor`.

Start with the same package version and target used for installation:

```sh
npx --yes @hogancv/coordinate-agents@<version> doctor --codex
npx --yes @hogancv/coordinate-agents@<version> doctor --antigravity
```

Preserve redacted output and the exit status. Do not paste credentials or force a destructive repair.

## Skill not discovered

**Observed behavior:** mentioning collaboration does not trigger `$coordinate-agents`, or the
CLI says the Skill is unavailable.

1. Run selected-target `doctor` and note the exact Skill path.
2. Confirm the terminal uses the same `CODEX_HOME` or Antigravity home that was installed.
3. Restart the CLI so it reloads Skill metadata.
4. Explicitly invoke `$coordinate-agents` once to separate discovery from installation failure.

If `doctor` reports a missing or invalid copy, reinstall only the selected target. Do not copy the
other CLI's credential directory.

## Codex App selects the wrong project or cannot start the Implementer

In Codex App, add or open the target Git repository and set the thread project/workspace path to the
repository root—the directory containing `.git`. Start a new thread and invoke `$coordinate-agents`.
The App path does not require manually opening two CLI windows, but the Runtime still opens a
project-scoped persistent Session for the Implementer locally. Configure the actual executable
command, not a role label:

```sh
# Antigravity
npx @hogancv/coordinate-agents config set agent.antigravity.command agy

# Claude Code as a registered custom agent
npx @hogancv/coordinate-agents agent add claude --adapter generic-cli --command claude \
  --args '["--print", "{prompt}"]'
```

Use `git rev-parse --show-toplevel` to compare the repository root with the App project path. Use
`doctor` to inspect the final resolved command and executable status. A project-path error and an
executable-command error are independent; fix both if necessary. Verify the selected CLI's own
`--help` output before copying its prompt or directory flags; the runtime already uses the project
root as the child process working directory. Alternatively, ask the active Codex App thread:

```text
Use $coordinate-agents to configure Claude Code as the Implementer for this project. Inspect the
installed `claude` executable and `claude --help`, register it with `generic-cli`, run `doctor`, and
show me the resolved configuration. Do not start until I confirm.
```

The built-in Antigravity Adapter does not automatically append a full-permission flag. The legacy
one-shot path passes configured `args` and then adds `--prompt-interactive <prompt>`; a persistent
Session starts with `--prompt-interactive ""` for current `agy`/`agy-proxy` parsers, then writes its
first instruction through the PTY unless `{prompt}` is explicitly configured. If `agy --help` confirms
`--dangerously-skip-permissions` and the user explicitly wants it, set
`agent.antigravity.args` with `config set`; `config list` shows the saved user arguments, while
`doctor` checks the executable/version only.

## Node version too low

```text
Node.js 18+: missing or requires attention
```

Run `node --version`. Install a supported Node.js LTS from an official source, open a new terminal,
and check that PATH resolves the new executable. The package refuses to claim support below Node 18.

## `codex` or `agy` is not found

```text
Codex CLI: missing or requires attention
Antigravity CLI (agy): missing or requires attention
```

Run `where codex` / `where agy` on Windows or `command -v codex` / `command -v agy` on POSIX.
Install the missing native CLI from its official source, authenticate it, and prove a native model
response before rerunning `doctor`. A selected-target check fails when that target CLI is absent;
the unselected CLI is informational only. If a machine-specific wrapper is used, configure the
actual command instead of expecting the Adapter to infer it:

```sh
npx @hogancv/coordinate-agents config set agent.antigravity.command agy-proxy
npx @hogancv/coordinate-agents doctor
```

The project-level command in `.agent-bus/config.json` takes precedence over this user setting.

## Implementer stops with `ERROR`

`launch` performs an executable check before starting the Implementer. A missing command, unsafe
Windows entrypoint, spawn failure, non-zero child exit, or conversation/runtime failure is fatal
for the current activation. Inspect the reported Agent, Adapter, configured command, error code,
and `.agent-bus/logs/*-ERROR.json` artifact. Do not keep polling or automatically resend
`IMPLEMENT`; fix the command/runtime and explicitly launch again when ready. Coordinate Agents
does not perform login-status or provider-health preflight checks.

## Unknown installation directory

```text
Codex: installation invalid (unrecognized installation), path: ...
Manual action required; inspect or back up the existing directory before using: ... install ...
```

The target may be a source checkout, a hand-installed Skill, or user data. The installer refuses to
overwrite it because a forged metadata file is not proof of ownership. Inspect and back up the
directory. Use `--force` only after the user explicitly accepts replacement or deletion of that
exact path.

## `doctor` fails after installation

```text
One or more dependencies or installations require attention.
```

The lines above the summary identify the failing component. Check the command's exit status, verify
the suggested repair matches the actual platform and package manager, apply one repair at a time,
and rerun the identical `doctor` command. Linux repair commands are suggestions to review, not a
guarantee that a distribution repository supplies Node 18+.

## Message remains in `processing`

First confirm the worker process is gone; recovering active work can duplicate implementation.

```sh
node <skill>/scripts/agent-bus.mjs status --root <repo>
node <skill>/scripts/agent-bus.mjs recover --agent antigravity \
  --stale-after-seconds 14400 --root <repo>
```

`recover` moves only stale claims back to `new` according to the requested threshold and current
lease state. Rerun `status`, then let exactly one worker call `wait`. Never manually copy a message
between queue folders while a worker is alive.

## `.agent-bus` is damaged or unsafe

Possible errors include malformed message quarantine, invalid state records, or refusal of an
unsafe path. Stop both agents. Preserve the directory for diagnosis, inspect `quarantine/` and
`status`, and verify `.agent-bus` is a normal directory inside the Git root—not a symlink, junction,
hard-linked leaf, or path escape. Use `recover` only for intact stale claims. Use `clean` only with
explicit confirmation after saving required specs, reviews, and evidence.

Do not repair YAML frontmatter or move queue files by hand unless you can prove no process holds a
claim; manual edits destroy evidence lineage.

## Windows path normalization

Symptoms include the two agents reporting different roots, a copy-pasted command breaking at spaces
or `&`, or prompts being created in an unexpected checkout. Always run `quickstart` from the actual
Git worktree root and copy the generated `launch` commands unchanged. They encode root paths with
`--root-base64` rather than embedding an unsafe shell string. Compare:

```powershell
git rev-parse --show-toplevel
npx --yes @hogancv/coordinate-agents@<version> doctor
```

Do not manually translate `C:\project` to `/mnt/c/project` unless both CLIs execute in WSL. Windows
and WSL paths that refer to the same files are still different process environments.

## npm registry metadata is inconsistent

```text
npm ERR! code ETARGET
npm ERR! notarget No matching version found for @hogancv/coordinate-agents@<version>
```

Compare the public metadata without changing credentials:

```sh
npm view @hogancv/coordinate-agents dist-tags.latest version repository.url --json
npm config get registry
```

The repository must be `https://github.com/hogancv/coordinate-agents` and the registry should be
the intended public npm registry. A stale mirror may lag the release. Do not downgrade silently,
switch to an untrusted registry, or run a GitHub checkout as an installer. Wait for consistent
metadata or use an already verified stable exact version.

See the canonical bilingual
[AI installation guide](https://github.com/hogancv/coordinate-agents/blob/main/AI_INSTALL.md)
and the [security boundary](./security.html).
