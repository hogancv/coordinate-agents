---
layout: page
title: Getting started
description: Install and start Codex CLI and Antigravity CLI collaboration in one Git repository.
---

# Getting started

Prerequisites: Node.js 18+, Git, and authenticated `codex` and `agy` commands.

From the Git repository where the agents should collaborate:

```sh
npx @hogancv/coordinate-cli-agents@latest install
npx @hogancv/coordinate-cli-agents@latest doctor
npx @hogancv/coordinate-cli-agents@latest quickstart --template feature --task "Build a Todo web app"
```

Run the two printed commands in separate terminals. Continue giving requirements to Codex; Antigravity receives implementation work through `.agent-bus`.

Choose `feature`, `bug`, or `refactor` as the task template. Do not let both agents edit product code or perform Git writes concurrently.

Next: [understand the roles](./comparison.html) or [inspect the protocol](./protocol.html).

