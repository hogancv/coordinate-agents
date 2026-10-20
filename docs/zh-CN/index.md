---
layout: page
title: 简体中文
description: Coordinate Agents 本地 Web 双终端工作台的快速开始、功能边界、源码与 npm 版本说明，以及可选结构化工作流入口。
permalink: /zh-CN/
---

# Coordinate Agents：本地编码 Agent 工作台

> **从 v2.4 升级？** 请先看 [旧版文档与 v3 迁移](../v2.4.html)，
> 可查阅发布时的原始文档、方向变化，以及继续使用旧流程的入口。

在浏览器中管理本机的编码 Agent 双终端。**默认协作**使用 Codex + Antigravity：
Codex 理解需求、派发和审查，Antigravity 实现；**自定义双终端**允许指定自己的
CLI 组合和 Prompt。项目、任务和会话记录保存在本机，各 CLI 分别管理登录。

## 快速开始

安装 Node.js >=18、Git 和需要使用的 Agent CLI。
默认模式需确认 `codex`、`agy` 能运行并已登录，无需安装 Codex Plugin。

```sh
npx @hogancv/coordinate-agents@latest web --root "/path/to/project" --port 3000
```

打开打印的 localhost 地址，在设置中检查命令，新建默认协作任务，直接在 Codex 输入需求。
启动目录会自动登记；普通目录启动时初始化 Git 和 Workspace 存储，不创建提交。

**源码与 npm 分开看。** 截至 2026-10-20，npm `latest` 为 3.0.1。
当前源码新增了 Git Changes 与审查反馈、自定义双终端、桌面通知、协作时间线和协作健康。
体验新增功能请在源码目录运行：

```sh
npm ci
node bin/coordinate-agents.mjs web --root "/path/to/project" --port 3000
```

没有源码时先检出 [官方仓库](https://github.com/hogancv/coordinate-agents)。
合并到 `main` 不会自动发布 npm。

## 日常使用与边界

- 多项目切换保留后台终端，支持搜索、归档和清理已归档对话。
- 可调整分屏、聚焦单终端、使用禅模式，在中英文界面间切换。
- 默认协作的时间线记录轮次和正式回执，健康提示展示缺少进展或 Session 异常。
- Git Changes 展示当前工作区 Diff；默认模式可在确认 Codex 输入就绪后发送审查意见。
- 桌面通知默认关闭，可在 Windows 10/11 或 macOS 上启用；Linux 暂不支持。

`SENT` 仅表示已派发，`DONE` 表示实现者报告可以审查，`APPROVED` 是 Codex 的审查报告。
任务列表中的状态表示终端生命周期，不代表实现或审查完成。
静默不等于卡死；时间线和健康提示不会自动重发、重启或审查。
新任务不创建独立 worktree，请避免不同任务在同一工作目录中发生冲突修改。

关闭浏览器或停止 Web 服务不等于关闭 Agent。需要结束执行时使用显式关闭控件。
角色 Prompt 不提供沙箱或技术上的发布闸门；Agent 权限由本机 CLI 配置决定。
`.agent-bus/` 是本地明文，不应存入凭据；Agent 提供商仍按各 CLI 配置接收数据。

## 文档导航

以下细节指南以英文为主；完整中文产品说明见 [中文 README](https://github.com/hogancv/coordinate-agents/blob/main/README.zh-CN.md)。

- [首次使用](../getting-started.html)：安装、源码启动、设置和首个任务。
- [Workspace 使用指南](../inspector.html)：双终端、Diff 审查、时间线、健康提示、通知和存储。
- [让 AI 安装](../install-with-ai.html)、[故障排查](../troubleshooting.html)、[常见问题](../faq.html)。
- [版本记录](../changelog.html)、[方案比较](../comparison.html)、[安全边界](../security.html)。
- [文档首页](../index.html)、[机器可读索引](../llms.txt)。

## 可选的结构化工作流

项目保留本地优先协调协议与运行时，以 Agent Bus、持久 Task、Task Graph、证据审查和显式恢复
支持更结构化的流程。它通过 GitHub Plugin、源码 Legacy CLI 或 npm 2.4.0 使用，
不属于 npm 3.x Web 包。Codex 和 Antigravity 是默认参考适配器，也支持 `generic-cli` 扩展。

- [结构化工作流](../structured-workflow.html)：Plugin 安装、发现、配置、派发与审查。
- [旧版 Skill 安装](../legacy-ai-install.html)：安装、更新、卸载和备份恢复。
- [Plugin E2E](../plugin-e2e.html)、[MCP](../mcp.html)、[协议](../protocol.html)、[Task Graph](../task-graph-v1.html)。
- [Session Runtime](../session-runtime.html)、[事件日志](../event-journal.html)、[Adapter 开发](../adapter-author-guide.html)。
