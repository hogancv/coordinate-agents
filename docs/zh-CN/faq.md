---
title: 常见问题
description: 关于 Web 工作台配置、编程智能体组合、源码与 npm 版本、本地数据、持久化及可选结构化工作流的解答。
---

<div id="frequently-asked-questions" class="doc-anchor" aria-hidden="true"></div>

# 常见问题

<div id="what-is-coordinate-agents-now" class="doc-anchor" aria-hidden="true"></div>

## Coordinate Agents 现在是什么？

一个提供两个持久化编程智能体终端的本地 Web 工作台。默认协作由 Codex 负责澄清需求、委派和审查，Antigravity 负责实施。自定义终端允许你选择自己的 CLI 组合和提示词。仓库还保留了独立的结构化 Plugin 和 Legacy 运行时，用于持久化 Task、Agent Bus、MCP 和 Task Graph。

<div id="why-are-features-in-the-docs-missing-from-my-npm-installation" class="doc-anchor" aria-hidden="true"></div>

## 为什么文档中的功能在我安装的 npm 包里找不到？

截至 2026-10-21 核验时，npm `latest` 为 3.0.2。Git Changes／审查反馈、自定义终端、通知、时间线、健康提示和恢复功能已包含在 3.0.2 中。如果你仍在使用 3.0.1，请升级或运行当前源码。合并到 main 本身不会发布 npm 包；参阅[快速开始](./getting-started.html)。

::: tip 版本信息有时效性
版本号反映上述核验日期，不代表实时 npm 状态。安装前可通过 `npm view @hogancv/coordinate-agents dist-tags` 核验 `latest`。
:::

<div id="do-i-need-a-codex-plugin-or-a-global-npm-installation" class="doc-anchor" aria-hidden="true"></div>

## 需要 Codex Plugin 或全局安装 npm 包吗？

不需要。使用 `npx @hogancv/coordinate-agents@latest web` 启动 Web，或在执行 `npm ci` 后运行源码入口。只有需要单独的[结构化工作流](./structured-workflow.html)时，才安装 Plugin。npm 3.x 不提供 `install`、`doctor`、`quickstart`、`config`、`task` 或 `inspector`。

<div id="which-clis-can-i-use" class="doc-anchor" aria-hidden="true"></div>

## 可以使用哪些 CLI？

默认协作使用 `codex` 和 `agy`，可以在设置中覆盖可执行程序。自定义模式通过 `generic-cli` 启动两个已安装的交互式 CLI，也允许两次使用同一命令。可执行程序字段接受命令名或绝对路径，不接受内联参数或 shell 语法。对于未知 CLI，用户必须检查其就绪状态和多行粘贴兼容性。自定义模式不添加默认角色、协作轮次或 Codex 审查交接。

<div id="does-local-first-mean-the-agents-work-offline" class="doc-anchor" aria-hidden="true"></div>

## 本地优先是否意味着智能体离线工作？

工作台存储和协调在本地进行。每个 CLI 仍使用自己的服务商、登录、网络和权限设置。Coordinate Agents 不共享凭据，也不保证离线模型推理。切勿将 token、Cookie、密码或私钥写入 `.agent-bus/`。

<div id="does-creating-a-task-isolate-its-file-changes" class="doc-anchor" aria-hidden="true"></div>

## 创建任务会隔离它的文件变更吗？

不会。Web 任务的终端对共享所选项目的工作目录。独立写入者需要隔离时，请使用不同的 Git worktree；不要在同一 worktree 内进行互相冲突的编辑。结构化 Task Graph 工作流有独立且明确的 worktree 约定，与 Web 任务分开。

<div id="what-does-approved-mean-does-it-authorize-a-release" class="doc-anchor" aria-hidden="true"></div>

## APPROVED 是什么意思？它会授权发布吗？

它表示 Codex 报告该协作轮次已获审查批准。工作台不独立验证这些报告。`DONE` 表示实施者报告已准备好接受审查；`SENT` 只确认已派发。任务的运行／关闭状态属于终端生命周期。Web 提示词要求提交、推送和发布前取得用户授权，但不以技术机制强制执行发布门禁。结构化系统中的 `REVIEW_APPROVED` 和 `RELEASE_APPROVED` 有各自独立的协议语义。

<div id="is-a-quiet-terminal-a-failed-task" class="doc-anchor" aria-hidden="true"></div>

## 安静无输出的终端是否表示任务失败？

不是。健康提示展示缺失回执、安静的实施／审查，以及关联的 Session 事实，不会根据沉默推断成功或失败，也不会重试或重启智能体。决定如何继续之前，请检查终端和正式回执。等待仍未得到结果，并不是重发指令的理由。

<div id="what-survives-refresh-or-closing-the-browser" class="doc-anchor" aria-hidden="true"></div>

## 刷新页面或关闭浏览器后，哪些内容会保留？

项目、任务记录和协作历史存储在本地文件中。独立的 Session Host 让刷新后的浏览器可以重新连接运行中的智能体。关闭浏览器或关闭 Web 服务本身不会关闭这些智能体；请明确使用终端关闭控件。重启终端对会创建新的 Session，不会恢复模型上下文，但会保留已记录的任务历史。

<div id="how-do-notifications-work" class="doc-anchor" aria-hidden="true"></div>

## 通知如何工作？

在桌面通知设置选项卡中启用项目偏好设置。支持 Windows 10/11 和 macOS；Linux 会报告不支持。只有默认协作的正式回执会触发通知。对于同一项目／任务／轮次／状态，最多尝试一次，因此操作系统失败可能导致通知丢失，并且不会自动重试。后端和智能体继续运行时，浏览器可以关闭。系统权限和专注模式决定通知是否可见。

<div id="what-does-git-changes-include" class="doc-anchor" aria-hidden="true"></div>

## Git Changes 包含什么？

当前工作区变更，包括用户已有的编辑。它不是仅属于智能体的差异，也不审查已提交的历史。默认模式下，可以选择差异行，并在确认 Codex 位于空白输入提示符后发送备注。成功发送会清除此确认。自定义模式支持查看／复制。

<div id="how-do-i-archive-or-remove-local-history" class="doc-anchor" aria-hidden="true"></div>

## 如何归档或删除本地历史？

右键点击任务或项目可将其归档，并关闭终端。源码文件会保留。设置可以永久清除所有已注册项目中的已归档对话，包括其时间线历史。重新添加已归档目录可恢复项目条目。全局安装的 npm 包可通过 `npm uninstall -g @hogancv/coordinate-agents` 卸载；这不会删除项目数据。

<div id="where-are-the-original-protocol-and-adapter-docs" class="doc-anchor" aria-hidden="true"></div>

## 原始协议和适配器文档在哪里？

可选的结构化系统仍是采用本地优先方式的协调协议、运行时和 Plugin，并提供 Codex／Antigravity 参考适配器。默认参考工作流使用 Planner、Implementer 和 Reviewer 角色。从[结构化工作流](./structured-workflow.html)开始，然后阅读[协议（英文技术参考）](../protocol.html)、[MCP（英文技术参考）](../mcp.html)或[适配器作者指南（英文技术参考）](../adapter-author-guide.html)。Legacy Skill 卸载和备份恢复请参阅 [Legacy 安装（英文技术参考）](../legacy-ai-install.html)。
