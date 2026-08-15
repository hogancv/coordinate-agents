---
layout: page
title: Getting started
description: A verified first-run lifecycle for Codex CLI specifications, Antigravity implementation, review, recovery, and release gating.
---

# Getting started

> [!NOTE]
> This walkthrough demonstrates the **default reference workflow** using OpenAI Codex CLI (planner and reviewer) and Google Antigravity CLI (implementer). The underlying `.agent-bus` runtime also supports custom agents via [dynamic agent registration](https://github.com/hogancv/coordinate-cli-agents#dynamic-agent-registration) and custom role assignments.

This walkthrough starts from an existing Git repository and ends with a reviewed commit. It takes
about **5 minutes** after Node.js, Git, Codex CLI, and Antigravity CLI (`agy`) are installed and
authenticated. Model response time is the main variable.

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
$ npx --yes @hogancv/coordinate-cli-agents@latest install
Installed Codex: .../skills/coordinate-cli-agents
Installed Antigravity: .../skills/coordinate-cli-agents
$ npx --yes @hogancv/coordinate-cli-agents@latest doctor
Node.js: available (v22.23.0)
Git: available (git version 2.53.0.windows.1)
Codex CLI: available (codex-cli 0.146.0)
Antigravity CLI (agy): available (1.1.12)
Codex: healthy (1.2.3) at .../codex/skills/coordinate-cli-agents
Antigravity: healthy (1.2.3) at .../agy/skills/coordinate-cli-agents
All prerequisites and selected installations are healthy.
```

Versions and home paths vary. The final healthy summary and exit status `0` are the success
signals. A non-zero exit, `missing`, `invalid`, or `requires attention` means installation is not
complete; follow the printed repair suggestion and rerun `doctor`.

Before installation, neither selected Skill home contains `coordinate-cli-agents`. Afterwards,
each selected home contains the same managed payload:

```text
coordinate-cli-agents/
├── .coordinate-cli-agents.json
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
$ npx --yes @hogancv/coordinate-cli-agents@latest quickstart \
    --template feature --task "Add completion support to the Todo app"
Collaboration workspace initialized: .../todo-app
Generated role prompts: .../todo-app/.agent-bus/launch

1. Codex terminal (copy and run):
npx --yes @hogancv/coordinate-cli-agents@1.2.3 launch --role codex ...

2. Antigravity terminal (copy and run):
npx --yes @hogancv/coordinate-cli-agents@1.2.3 launch --role antigravity ...
```

Run the two printed commands in separate terminals. Exact commands contain an encoded project path
so spaces and Windows metacharacters do not require manual quoting.

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
