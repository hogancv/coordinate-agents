---
layout: page
title: Troubleshooting
description: Match real coordinate-cli-agents, Node, Codex, agy, agent-bus, Windows path, and npm metadata errors to safe recovery steps.
---

# Troubleshooting

Start with the same package version and target used for installation:

```sh
npx --yes @hogancv/coordinate-cli-agents@<version> doctor --codex
npx --yes @hogancv/coordinate-cli-agents@<version> doctor --antigravity
```

Preserve redacted output and the exit status. Do not paste credentials or force a destructive repair.

## Skill not discovered

**Observed behavior:** mentioning collaboration does not trigger `$coordinate-cli-agents`, or the
CLI says the Skill is unavailable.

1. Run selected-target `doctor` and note the exact Skill path.
2. Confirm the terminal uses the same `CODEX_HOME` or Antigravity home that was installed.
3. Restart the CLI so it reloads Skill metadata.
4. Explicitly invoke `$coordinate-cli-agents` once to separate discovery from installation failure.

If `doctor` reports a missing or invalid copy, reinstall only the selected target. Do not copy the
other CLI's credential directory.

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
the unselected CLI is informational only.

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
node <skill>/scripts/agent-bus.mjs recover --role antigravity \
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
npx --yes @hogancv/coordinate-cli-agents@<version> doctor
```

Do not manually translate `C:\project` to `/mnt/c/project` unless both CLIs execute in WSL. Windows
and WSL paths that refer to the same files are still different process environments.

## npm registry metadata is inconsistent

```text
npm ERR! code ETARGET
npm ERR! notarget No matching version found for @hogancv/coordinate-cli-agents@<version>
```

Compare the public metadata without changing credentials:

```sh
npm view @hogancv/coordinate-cli-agents dist-tags.latest version repository.url --json
npm config get registry
```

The repository must be `https://github.com/hogancv/coordinate-cli-agents` and the registry should be
the intended public npm registry. A stale mirror may lag the release. Do not downgrade silently,
switch to an untrusted registry, or run a GitHub checkout as an installer. Wait for consistent
metadata or use an already verified stable exact version.

See the canonical bilingual
[AI installation guide](https://github.com/hogancv/coordinate-cli-agents/blob/main/AI_INSTALL.md)
and the [security boundary](./security.html).
