---
title: 快速开始
description: 启动本地 Web 工作台，选择 npm 包或当前源码，配置终端，并完成首次 Codex 与 Antigravity 协作任务。
---

<div id="getting-started" class="doc-anchor" aria-hidden="true"></div>
<div id="1-check-prerequisites" class="doc-anchor" aria-hidden="true"></div>
<div id="2-choose-published-npm-or-current-source" class="doc-anchor" aria-hidden="true"></div>
<div id="3-check-workspace-settings" class="doc-anchor" aria-hidden="true"></div>
<div id="4-run-your-first-default-task" class="doc-anchor" aria-hidden="true"></div>
<div id="5-keep-or-close-your-sessions" class="doc-anchor" aria-hidden="true"></div>

# 快速开始

此前的产品方向请参阅 [v2.4 原始文档与迁移说明](./v2.4.html)。

主要入口是 **Web 工作台（Web Workspace）**：一个本地浏览器工作台，内置两个持久化的编程智能体终端。使用这一入口，无需安装 Codex Plugin、Skill，无需配置 MCP，也无需全局安装 npm 包。

<div id="_1-check-prerequisites" class="doc-anchor" aria-hidden="true"></div>

## 1. 检查前置条件

安装 Node.js >=18、Git，以及你准备使用的编程 CLI。使用默认协作（Default Collaboration）时，请检查：

```sh
node --version
git --version
codex --version
agy --version
```

创建任务前，先分别通过各智能体自己的 CLI 登录。工作台只检查可执行程序是否可用；这并不能验证服务商访问权限、登录状态、模型可用性或账户额度。自定义任务检查的是其保存的两个命令，不要求使用默认组合。

原生 PTY 支持取决于已安装的 Node 版本和平台组合。Node 18 保留由运行时管理的 stdio 回退模式；它无法提供完整 TUI，也无法让子进程感知终端尺寸调整。参阅[终端故障排查](./troubleshooting.html#终端显示或尺寸调整受限)。

<div id="_2-choose-published-npm-or-current-source" class="doc-anchor" aria-hidden="true"></div>

## 2. 选择已发布的 npm 包或当前源码

<div id="published-npm" class="doc-anchor" aria-hidden="true"></div>

### 已发布的 npm 包

```sh
npx @hogancv/coordinate-agents@latest web --root "/path/to/project" --port 3000
```

本指南面向 **3.0.2 Web 版本**。需要固定版本时，将 `@latest` 替换为 `@3.0.2`；不要假定 `latest` 指向某个版本，请先运行 `npm view @hogancv/coordinate-agents dist-tags` 核验。

<div id="current-source" class="doc-anchor" aria-hidden="true"></div>

### 当前源码

3.0.2 已包含 Git Changes／审查反馈、自定义终端、桌面通知、时间线、健康提示和原生 Codex 恢复功能。使用源码开发时：

```sh
git clone https://github.com/hogancv/coordinate-agents.git
cd coordinate-agents
npm ci
node bin/coordinate-agents.mjs web --root "/path/to/project" --port 3000
```

已有检出目录时，在其根目录运行最后两条命令即可。源码合并不会发布 npm 包。[工作台指南](./inspector.html)中的功能描述针对当前检出目录。

打开命令输出的 URL，通常为 `http://localhost:3000`。使用 `--port 0` 可选择空闲端口。启动时选定的目录会自动注册。Git 子目录会解析为仓库根目录；非 Git 启动目录会初始化 Git 和工作台存储，但不创建提交。请谨慎选择目录。

npm 3.x 的命令入口为 `web`、`--help` 和 `--version`。Web 接受 `--root`、`--port` 和 `--json`。旧版的 `install`、`doctor`、`config`、`task`、`quickstart` 和 `inspector` 命令需要单独的 Legacy 运行时。

<div id="_3-check-workspace-settings" class="doc-anchor" aria-hidden="true"></div>

## 3. 检查工作台设置

当前源码的设置有三个独立保存的选项卡：

- **默认协作（Default Collaboration）：**覆盖 `codex` 和 `agy` 可执行程序，并可选填 Codex 模型和推理选项。更改对新启动和重启的会话生效。
- **自定义终端（Custom Terminals）：**设置两个默认可执行程序，以及可选的共享提示词／各终端提示词。新任务会保存这些设置的快照；已有自定义任务重启时继续保留原快照。
- **桌面通知（Desktop Notifications）：**项目级偏好设置，默认关闭。支持 Windows 10/11 和 macOS；Linux 会报告不支持。

可执行程序字段接受命令名或绝对路径，不接受内联参数或 shell 语法。Codex 模型留空时使用 CLI 默认值。请保存当前选项卡；切换选项卡会保留尚未保存的编辑。

::: warning Antigravity 工具权限
Antigravity 默认使用 `--dangerously-skip-permissions` 自动批准工具请求。需要逐次审批时，在工作台设置中选择 prompt 模式。已运行会话保留启动时的参数；明确保存的参数数组会覆盖默认值。
:::

<div id="_4-run-your-first-default-task" class="doc-anchor" aria-hidden="true"></div>

## 4. 运行第一个默认任务

1. 点击 **New task（新建任务）**，选择 **Default Collaboration（默认协作）**，等待两个 CLI 初始化。
2. 直接在 Codex 中输入具体需求，例如：“修复这个缓存失效问题，保持公共 API 不变，并运行相关回归测试。”
3. Codex 使用提供的辅助脚本，将目标、范围和验收标准发送给本任务的 Antigravity。
4. Antigravity 报告 `WORKING`，实施并验证，然后报告 `DONE` 或 `FAILED`。
5. Codex 审查实际变更和证据，再报告 `APPROVED` 或 `CHANGES_REQUESTED`。需要修正时，以新一轮协作发送要求。

展开 **Collaboration Timeline（协作时间线）**可检查派发与回执。`SENT` 确认已派发，不代表完成。`DONE` 和 `APPROVED` 是智能体的正式报告，不是独立验证结果。任务列表中的运行／关闭状态描述的是终端生命周期，不表示实施或审查已完成。

使用 **Git Changes（Git 变更）**检查工作区差异。默认模式下，可以选择行、添加审查备注，并在发送前确认 Codex 停在空白输入提示符。每次成功发送后，此就绪确认都会清除。差异可能包含用户先前的编辑，也不包含已经提交的变更。

<div id="_5-keep-or-close-your-sessions" class="doc-anchor" aria-hidden="true"></div>

## 5. 保留或关闭会话

刷新页面会重新连接保存的会话。切换项目会让后台终端继续运行。关闭浏览器或关闭 Web 服务本身，都不会关闭独立的 Session Host；请明确使用 **Close（关闭）**、**Restart（重启）**，或所选项目的 **Close all terminals（关闭所有终端）**控件。

右键点击任务或项目可将其归档，并关闭它的终端。源码文件会保留。设置可以永久清除所有已注册项目中的已归档对话，包括其时间线历史。重新添加已归档项目的目录可恢复项目条目。

Web 任务共享项目的工作目录，不会创建隔离的 worktree。请避免同时进行互相冲突的编辑。提示词要求提交、推送和发布前取得授权；这些是行为指令，不是沙箱。

<div id="success-and-failure-signals" class="doc-anchor" aria-hidden="true"></div>

## 成功与失败信号

成功的首次运行应能看到两个已配置的 CLI、一次绑定到当前任务的派发、一份实施回执，以及 Codex 对实际变更和验证的审查。请检查报告和差异，不要把终端空闲或任务列表状态当作完成证明。

启动失败时，先检查可执行程序和会话诊断，再明确重启。超时表示仍待结果，不代表允许重新发送输入。健康提示用于指出缺失的证据或会话问题；仅凭安静无输出，不能证明智能体卡住。参阅[故障排查](./troubleshooting.html)。

<div id="if-you-need-structured-tasks-or-a-codex-plugin" class="doc-anchor" aria-hidden="true"></div>

## 如果需要结构化 Task 或 Codex Plugin

请使用单独的[结构化工作流指南](./structured-workflow.html)，了解 Plugin 安装、Agent Bus Task、实施证据、Task Graph、留档审查和恢复。这些能力保留在 GitHub 源码／Plugin 和 npm 2.4.0 中；npm 3.x Web 不提供这些能力。

下一步：[工作台指南](./inspector.html) · [常见问题](./faq.html) · [安全说明](./security.html)
