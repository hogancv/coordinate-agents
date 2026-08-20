---
layout: page
title: Getting started
description: A verified first-run lifecycle for Codex App or Codex CLI specifications, Antigravity implementation, review, recovery, and release gating.
---

# Getting started

## Codex Plugin-first path

The Codex Plugin is the preferred first-use experience. Its Multi-Skill surface
routes onboarding without exposing Agent Bus folders:

| Intent | Skill | First action |
| --- | --- | --- |
| Discover | `coordinate-setup` | `coordinate-agents setup --json` |
| Configure | `coordinate-setup` | choose an available local executable and use `config set` |
| Try | `coordinate-task` | `task create`, then the real Planner → Implementer → Reviewer workflow |
| Review | `coordinate-review` | verify the Task's commit, diff, tests, and evidence |
| Recover | `coordinate-recover` | inspect `task status`, then resume only after confirmation |

The Plugin's Task API is the product abstraction over the existing durable
Agent Bus. The npm CLI remains a Runtime/fallback and advanced-debugging path;
it is not required for normal Plugin onboarding. The three homepage prompts
are discover, configure, and try, with the Todo web app using the same Task
workflow as any other request.

```sh
npx @hogancv/coordinate-agents@latest setup --json
npx @hogancv/coordinate-agents@latest task create --title "Build a Todo web app" --json
npx @hogancv/coordinate-agents@latest task status --json
```

JSON stdout is one parseable document with `{ok, command, ...}` on success or
`{ok:false, command, error:{code,message,recoverable,...}}` on failure. A failed
Implementer is terminal for that activation; the Plugin reports the structured
error and never loops through automatic retries.

> [!NOTE]
> This walkthrough demonstrates the **default reference workflow** using OpenAI Codex App/CLI (planner and reviewer) and Google Antigravity CLI (implementer). The underlying `.agent-bus` runtime also supports custom agents via [dynamic agent registration](https://github.com/hogancv/coordinate-agents#dynamic-agent-registration) and custom role assignments.

This walkthrough starts from an existing Git repository and ends with a reviewed commit. It takes
about **5 minutes** after Node.js, Git, Codex App or Codex CLI, and an Implementer CLI such as
Antigravity (`agy`) are installed. Native authentication remains owned by each CLI; Coordinate
Agents does not preflight login state. Model response time is the main variable.

## Codex App path (recommended)

Codex App can invoke the Skill directly, so users do not need to manually open two CLI windows.

1. Install and enable the `coordinate-agents` Codex plugin from the GitHub marketplace.
2. Add or open the target Git repository as a Codex App project.
3. Set the thread's project/workspace path to the repository root—the directory containing `.git`.
4. Start a new thread, invoke `$coordinate-agents`, and ask Codex to initialize or coordinate the
   task.

The Codex App thread is the Planner/Reviewer side. The runtime starts the Implementer as a local
child process, so the execution command must be an installed executable on the same machine. For
example:

```console
$ npx --yes @hogancv/coordinate-agents@latest config set agent.antigravity.command agy
$ npx --yes @hogancv/coordinate-agents@latest agent add claude \
    --adapter generic-cli --command claude \
    --args '["--print", "{prompt}"]'
```

Use the actual command that starts the Implementer (`agy`, `claude`, or a vendor wrapper), and verify
its arguments with that CLI's own `--help` output. The runtime uses the selected project root as the
child process working directory, so a `--dir` argument is not universally available or necessary.
For a convenient setup, ask Codex App: “Use `$coordinate-agents` to configure Claude Code as this
project's Implementer; inspect `claude --help`, register it with `generic-cli`, run `doctor`, show me
the resolved configuration, and do not start until I confirm.” Use the CLI path below only for
automation or hosts without direct Codex App Skill execution.

The built-in Antigravity adapter does not automatically add a full-permission flag. It passes any
configured `args` and then appends `--prompt-interactive <prompt>`. If `agy --help` confirms
`--dangerously-skip-permissions` and the user explicitly wants it, configure that argument rather
than assuming the Plugin added it:

```console
$ npx --yes @hogancv/coordinate-agents@latest config set agent.antigravity.args '["--dangerously-skip-permissions"]'
$ npx --yes @hogancv/coordinate-agents@latest config list
```

## 1. Check prerequisites and install both Skills

```console
$ node --version
v22.23.0
$ git --version
git version 2.53.0.windows.1
$ codex --version
codex-cli 0.146.0
$ agy --version
1.1.12
$ npx --yes @hogancv/coordinate-agents@latest config set agent.antigravity.command agy-proxy
Updated user configuration: ~/.coordinate-agents/config.json
$ npx --yes @hogancv/coordinate-agents@latest install
Installed Codex: .../skills/coordinate-agents
Installed Antigravity: .../skills/coordinate-agents
$ npx --yes @hogancv/coordinate-agents@latest doctor
Node.js: available (v22.23.0)
Git: available (git version 2.53.0.windows.1)
Codex CLI: available (codex-cli 0.146.0)
Antigravity CLI (agy): available (1.1.12)
Codex: healthy (1.2.3) at .../codex/skills/coordinate-agents
Antigravity: healthy (1.2.3) at .../agy/skills/coordinate-agents
All prerequisites and selected installations are healthy.
```

The final Implementer command is resolved as project explicit command, then the user-level
`~/.coordinate-agents/config.json` command, then the Adapter default. `doctor` reports that command
and executable status. `launch` fails fast with Agent state `ERROR` on an unavailable executable,
spawn failure, non-zero exit, or conversation/runtime error; it does not silently fall back or retry.

Versions and home paths vary. The final healthy summary and exit status `0` are the success
signals. A non-zero exit, `missing`, `invalid`, or `requires attention` means installation is not
complete; follow the printed repair suggestion and rerun `doctor`.

Before installation, neither selected Skill home contains `coordinate-agents`. Afterwards,
each selected home contains the same managed payload:

```text
coordinate-agents/
├── .coordinate-agents.json
├── SKILL.md
├── agents/
├── references/
└── scripts/
```

The installer does not copy account tokens. Codex and Antigravity keep their native credentials in
their own homes.

## 2. Initialize the first task

Run this from the project Git root:

```console
$ npx --yes @hogancv/coordinate-agents@latest quickstart \
    --template feature --task "Add completion support to the Todo app"
Collaboration workspace initialized: .../todo-app
Generated role prompts: .../todo-app/.agent-bus/launch

1. Codex terminal (copy and run):
npx --yes @hogancv/coordinate-agents@2.1.2 launch --agent codex ...

2. Antigravity terminal (copy and run):
npx --yes @hogancv/coordinate-agents@2.1.2 launch --agent antigravity ...
```

Run the two printed commands in separate terminals. Exact commands contain an encoded project path
so spaces and Windows metacharacters do not require manual quoting.

Keep the Antigravity launch terminal open. Its Adapter-declared supervisor waits after each clean
`agy` exit and reactivates it for later review feedback without claiming the Bus message itself.
Use Ctrl+C or a processed `STOP` message to end it; `--once` opts into one activation for scripts.

`quickstart` adds a project-local `.agent-bus/` directory and excludes it through
`.git/info/exclude`; it does not add bus messages to commits. The project source tree is unchanged
until Antigravity implements an approved specification.

## 3. Complete one lifecycle

1. Tell Codex the observable behavior, constraints, and acceptance criteria.
2. Codex writes a specification and sends `IMPLEMENT`.
3. Antigravity claims it, edits product code, runs tests, commits, and sends
   `IMPLEMENTATION_DONE` with the commit ID and evidence.
4. Codex inspects the real commit and reruns relevant checks. It sends `REVIEW_APPROVED` or
   `CHANGES_REQUESTED`.
5. Antigravity fixes requested changes and repeats the evidence handoff.
6. A release remains blocked until the user approves the exact release plan with
   `RELEASE_APPROVED`.

The repository's deterministic demo proves this full lifecycle without using either live model:

```console
$ npm run demo
[CODEX] Clarify requirement and submit implementation specification
[ANTIGRAVITY] Claim message, implement, test, and commit
validation: node --test PASS
[CODEX] Claim result and review real commit plus validation evidence
review: APPROVED
[RESULT] IMPLEMENTED -> TESTED -> COMMITTED -> REVIEW_APPROVED
tests: PASS
bus: PASS
```

## Success and failure signals

Success means all of the following are observable: Antigravity alone changed product files; the
implementation commit exists; tests pass; Codex reviewed that exact commit; both inboxes have no
unexpected `processing` claims; and release permission has not been inferred from review approval.

Stop and diagnose if both terminals show the same role, both agents attempt Git writes, a message
stays in `processing` after its worker exited, evidence names a nonexistent commit, tests fail, or
the project root differs between terminals. See [troubleshooting](./troubleshooting.html),
[role comparison](./comparison.html), and the [protocol](./protocol.html).
