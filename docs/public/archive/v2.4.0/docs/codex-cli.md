---
layout: page
title: Codex App/CLI role (Default reference workflow)
description: OpenAI Codex App or CLI serves as the reference planner and reviewer in coordinate-agents.
---

# Codex App/CLI role (Reference planner & reviewer)

> [!NOTE]
> This page describes Codex App/CLI's responsibilities in the **default reference workflow**. The underlying `.agent-bus` runtime is agent-agnostic and allows assigning the `planner` and `reviewer` roles to other registered agents.

When using Codex App, add the target Git repository as a project and set the thread project path to
the repository root containing `.git`. Invoke `$coordinate-agents` from a new thread; no second CLI
window needs to be opened manually. The configured Implementer still runs locally, so its command
must be an installed executable such as `agy` or `claude`.

In the default reference workflow, Codex fulfills the planning and review roles:

- clarifies requirements, non-goals, edge cases, and acceptance criteria;
- writes an implementation specification under `.agent-bus/specs/`;
- reviews real Git commits and their validation evidence;
- sends `CHANGES_REQUESTED` or `REVIEW_APPROVED`;
- plans releases and waits for literal user authorization (`RELEASE_APPROVED`).

Codex must not edit product source, tests, build configuration, or implementation files. Review approval alone is not permission to merge, push, tag, deploy, or publish.
