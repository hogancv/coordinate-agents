---
layout: page
title: Antigravity CLI role (Default reference workflow)
description: Google Antigravity CLI serves as the reference implementer in coordinate-cli-agents.
---

# Antigravity CLI role (Reference implementer)

> [!NOTE]
> This page describes Google Antigravity CLI's responsibilities in the **default reference workflow**. The underlying `.agent-bus` runtime is agent-agnostic and allows assigning the `implementer` role to other registered agents.

In the default reference workflow, Google Antigravity CLI (`agy`) fulfills the implementation role:

- claims an `IMPLEMENT` or `CHANGES_REQUESTED` message from `.agent-bus/inbox/antigravity/new`;
- edits source code, tests, UI, and build configuration;
- performs browser, unit, or UI validation when required;
- runs the agreed checks and records evidence under `.agent-bus/evidence/`;
- creates a focused Git commit and reports `IMPLEMENTATION_DONE`.

Antigravity does not approve its own work and does not merge, tag, push, deploy, or publish. It retains its native Google account authentication and model subscription.
