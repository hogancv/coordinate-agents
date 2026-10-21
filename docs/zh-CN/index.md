---
layout: home
title: 本地编码 Agent 工作台
description: 在本地浏览器中管理 Codex、Antigravity 与自定义 CLI，保留双终端会话和明确的协作边界。
hero:
  name: Coordinate Agents
  text: 双终端，一个本地工作台
  tagline: 管理编码 Agent 会话、查看变更与协作回执。以 Web Workspace 为主入口，按需选择结构化 Plugin。
  actions:
    - theme: brand
      text: 快速开始
      link: /zh-CN/getting-started.html
    - theme: alt
      text: 使用指南
      link: /zh-CN/inspector.html
    - theme: alt
      text: 从 v2.4 迁移
      link: /zh-CN/v2.4.html
features:
  - title: 默认协作
    details: Codex 澄清与审查，Antigravity 实现。时间线保留派发与正式回执；回执不等于独立验证。
    link: /zh-CN/inspector.html#default-collaboration
    linkText: 了解协作流程
  - title: 自定义双终端
    details: 选择两个本机 CLI 和可选 Prompt。命令、登录与权限由各 CLI 管理，不会自动获得默认协作的角色与轮次。
    link: /zh-CN/inspector.html#custom-terminals
    linkText: 配置自己的 CLI
  - title: 可选结构化 Plugin
    details: 独立组织的 Agent Bus、持久 Task、证据审查与 Task Graph 工作流，继续可用，独立于 npm 3.x Web 包。
    link: /zh-CN/structured-workflow.html
    linkText: 查看 Plugin 路线
---

<div id="coordinate-agents本地编码-agent-工作台" class="doc-anchor" aria-hidden="true"></div>
<div id="start-the-workspace" class="doc-anchor" aria-hidden="true"></div>
<div id="a-local-workspace-for-coding-agent-terminals" class="doc-anchor" aria-hidden="true"></div>
<div id="everyday-use" class="doc-anchor" aria-hidden="true"></div>

## 启动工作台

准备 Node.js ≥18、Git 和已登录的 Agent CLI。默认协作使用 `codex` 和 `agy`，无需安装 Plugin。

```sh
npx @hogancv/coordinate-agents@3.0.2 web --root "/path/to/project" --port 3000
```

打开打印的 localhost 地址，检查设置、新建任务，再在 Codex 中输入需求。普通启动目录会初始化 Git 和本地存储，不创建提交；请明确选择项目目录。

::: warning 权限与结果边界
工作台使用本机 CLI 的权限，角色 Prompt 不提供沙箱或技术发布闸门。Antigravity 默认自动批准工具请求，可在设置中选择提示模式。Web 任务共享项目工作目录，不自动创建独立 worktree。`DONE`、`APPROVED` 是 Agent 报告，需要结合真实变更和测试审查。
:::

关闭浏览器或 Web 服务不会自动停止独立 Session Host；请使用显式关闭控件。`.agent-bus/` 为本地明文，Agent 提供商仍按各 CLI 的配置接收数据。

<div id="快速开始" class="doc-anchor" aria-hidden="true"></div>
<div id="continue-reading" class="doc-anchor" aria-hidden="true"></div>

## 继续阅读

- [快速开始](./getting-started.html) → [完整使用指南](./inspector.html) → [对话恢复](./codex-conversation-resume.html)
- [让 AI 安装](./install-with-ai.html)、[故障排查](./troubleshooting.html)、[常见问题](./faq.html)、[安全与权限](./security.html)
- [结构化 Plugin](./structured-workflow.html)、[技术参考与翻译状态](./reference.html)
- [版本记录](./changelog.html)、[v2.4 原始快照与迁移](./v2.4.html)、[文档迁移与路径映射](./documentation-migration.html)

核对日期：2026-10-21。源码与 npm `latest` 均为 **3.0.2**；Plugin 独立版本为 **2.4.0**。合并源码不会发布 npm，安装前仍应检查 dist-tags。

[官方源码](https://github.com/hogancv/coordinate-agents) · [npm 发布包](https://www.npmjs.com/package/@hogancv/coordinate-agents) · [机器可读索引（英文）](/llms.txt)

<div id="日常使用与边界" class="doc-anchor" aria-hidden="true"></div>
<div id="文档导航" class="doc-anchor" aria-hidden="true"></div>
<div id="可选的结构化工作流" class="doc-anchor" aria-hidden="true"></div>
<div id="optional-structured-workflow" class="doc-anchor" aria-hidden="true"></div>

## 可选结构化工作流

保留的本地优先协调协议与运行时支持持久 Task、Agent Bus、审查证据与显式恢复。Codex 与 Antigravity 是参考适配器，也支持其他已注册 Agent。请从[结构化上手](./structured-workflow.html)进入，再查阅[技术参考目录](./reference.html)。
