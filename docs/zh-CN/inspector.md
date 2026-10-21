---
title: Web 工作台指南
description: 使用默认或自定义编程智能体终端、Git Changes 审查反馈、协作时间线和健康提示、通知、项目及持久会话。
---

<div id="web-workspace-guide" class="doc-anchor" aria-hidden="true"></div>

# Web 工作台指南

本指南描述 **Web 3.0.2 和当前源码检出目录**，涵盖 Git Changes／审查反馈、自定义终端、通知、时间线、健康提示和原生 Codex 恢复。参阅[快速开始](./getting-started.html)，选择固定版本的 npm 安装或源码开发方式。

<div id="start-and-select-a-project" class="doc-anchor" aria-hidden="true"></div>

## 启动并选择项目

```sh
# Published Web package
npx @hogancv/coordinate-agents@latest web --root "/path/to/project" --port 3000
# Current checkout, after npm ci
node bin/coordinate-agents.mjs web --root "/path/to/project" --port 3000
```

打开命令输出的 localhost URL。`--port 0` 会选择空闲端口。合并到 main 不会发布 npm 包。服务监听 `127.0.0.1`，并在可用时监听 `::1` 的同一端口。

启动目录会自动注册并选中。Git 子目录会解析为仓库根目录。普通启动目录会初始化 Git 和工作台存储，但不创建提交；符号链接根目录会被拒绝。**New project（新建项目）**可以浏览本地目录或接受其路径，并在初始化普通目录前要求确认。已注册但不可用的目录仍会显示，便于诊断。

侧边栏按项目分组显示任务。切换项目会保留后台会话运行，并恢复上次选中的任务。搜索按项目名和已加载／已缓存的任务标题进行过滤；任务尚未加载的项目会有标识。清除搜索或按 Escape 可恢复之前的展开状态。

<div id="default-collaboration" class="doc-anchor" aria-hidden="true"></div>

## 默认协作

**New task → Default Collaboration（新建任务 → 默认协作）**会创建新的 Codex 和 Antigravity Session，等待就绪后投递 Web 角色提示词。没有单独的需求表单：直接在 Codex 中输入请求。

Codex 澄清需求，将实施目标和验收标准发送给本任务的 Antigravity，等待回执，再审查实际差异和验证。Antigravity 报告 `WORKING`，实施后报告 `DONE` 或 `FAILED`。Codex 报告 `REVIEWING`，随后报告 `APPROVED` 或 `CHANGES_REQUESTED`；要求修正时会开启新一轮协作。

当前角色提示词版本为 `2.3.0-web-lite-3`。提示词要求初始化时仅作一句简短确认，不调用工具。它们不会自动调用 Skill、扫描 Agent Bus、恢复旧 Task、发现插件或创建 Task Graph。提示词禁止未经用户授权提交、推送和发布，但仍只是行为指导：这里**没有强制执行的状态机或沙箱**。

任务提供的 `workspace-message.mjs` 辅助脚本支持 `send`、`read`、`wait`、`report` 和 `changes`。智能体应使用提示词中给出的确切脚本路径。它验证已保存的任务／智能体／会话绑定，不会寻找其他任务的最新 Session。等待使用游标和协作修订号。超时表示仍待结果，不代表允许重发。

::: warning 正确理解状态
**工作台任务状态描述终端生命周期，不表示实施或审查已完成。**协作状态是智能体的报告，不是独立验证结果。普通终端输出和 `idle` 不能证明完成。Web 任务记录与结构化 Task、Task Graph 分开存储。
:::

Web 分组共享所绑定的仓库；创建分组不会创建隔离的 Git worktree。请避免互相冲突的并发修改。

<div id="reopen-a-conversation-or-recover-its-executor" class="doc-anchor" aria-hidden="true"></div>

### 重新打开对话或恢复执行者

已关闭或失败的默认任务会在状态旁显示 **Reopen task（重新打开任务）**。Codex 仍活跃而只有 Antigravity 缺失时，同一恢复入口显示为 **Recover executor（恢复执行者）**。两者都会在原始 UUID 已保存时使用它；后者保留当前 Codex 运行实例。缺少 UUID 或直接重新打开失败时，会使用浮层，让你输入确切 ID 或使用预填的已保存目标。打开或关闭浮层都不会启动终端。

完成常规 CLI 登录、信任确认和初始化后，两个当前受运行时管理的终端都必须就绪。随后任务即可派发和审查，无需 `/status`、标题栏中的 Awaiting confirmation 入口或第二次 UUID 确认。历史 `AWAITING_CONFIRMATION` 记录依据当前 Session 事实解释。身份冲突会阻止恢复和新的协作；就绪不代表持续验证了 TUI 身份。**Restart Pair（重启终端对）**是独立的运行时／HTTP 操作，会创建全新会话，并拒绝已绑定或已保留的默认任务。参阅[当前操作表](./codex-conversation-resume.html#动作表)。

<div id="custom-terminals" class="doc-anchor" aria-hidden="true"></div>

## 自定义终端

选择 **New task → Custom Terminals（新建任务 → 自定义终端）**，启动两个独立的 Generic CLI Session，并将它们绑定到任务及各自终端槽位。可以两次使用同一命令。可执行程序字段接受命令名或绝对路径，不接受内联参数或 shell 语法；这些字段不会求值执行 shell 命令。

项目默认值原子保存于 `.agent-bus/workspace-custom.json`。每个任务保存两个命令及可选提示词的快照，并在重启后保留该快照。共享提示词限制为 8 KB UTF-8；每个终端的提示词限制为 4 KB。保存默认值会更新已打开的创建对话框中尚未改动的命令字段，同时保留临时覆盖值。

使用各终端的 **Project Prompt（项目提示词）**按钮，可预览以 `---` 分隔的共享提示词和终端提示词。你可以复制它们，或明确确认目标 CLI 已就绪且支持多行 bracketed paste（括号粘贴模式）后发送。系统不会推断未知 CLI 的就绪状态。发送会预留键盘队列，通过一次原始 Session 写入投递，并在末尾附加 Enter；投递结果不确定时不会重试。预检期间关闭预览会取消待发送内容。已经派发的输入无法撤回。

自定义模式不会注入默认角色、创建协作轮次，也不启用 Send to Codex 审查反馈。仍可查看／复制 Git 差异。环境检查使用所选自定义任务的命令快照；未选中自定义任务时，检查使用默认组合。

<div id="terminals-and-session-lifecycle" class="doc-anchor" aria-hidden="true"></div>

## 终端与会话生命周期

键盘输入、Enter、方向键和 Ctrl-C 以有序的原始终端数据发送。输出使用可恢复游标和有界轮询，不会重建为聊天记录。可见区域决定 `sessionResize`。

拖动分隔线可在 25% 到 75% 之间调整分屏比例；双击恢复 50:50。保存的比例在刷新后仍保留。聚焦可放大一个终端而不重启它；还原会恢复已保存比例，切换则聚焦另一个终端。Zen 模式保留终端控件。窄屏上两个终端上下排列。界面支持简体中文和英文。

页面加载、任务选择和刷新都不会启动或重试智能体。刷新会重新连接已保存的独立 Session Host。关闭会终止选中的终端对；重启会创建两个新 Session，并保留之前已关闭的记录。关闭所有终端仅作用于所选项目。启动失败会清理运行时管理的终端对，并返回有界错误信息，不会自动重试。

关闭浏览器或在 Web 服务中按 Ctrl-C，不属于终端关闭操作。请使用明确的关闭控件停止智能体。Session Runtime 仅管理自己创建的进程，不会附加到任意 PID。

原生 PTY 可用性取决于平台和 Node 版本。Node 18 保留由运行时管理的 stdio 回退模式。在 Windows Node >=20 上，运行时通过一个一次性、分离运行的 Session Host 探测原生 PTY 启动和真实 TTY 行为。只有确认其所管理的进程已清理后，才会选择回退模式；实际 Session 失败绝不会自动重试任务。诊断中会显示 `backend`。stdio 回退无法提供完整 TUI 行为，也无法让子进程感知尺寸调整。

<div id="workspace-settings" class="doc-anchor" aria-hidden="true"></div>

## 工作台设置

设置有三个独立保存的选项卡。保存后对话框仍保持打开；切换选项卡会保留尚未保存的编辑。固定页脚显示关闭按钮和当前选项卡的保存按钮。

| 选项卡 | 范围与效果 |
| --- | --- |
| 默认协作 | 覆盖 `codex` 和 `agy` 可执行程序，可选填 Codex 模型／推理选项。适用于新启动和重启；模型选项使用本地模型缓存。 |
| 自定义终端 | 两个默认可执行程序，以及共享／各终端提示词。新任务保存这些值的快照；已有自定义任务保留原有快照。 |
| 桌面通知 | 项目级通知偏好，在下一份正式回执到来时读取。 |

::: warning Antigravity 默认跳过工具审批
Antigravity 默认使用 `--dangerously-skip-permissions` 自动批准工具请求。需要审批时，请在工作台设置中选择 prompt 模式。明确保存的参数数组会覆盖默认值；运行中的 Session 保留启动时的参数。
:::

默认终端设置保留无关参数，并采用项目 > 用户 > 适配器默认值的优先级。它们不会重新配置运行中的 CLI。可执行程序可用，不代表已登录、有模型访问权限、服务商健康或账户额度充足。

<div id="git-changes-and-review-feedback" class="doc-anchor" aria-hidden="true"></div>

## Git Changes 与审查反馈

Changes 抽屉显示有界的工作区 Git 状态和差异。它包含用户先前的编辑，不会将每项变更都归因于智能体。干净的工作区不能否定已经提交的变更；请单独检查相关提交。此视图不是历史审查，也不是每轮独立差异。

默认模式下，可以选择差异行、添加备注并审阅反馈预览。每次发送前，都要确认 Codex 位于空白输入提示符。成功发送会清除此确认；编辑此前已发送的反馈后，需要重新确认。预览最多包含 40 个选中行和 8 KB 内容。

预检期间切换文件、刷新差异或关闭抽屉，会在派发终端输入前取消待发反馈。已发送的输入无法撤回。发送备注本身不会记录批准，也不能证明 Codex 已按备注操作。自定义任务可查看／复制差异，但不能使用这一针对 Codex 的交接功能。

<div id="collaboration-timeline" class="doc-anchor" aria-hidden="true"></div>

## 协作时间线

展开默认协作终端上方通常收起的面板，可查看持久化的 `SENT`、`WORKING`、`DONE`、`REVIEWING`、`CHANGES_REQUESTED`、`APPROVED` 和 `FAILED` 事件。条目包含时间、来源智能体、轮次 ID、状态转换，以及经过脱敏的简短回执。可以筛选当前轮次、全部轮次或特定历史轮次。

`SENT` 只确认输入已派发；其他状态是智能体的正式报告。面板不会独立验证结果，也不会派发、重试或审查工作。自定义模式和 Zen 模式隐藏此面板。历史在页面刷新、工作台重启和终端对重启后仍保留。早期版本未记录的历史无法重建。

清除已归档任务也会删除其保存的时间线。

<div id="collaboration-health" class="doc-anchor" aria-hidden="true"></div>

## 协作健康提示

任务列表提示和时间线旁的面板会显示：等待 `WORKING` 回执、安静的实施／审查、`DONE` 等待审查、正式 `FAILED`，以及关联 Session 的退出、失败或记录不可用。安静表示缺少可观察证据，不能证明智能体卡住或失败。

需要关注的阈值默认为 30 分钟，可设为 1–10080 分钟，并保存在当前浏览器中。新的正式回执会重置计时器，包括同一状态的进度摘要；完全相同的重复报告仍保持幂等。已关闭／归档任务及先前的终端对没有活跃提示。自定义模式只显示 Session 事实。

健康提示使用普通工作台刷新机制。它不会发送系统通知、重发指令、创建轮次、重启会话或改变协作状态。

<div id="desktop-notifications" class="doc-anchor" aria-hidden="true"></div>

## 桌面通知

支持 Windows 10/11 和 macOS；Linux 会报告不支持。在设置中为当前项目启用通知，并保存通知选项卡。通知初始为关闭状态。默认选中 `APPROVED` 和 `FAILED`；`DONE` 可选。固定的 “Send test notification（发送测试通知）”操作不会创建任务或改变协作状态。操作系统接受通知，不代表它已经显示；未看到通知时，请检查系统权限和专注／勿扰模式。

只有经过校验且已持久化的默认协作回执会触发通知。通知由 `workspace-message report` 派发，独立于浏览器连接。后端、智能体和交互式操作系统会话保持运行时，浏览器可以关闭。自定义输出、空闲、Session 退出、任务关闭／重启和归档均不是通知事件。

Windows 使用 PowerShell 5.1 和 WinRT Toast。首次启用通知后的派发或测试会创建当前用户的 Coordinate Agents Notifications 开始菜单快捷方式，AppUserModelID 为 `CoordinateAgents.Workspace`；不需要管理员权限或第三方服务。macOS 使用 `/usr/bin/osascript`，采用固定脚本和独立参数。操作系统策略控制发送者权限和显示行为。

::: warning 通知最多尝试一次
偏好保存在 `.agent-bus/workspace-notifications.json`；`.agent-bus/notifications/` 下的有界账本会在向操作系统派发前，先认领项目／任务／轮次／状态组合。即使失败也最多尝试一次；认领后崩溃可能丢失通知。修改摘要不会重新发送，新轮次则可再次通知。
:::

通知只包含经过清理的项目／任务标签，不包含提示词、输出、回执摘要或绝对路径。账本最多保存 4096 条认领记录，并回收已删除任务的条目；除此以外，容量不足会报告容量问题，不会冒险产生重复通知。派发失败不改变任务回执。自动化测试模拟原生派发，不能证明通知真实显示在屏幕上。

<div id="storage-and-archives" class="doc-anchor" aria-hidden="true"></div>

## 存储与归档

用户配置目录保存加锁、原子写入的 `workspace-projects.json` 注册表。每个项目保留自己的 `.agent-bus/`：

- `.agent-bus/workspace-tasks/<id>.json`：Web 任务身份、模式、终端绑定和协作事实。
- `workspace-custom.json`：自定义默认值；任务保留自己的快照。
- `workspace-notifications.json` 和 `notifications/`：通知偏好和派发事实。
- Session Runtime 记录和有界终端输出。

右键点击任务或项目，可将其归档、关闭终端并隐藏记录，同时保留项目源码文件。已归档项目在刷新／重启后仍隐藏；明确重新添加该目录会恢复项目条目。设置提供永久清除所有已注册项目中已归档对话的功能。这会删除它们保存的历史，包括时间线。

Web 记录与 `.agent-bus/tasks/` 和 `.agent-bus/task-graphs/` 不同。Web 界面不会显示、迁移或删除这些结构化记录。

<div id="local-http-boundary" class="doc-anchor" aria-hidden="true"></div>

## 本地 HTTP 边界

页面通过 `meta[name="coordinate-agents-capability"]` 提供每次启动专属的 capability（能力凭据）。请求将其作为 `x-coordinate-agents-capability` 发送。网关检查环回 Host／Origin、capability、有界 JSON、白名单操作和仓库绑定。项目 API 解析自己的项目；浏览器选项卡不会改变服务端全局选择。`POST /api/action` 处理明确的修改操作，例如创建任务、终端输入、尺寸调整、设置和归档。

默认 Web API 提供工作台任务／设置／健康、仓库／差异及绑定的 Session 数据。它**不提供**结构化 `/api/tasks`、`/api/graphs`、Task Graph 操作或 MCP。这些仍是独立的源码／Plugin 接口。capability 保护本地请求，不是多用户身份认证。

<div id="read-only-inspector-and-structured-workflows" class="doc-anchor" aria-hidden="true"></div>

## 只读 Inspector 与结构化工作流

保留的 Inspector 是独立的只读界面，不是当前 Web 工作台：

```sh
node bin/coordinate-agents-legacy.mjs inspector --port 3001
# Older published CLI, pinned explicitly:
npx @hogancv/coordinate-agents@2.4.0 inspector --port 3001
```

npm 3.x 不包含它。对应约定请参阅[结构化工作流](./structured-workflow.html)、[Session Runtime（英文技术参考）](../session-runtime.html)和[事件日志（英文技术参考）](../event-journal.html)。

<div id="security" class="doc-anchor" aria-hidden="true"></div>

## 安全

请让服务保持仅监听环回地址；它没有云同步或多租户模式。智能体命令和包装程序是受信任的本地可执行程序，使用各自配置的权限。HTTP 根目录检查不会将智能体 shell 命令放入沙箱，也不会阻止仓库编辑。`.agent-bus/` 是本地明文存储；有界脱敏不是秘密存储机制。不要把凭据放进提示词、回执或诊断中。分享数据前请阅读[安全说明](./security.html)。
