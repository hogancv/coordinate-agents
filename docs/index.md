---
layout: home
title: coordinate-cli-agents
description: A recoverable multi-agent collaboration workflow for OpenAI Codex CLI and Google Antigravity CLI.
permalink: /
---

# Codex specifies and reviews. Antigravity implements.

`coordinate-cli-agents` coordinates **OpenAI Codex CLI** and **Google Antigravity CLI (`agy`)** in the same Git repository without sharing account credentials. Codex owns requirement clarification, specifications, commit review, and the release gate. Antigravity exclusively edits product code and tests.

The agents communicate through a recoverable project-local `.agent-bus`. No CAO server, daemon, database, or shared API key is required.

## Start here

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

Canonical sources: [GitHub](https://github.com/hogancv/coordinate-cli-agents) · [npm](https://www.npmjs.com/package/@hogancv/coordinate-cli-agents)
