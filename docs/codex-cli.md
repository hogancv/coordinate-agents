---
layout: page
title: Codex CLI role (Default reference workflow)
description: OpenAI Codex CLI serves as the reference planner and reviewer in coordinate-cli-agents.
---

# Codex CLI role (Reference planner & reviewer)

> [!NOTE]
> This page describes Codex CLI's responsibilities in the **default reference workflow**. The underlying `.agent-bus` runtime is agent-agnostic and allows assigning the `planner` and `reviewer` roles to other registered agents.

In the default reference workflow, Codex fulfills the planning and review roles:

- clarifies requirements, non-goals, edge cases, and acceptance criteria;
- writes an implementation specification under `.agent-bus/specs/`;
- reviews real Git commits and their validation evidence;
- sends `CHANGES_REQUESTED` or `REVIEW_APPROVED`;
- plans releases and waits for literal user authorization (`RELEASE_APPROVED`).

Codex must not edit product source, tests, build configuration, or implementation files. Review approval alone is not permission to merge, push, tag, deploy, or publish.
