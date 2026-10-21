---
title: 工作流对比
description: 对比单个编程智能体、手动管理的双终端、本地 Web 工作台，以及可选的结构化 Plugin 和 Task Graph 协调方式。
---

<div id="compare-workflows" class="doc-anchor" aria-hidden="true"></div>

# 工作流对比

Coordinate Agents 在编程 CLI 外提供工作台和协调工具，并不会改变底层模型的智能水平。请按任务需要选择合适的协调程度。

| 方式 | 配置与角色 | 记录的状态 | 隔离与限制 |
| --- | --- | --- | --- |
| 单个智能体 | 直接使用智能体，由它规划、实施和审查。 | 取决于该智能体提供的能力。 | 协调开销最低；独立审查可选。 |
| 手动双终端 | 启动两个 CLI，自行传递指令。 | CLI 自身历史和你的笔记。 | 角色与路由手动管理；两个进程可能共用一个 worktree。 |
| Coordinate Agents Web：默认协作 | 启动 Web，配置 `codex`／`agy`，创建任务。Codex 负责委派／审查；Antigravity 负责实施。 | 本地项目、终端绑定、协作回执和时间线。 | 通过提示词引导角色；不提供隔离 worktree，也不独立验证完成情况。 |
| Coordinate Agents Web：自定义终端 | 选择两个可执行程序和可选提示词。 | 本地任务／终端槽位绑定及提示词快照。 | 由你控制协调；无默认角色、协作轮次或 Codex 反馈交接。 |
| Coordinate Agents 结构化 Plugin／Legacy CLI／MCP | 配置已注册的 Implementer，使用持久化 Task API。 | Agent Bus 消息、证据、审查决定、恢复记录及可选 Task Graph。 | 独立的协议约定，以及明确的执行／审查／发布边界。 |

Web 3.0.2 打包了 3.0.1 之后新增的 Git Changes／审查、自定义终端、通知、时间线、健康提示和恢复功能。参阅[快速开始](./getting-started.html)。

<div id="when-web-workspace-helps" class="doc-anchor" aria-hidden="true"></div>

## 适合使用 Web 工作台的场景

如果你希望在同一个本地浏览器中使用两个编程 CLI，并保留持久会话、项目／任务历史，以及明确的实施与审查交接，可以使用 Web 工作台。默认协作通过轻量角色提示词和报告提供这种交接。自定义模式适合希望自行控制行为的 CLI 组合。

Git Changes、审查备注、时间线、健康提示和可选通知，使当前源码中的工作过程更容易观察。它们不会验证正确性、保证智能体遵循提示词，也不会自动恢复失败的工作。

<div id="when-the-structured-workflow-helps" class="doc-anchor" aria-hidden="true"></div>

## 适合使用结构化工作流的场景

保留的 **Protocol & Runtime（协议与运行时）**增加了持久化 Task 派发、Agent Bus 认领、实施证据、审查决定和显式恢复。Configured Implementer（已配置实施者）和 Configured Reviewer（已配置审查者）身份是记录的一部分，采用本地持久化 `.agent-bus` 存储，发布边界要求用户明确授权（Exact user authorization）。默认参考工作流由 Antigravity 实施、Codex 规划／审查；适配器允许接入其他智能体。

如果这些记录和约定对你很重要，请使用[结构化工作流](./structured-workflow.html)。Task Graph 增加了明确的依赖规划和隔离的子任务 worktree。这些 API 无法通过 npm 3.x Web 任务使用。

<div id="do-not-use-this-project-when" class="doc-anchor" aria-hidden="true"></div>

## 以下情况不适合使用本项目

- 单个智能体已能轻松完成任务，额外的工作台没有价值。
- 你需要加密或远程复制的协调存储、多用户访问，或跨机器会话。
- 你希望 Web 任务自动隔离并发编辑。
- 你需要安全沙箱，或由密码学机制强制执行的角色／发布策略。

每个 Web 任务都使用项目的 worktree。存在编辑冲突的写入者应使用不同 worktree。智能体 CLI 自己的权限设置仍然有效，本地状态以明文保存，审查报告不会授权发布。参阅[安全说明](./security.html)。
