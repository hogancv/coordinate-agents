---
layout: home
title: coordinate-agents
description: A local-first coordination protocol and runtime for AI coding agents.
permalink: /
---

# Local-first coordination protocol and runtime for AI coding agents

`coordinate-agents` is a local-first coordination protocol and runtime for multi-agent software engineering in Git repositories. The core is agent-agnostic and uses an adapter-based runtime. **OpenAI Codex App/CLI** and **Google Antigravity CLI (`agy`)** serve as first-party reference adapters and the default reference workflow, while generic CLI agents can be registered directly and desktop, MCP, HTTP, or IPC surfaces can integrate via the adapter extension model.

The agents communicate through a recoverable project-local `.agent-bus`. No CAO server, daemon, database, or shared API key is required.

## Start here

For the simplest interactive path, install the Codex plugin, add the target Git repository to Codex
App, set the thread project path to the repository root containing `.git`, and invoke
`$coordinate-agents`. A second manually opened CLI window is not required; configure the actual
Implementer executable (`agy`, `claude`, or a wrapper) for the local runtime.

For a custom CLI, ask the active Codex App thread to inspect the installed executable and its
`--help` output, register it with `generic-cli`, run `doctor`, and show the resolved configuration
before starting a task. The built-in Antigravity Adapter passes configured arguments and appends
only `--prompt-interactive <prompt>`; it does not automatically add a full-permission or
sandbox-bypass flag.

- [Getting started](./getting-started.html)
- [Install safely with an AI](./install-with-ai.html)
- [Codex CLI role](./codex-cli.html)
- [Antigravity CLI role](./antigravity-cli.html)
- [Protocol and recovery](./protocol.html)
- [Security boundary](./security.html)
- [Troubleshooting](./troubleshooting.html)
- [Role comparison](./comparison.html)
- [FAQ](./faq.html)
- [Machine-readable documentation index](./llms.txt)
- [简体中文入口](./zh-CN/)

Canonical sources: [GitHub](https://github.com/hogancv/coordinate-agents) · [npm](https://www.npmjs.com/package/@hogancv/coordinate-agents)
