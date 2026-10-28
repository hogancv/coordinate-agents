---
layout: home
title: Local coding-agent workspace
description: Manage persistent Codex, Antigravity and custom CLI terminals in a local browser, with explicit collaboration and permission boundaries.
hero:
  name: Coordinate Agents
  text: Two terminals. One local workspace.
  tagline: Keep coding-agent sessions, changes and collaboration receipts together. Start with Web Workspace; choose the structured Plugin when you need its contracts.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started.html
    - theme: alt
      text: Workspace guide
      link: /inspector.html
    - theme: alt
      text: Migrate from v2.4
      link: /v2.4.html
features:
  - title: Default Collaboration
    details: Codex clarifies and reviews; Antigravity implements. A timeline preserves dispatches and formal reports, which still require independent verification.
    link: /inspector.html#default-collaboration
    linkText: Follow the workflow
  - title: Your choice of terminals
    details: Select two local CLIs and optional prompts. Each CLI owns its login and permissions; Custom mode does not add default roles or collaboration rounds.
    link: /inspector.html#custom-terminals
    linkText: Configure custom CLIs
  - title: Optional structured Plugin
    details: Agent Bus, durable Tasks, evidence review and Task Graphs remain available as a separately organized workflow, independent of the npm 3.x Web package.
    link: /structured-workflow.html
    linkText: Explore the Plugin
---

<div id="a-local-workspace-for-coding-agent-terminals" class="doc-anchor" aria-hidden="true"></div>
<div id="启动工作台" class="doc-anchor" aria-hidden="true"></div>
<div id="coordinate-agents本地编码-agent-工作台" class="doc-anchor" aria-hidden="true"></div>
<div id="快速开始" class="doc-anchor" aria-hidden="true"></div>
<div id="日常使用与边界" class="doc-anchor" aria-hidden="true"></div>
<div id="文档导航" class="doc-anchor" aria-hidden="true"></div>
<div id="可选的结构化工作流" class="doc-anchor" aria-hidden="true"></div>

## Start the Workspace

Prepare Node.js ≥18, Git and your signed-in agent CLIs. Default Collaboration uses `codex` and `agy`; no Plugin installation is required.

```sh
npx @hogancv/coordinate-agents@3.0.2 web --root "/path/to/project" --port 3000
```

Open the printed localhost URL, check settings, create a task, and enter your request in Codex. An ordinary startup directory initializes Git and local storage without a commit; choose your project deliberately.

::: warning Permissions and evidence
Agents run with their configured local CLI permissions. Role prompts provide no sandbox or technical release gate. Antigravity defaults to automatic tool approval; choose prompt mode in settings if needed. Web tasks share the project working directory without automatic worktree isolation. `DONE` and `APPROVED` are agent reports: inspect the real changes and tests.
:::

Closing the browser or Web server does not stop independent Session Hosts; use the explicit close controls. `.agent-bus/` is local plaintext. Providers still receive data according to each CLI's configuration.

<div id="继续阅读" class="doc-anchor" aria-hidden="true"></div>

## Continue reading

- [Getting started](./getting-started.html) → [Workspace guide](./inspector.html) → [Conversation recovery](./codex-conversation-resume.html)
- [Install with AI](./install-with-ai.html), [Troubleshooting](./troubleshooting.html), [FAQ](./faq.html), [Security & permissions](./security.html)
- [Structured Plugin](./structured-workflow.html), [Technical references and translation status](./reference.html)
- [Knowledge graph](./knowledge-graph.html): explore the repository's code, documentation and relationships with English / 中文 controls.
- [Changelog](./changelog.html), [Original v2.4 snapshot and migration](./v2.4.html), [Documentation migration and URL map](./documentation-migration.html)

Verified 2026-10-21: source and npm `latest` are **3.0.2**; the independently versioned Plugin is **2.4.0**. A source merge does not publish npm. Check dist-tags before installing.

[Official source](https://github.com/hogancv/coordinate-agents) · [npm package](https://www.npmjs.com/package/@hogancv/coordinate-agents) · [Machine-readable documentation index](./llms.txt)

<div id="everyday-use" class="doc-anchor" aria-hidden="true"></div>
<div id="可选结构化工作流" class="doc-anchor" aria-hidden="true"></div>

## Optional structured workflow

The retained local-first coordination protocol and runtime supports durable Tasks, Agent Bus, review evidence and explicit recovery. Codex and Antigravity are reference adapters; other registered agents can use the same contracts. Start with [structured onboarding](./structured-workflow.html), then [Plugin end-to-end evidence](./plugin-e2e.html) or the [reference directory](./reference.html).
