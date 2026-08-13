---
layout: page
title: Codex CLI vs Antigravity CLI roles
description: Compare the separate specification, implementation, review, and release responsibilities.
---

# Codex CLI vs Antigravity CLI roles

| Responsibility | Codex CLI | Antigravity CLI (`agy`) |
| --- | --- | --- |
| Clarify requirements | Owns | May ask implementation questions |
| Write specification | Owns | Consumes |
| Edit product code and tests | Never | Exclusively owns |
| Validate UI/browser behavior | Reviews evidence | Executes |
| Commit implementation | Reviews commit | Creates commit |
| Approve review | Owns | Never self-approves |
| Release | Only after user gate | Never |

This workflow is intentionally asymmetric. Do not use it for single-agent work or when both agents are expected to edit product code.

