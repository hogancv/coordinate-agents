---
layout: page
title: coordinate-agents 简体中文文档
description: 面向 AI 编码代理的本地优先协调协议与运行时。以 Codex CLI 与 Antigravity CLI 作为首发参考适配器，支持 generic-cli 接入自定义 CLI 代理，并通过适配器扩展模型支持桌面端与外部执行环境接入。
permalink: /zh-CN/
---

# coordinate-agents

`coordinate-agents` 是面向 AI 编码代理的本地优先协调协议与运行时。在同一个 Git 仓库中通过可恢复的本地 `.agent-bus` 协调多代理协作。**OpenAI Codex App/CLI** 与 **Google Antigravity CLI (`agy`)** 作为首发官方参考适配器与默认工作流（Codex 负责需求澄清、规格说明、提交审查与发布门禁；Antigravity 独占代码与测试实现），同时支持通过适配器动态注册与配置任意 CLI 代理。任务运行期间，Runtime 可能创建由自己拥有的本地持久 PTY Session Host，但不会控制 Codex App Terminal UI。

## 通过 GitHub 市场安装 Codex 插件（普通用户推荐）

```sh
codex plugin marketplace add hogancv/coordinate-agents
codex plugin add coordinate-agents@coordinate-agents
```

启用插件后，在 Codex App 中新建线程并调用 `$coordinate-agents`。这是推荐的交互流程；下面的 npm CLI
快速启动仅作为自动化或不支持直接调用 Codex App Skill 的环境的备用方式。

只安装 Codex Plugin 时不需要 `npm install -g @hogancv/coordinate-agents`。五个 Skill 统一通过
`node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" <command> ...` 解析当前 Plugin
载荷中的唯一 canonical Runtime，不依赖 `PATH` 中存在 `coordinate-agents`；同时支持 Git 缓存、个人本地
插件市场和包含空格的 Windows 路径。

插件采用 Multi-Skill 入口：`coordinate-setup` 发现并配置 Implementer，`coordinate-task` 提供持久化
Task API，`coordinate-review` 验证 commit 与证据，`coordinate-recover` 处理用户明确确认的恢复。
机器需要读取运行时事实时，可使用 `setup --json` 与 `task status --json`；这些路径都复用同一个项目级
Agent Bus。

正常路径是 **安装 Plugin → Discover → Configure → Build**：`coordinate-setup` 只做发现后，由一次
`setup configure` 事务写入用户 command、注册项目 Agent、配置 Adapter、分配 Implementer 角色并执行
兼容性/可执行文件检查；规格完整后，`coordinate-task task dispatch` 才发送 `IMPLEMENT` 并打开或复用执行端的持久 Session；Task
只保存不拥有 Session 的 `sessionId`。`IMPLEMENTATION_DONE` 会映射为 `REVIEWING`，最后由
`coordinate-review` 记录审查决策；`CHANGES_REQUESTED` 会在健康 Session 中复用同一 PTY 上下文。

## 直接在 Codex App 中使用（推荐）

安装插件后，在 Codex App 中添加或打开目标 Git 项目，并将线程项目路径指定为包含 `.git` 的项目根目录。
新建线程后调用 `$coordinate-agents` 即可，不需要手动打开两个 CLI 窗口。Runtime 会在本机打开或复用配置好的
Implementer 持久 Execution Session；请确认执行命令是真实存在的可执行文件，例如 `agy` 或 `claude`，而不是角色名称。
Session 工具只提供有界的状态、读写、输出和关闭操作，不会控制 Codex App Terminal UI。

配置其他 CLI 时，推荐直接告诉当前 Codex App 线程先检查本机可执行文件和对应的 `--help`，再使用 `generic-cli`
注册、运行 `doctor` 并展示最终配置，确认后再启动任务。内置 Antigravity Adapter 的一次性启动追加
`--prompt-interactive <prompt>`；持久 Session 会为当前 `agy`/`agy-proxy` 先传入 `--prompt-interactive ""`，再通过 PTY 写入真正的第一条指令。
它不会自动添加完全权限或沙箱绕过参数。

- [完整简体中文 README](https://github.com/hogancv/coordinate-agents/blob/main/README.zh-CN.md)
- [AI 安装指南](https://github.com/hogancv/coordinate-agents/blob/main/AI_INSTALL.md)
- [安全说明](../security.html)
- [Adapter Conformance Kit（英文）](../adapter-conformance.html)
- [本地 Inspector Web UI（英文）](../inspector.html)
- [常见问题](../faq.html)

## CLI 备用安装与快速开始

```sh
npx @hogancv/coordinate-agents@latest install --lang zh-CN
npx @hogancv/coordinate-agents@latest doctor --lang zh-CN
npx @hogancv/coordinate-agents@latest quickstart --template feature --task "开发 Todo Web 应用" --lang zh-CN
```

机器相关的 CLI 命令配置在 `~/.coordinate-agents/config.json`，优先级为项目级显式命令 >
用户级命令 > Adapter 默认值。可使用：

```sh
npx @hogancv/coordinate-agents config set agent.antigravity.command agy-proxy
```

`launch` 会在启动前检查最终可执行文件；spawn、非零退出或对话运行时失败会写入 `ERROR`
并停止当前监督，不会自动回退或重试。不会预检测登录状态。

Task Graph v1 是向后兼容的新增契约。通过 MCP 的
`coordinate_agents_task_graph_validate`（或 CLI 的
`task graph-validate --input <graph.json>`）可在 Agent Bus、Adapter、worktree、Session
或进程产生任何副作用前校验父 Task、唯一子任务 ID、显式 Implementer、依赖边、非空规格和
有界 `maxConcurrency`。无效图返回稳定的 `TASK_GRAPH_INVALID`；结果始终区分
`parentTaskId` 与 `subtaskId`；父 Task 可选携带现有的非空 `spec` 与 `implementer`。
校验通过后，可用 `coordinate_agents_task_graph_create` 或 CLI 的
`task graph-create --input <graph.json>` 原子持久化父 Task、子任务、依赖前沿、原因、证据和
`TASK_GRAPH_CREATED` 事件；它不会启动 Adapter、Session 或 Implementer。既有 `task status`、
`task inspect` 以及 `task graph-status`、`task graph-inspect` 别名可读取 READY/WAITING/BLOCKED
前沿和有界生命周期事件。通过 `coordinate_agents_task_graph_plan` 或
`task graph-plan --id <parentTaskId>` 可只读预览确定性依赖、Agent/Adapter/可执行文件与并发容量决策，
不会创建 worktree、Bus 消息、Session、事件或子进程。通过 `coordinate_agents_task_graph_dispatch` 或
`task graph-dispatch --id <parentTaskId> --subtask <subtaskId>` 可在完全隔离的 Git worktree
（`.agent-bus/worktrees/<parentTaskId>/<subtaskId>`）和独立分支中派发单项 READY 子任务，安全捕获基准提交
且不修改用户工作区中未提交的文件，并在完成后自动解锁依赖前沿。详见[Task Graph v1 契约](../task-graph-v1.html)。
创建图时还可通过 `--intent-map <intent-map.json>` 或 MCP 的 `intentMap` 附加 Intent Map v1。
它必须使用相同父 Task ID、恰好覆盖每个子任务一次，并仅包含标准化的仓库相对写入模式；
`scopePolicy` 默认为 `warn`。status、inspect 和 plan 会区分旧图的覆盖不可用
（`writeIntent: null`）与显式空声明（`writeIntent: []`）。无效或超限映射会在任何运行时副作用前拒绝。
通过 `coordinate_agents_task_graph_run` 或 `task graph-run --id <parentTaskId>` 可对当前合格前沿执行一次
有界并行派发：不超过 `maxConcurrency`，每个子任务使用独立 worktree、分支和 Runtime Session，
新解锁的工作保持 READY，等待下一次显式执行。
图状态和 inspect 结果同时返回每个子任务基于持久 Session、worktree、提交和证据的恢复事实，
不会从文件名或描述推断成功。协调器或 Session host 中断后，可显式调用
`coordinate_agents_task_graph_recover`（`task graph-recover`）验证已有
`IMPLEMENTATION_DONE`，或把不健康的 RUNNING 记录为带完整 root/graph/subtask/Agent/Session/worktree
事实的 FAILED；不会自动重试。调用 `coordinate_agents_task_graph_resume`（`task graph-resume`）
只会复用已验证健康且由 Runtime 所有的 Session/worktree，或把已退出/失败的 Session 返回 READY，
之后仍需单独 dispatch。`coordinate_agents_task_graph_stop` 与
`coordinate_agents_task_graph_cleanup` 只关闭 Runtime 所有的 Session、在有界清理后移除精确的
Runtime worktree，并保留用户工作区、分支、远端引用、提交和证据；失败也会持久化，重复操作幂等。

`.agent-bus` 是本地明文数据，不要写入令牌、Cookie、密码或私钥。在默认参考工作流中，两个代理不得同时修改产品代码或并发执行 Git 写操作。
