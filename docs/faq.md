---
layout: page
title: FAQ
description: Answers about Codex and Antigravity collaboration, installation, recovery, security, and uninstalling.
---

# Frequently asked questions

## What is coordinate-cli-agents?

A Codex Skill and npm package that gives Codex CLI and Google Antigravity CLI distinct, recoverable roles in one Git repository.

## How do I prevent two AI agents from editing code simultaneously?

Make Antigravity the exclusive implementation writer. Codex specifies and reviews but never edits product code. Do not run concurrent Git writes.

## Does it share my accounts or API credentials?

No. Each CLI keeps its native authentication and subscription. Never place credentials in `.agent-bus`.

## Can interrupted work be resumed?

Yes. Queue messages and append-only state survive terminal restarts. Inspect status before recovering a stale claim.

## Is `.agent-bus` encrypted?

No. It is local plaintext and is excluded from ordinary Git tracking, not encrypted.

## How do I uninstall it?

Run `npx @hogancv/coordinate-cli-agents@latest uninstall`. Unknown or modified installations are preserved unless force is explicit.

For detailed answers and exact commands, read the [English README](https://github.com/hogancv/coordinate-cli-agents#faq) or [Simplified Chinese README](https://github.com/hogancv/coordinate-cli-agents/blob/main/README.zh-CN.md#常见问题).

