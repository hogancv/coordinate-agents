---
layout: page
title: Antigravity CLI role
description: Google Antigravity CLI exclusively implements code and tests from Codex specifications.
---

# Antigravity CLI role

Google Antigravity CLI (`agy`) is the implementation role. It:

- claims an `IMPLEMENT` or `CHANGES_REQUESTED` message;
- edits source code, tests, UI, and build configuration;
- performs browser or UI validation when required;
- runs the agreed checks and records evidence;
- creates a focused Git commit and reports `IMPLEMENTATION_DONE`.

Antigravity does not approve its own work and does not merge, tag, push, deploy, or publish. It retains its native Google account authentication and model subscription.

