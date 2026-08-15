---
layout: page
title: FAQ
description: Answers about multi-agent coordination, Codex and Antigravity reference roles, adapter architecture, recovery, and security.
---

# Frequently asked questions

## What is coordinate-agents?

A local-first coordination protocol, runtime, and CLI skill for multi-agent software engineering in Git repositories. It coordinates arbitrary CLI and desktop agents via adapters, with OpenAI Codex CLI and Google Antigravity CLI as first-party reference adapters and the default workflow.

## How do I prevent multiple AI agents from editing code simultaneously?

Assign clear, non-overlapping workflow roles. In the default reference workflow, Antigravity is the exclusive implementation writer while Codex specifies requirements and reviews commits. Do not execute concurrent Git writes on the same worktree.

## Does it share my accounts or API credentials?

No. Each agent and CLI maintains its native authentication and environment independently. Never place API tokens or credentials in `.agent-bus`.

## Can custom or third-party CLI agents be added?

Yes. Custom CLI agents can be registered dynamically using `coordinate-agents agent add <id> --adapter generic-cli --command <cmd> --args '<args>'`. Workflow roles (`planner`, `implementer`, `reviewer`) can be assigned to any registered agent.

## Can interrupted work be resumed?

Yes. Message queues (`new`, `processing`, `processed`) and append-only state logs survive terminal restarts. Use `coordinate-agents doctor` or `scripts/agent-bus.mjs recover` to recover stale claims.

## Is `.agent-bus` encrypted?

No. It is a local plaintext directory on the filesystem and is excluded from ordinary Git tracking via `.git/info/exclude`, not an encrypted store.

## How do I uninstall it?

Run `npx @hogancv/coordinate-agents@latest uninstall`. Unrecognized or user-modified skill installations are preserved unless `--force` is explicitly authorized.

For detailed answers and exact commands, read the [English README](https://github.com/hogancv/coordinate-agents#faq) or [Simplified Chinese README](https://github.com/hogancv/coordinate-agents/blob/main/README.zh-CN.md#常见问题).
