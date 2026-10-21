---
title: 结构化工作流（Plugin 与 Legacy CLI）
description: 通过 GitHub Plugin 或 Legacy 运行时使用可选的结构化 Task、Agent Bus 交接、审查证据和显式恢复。
---

<div id="structured-workflow-plugin-and-legacy-cli" class="doc-anchor" aria-hidden="true"></div>
<div id="1-check-prerequisites-and-install-both-skills" class="doc-anchor" aria-hidden="true"></div>
<div id="2-initialize-the-first-task" class="doc-anchor" aria-hidden="true"></div>
<div id="3-complete-one-lifecycle" class="doc-anchor" aria-hidden="true"></div>

# 结构化工作流：Plugin 与 Legacy CLI

::: note v2.4 结构化路线
本参考文档跟随保留的 Plugin 与源码 Legacy 运行时，可能包含后续修复，并非冻结的 v2.4.0 快照。
npm 3.x Web 不提供这些结构化 API。
[原始 v2.4.0 文档与迁移](./v2.4.html) · [当前 Web 指南](./getting-started.html)。
:::

这是 GitHub Plugin 与源码中保留的可选协议驱动工作流。
当前 Web Workspace 请从[快速开始](./getting-started.html)入手。
Web 任务列表与协作回执独立于本页介绍的结构化 Task API。

npm 3.x 包仅提供 Web Workspace。本页所有结构化 npm 示例均固定为 **2.4.0**。
源码使用 `node bin/coordinate-agents-legacy.mjs`；Plugin 使用内置运行时并独立编号。
**2026-10-21 已核验**：npm `latest` 和源码包为 **3.0.2**；`.codex-plugin` Plugin 为 **2.4.0**。

<div id="install-the-optional-plugin" class="doc-anchor" aria-hidden="true"></div>

## 安装可选 Plugin

```sh
codex plugin marketplace add hogancv/coordinate-agents
codex plugin add coordinate-agents@coordinate-agents
```

在 Codex 中打开目标仓库，新建对话，调用 `$coordinate-agents`，先执行发现，再配置或分派工作。
无需全局安装 npm 包。

<div id="codex-plugin-first-path" class="doc-anchor" aria-hidden="true"></div>

## 优先使用 Codex Plugin

Codex Plugin 是结构化工作流的首选体验。其多个 Skill 负责引导用户，无需暴露 Agent Bus 文件夹：

| 意图 | Skill | 首个操作 |
| --- | --- | --- |
| 发现 | `coordinate-setup` | 通过 MCP 发现设置，不修改配置 |
| 配置 | `coordinate-setup` | 用一次 `setup configure` 事务配置命令、Agent、Adapter 和 Implementer 角色 |
| 尝试 | `coordinate-task` | 为已批准的规格执行 `task create`，再执行 `task dispatch` |
| 审查 | `coordinate-review` | 核验 Task 的提交、差异、测试与证据，并记录结论 |
| 恢复 | `coordinate-recover` | 检查 `task status`，再次分派前显式执行 `task resume` |

Plugin 的 Task API 是现有持久化 Agent Bus 之上的产品抽象。
五个 Skill 通常使用内置 MCP 工具。需要显式 CLI 调试或 MCP 不可用时，回退入口通过以下方式解析同一内置运行时：

```text
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" <command> ...
```

活动 Skill 提供绝对 `<skill-dir>`。该入口解析缓存或本地 Plugin 载荷中的标准
`bin/coordinate-agents-legacy.mjs`，无需全局 `coordinate-agents` 可执行文件。
npm 2.4.0 Legacy CLI 是运行时、回退及高级调试路径，不是 Plugin 上手的前提。
Plugin 首页提供发现、配置、尝试三类提示；Todo Web 应用与其他请求使用相同的 Task 工作流。

```sh
# 仅用于回退或调试；将 <skill-dir> 替换为活动 Skill 的 SKILL.md 所在绝对目录。
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" setup --root "<repository>" --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task create --root "<repository>" --title "Build a Todo web app" --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task dispatch --root "<repository>" --id task-... --spec "<approved specification>" --json
node "<skill-dir>/../coordinate-agents/scripts/runtime-entry.mjs" task status --root "<repository>" --id task-... --json
```

JSON 标准输出是一个可解析文档：成功时为 `{ok, command, ...}`；失败时为
`{ok:false, command, error:{code,message,recoverable,...}}`。
Implementer 失败会终止本次激活；Plugin 报告结构化错误，不会循环自动重试。

::: note
本教程展示**默认参考工作流**：OpenAI Codex App/CLI 负责规划与审查，Google Antigravity CLI 负责实现。
底层 `.agent-bus` 运行时也支持通过[动态注册代理（英文）](../adapter-author-guide.html)使用自定义代理与角色分配。
:::

本教程从已有 Git 仓库开始，以经过审查的提交结束。
先安装 Node.js、Git、Codex App 或 Codex CLI，以及 Antigravity（`agy`）等 Implementer CLI。
各 CLI 保留自己的原生认证；Coordinate Agents 不预检登录状态。耗时取决于任务与供应商响应速度。

<div id="codex-app-path-recommended" class="doc-anchor" aria-hidden="true"></div>

## Codex App 路径（推荐）

Codex App 可以直接调用 Skill，用户无需手动打开两个 CLI 窗口。

1. 从 GitHub marketplace 安装并启用 `coordinate-agents` Codex Plugin。
2. 将目标 Git 仓库添加或打开为 Codex App 项目。
3. 将对话的项目或工作区路径设为仓库根目录，即包含 `.git` 的目录。
4. 新建对话，调用 `$coordinate-agents`，要求 Codex 先执行发现。
5. 选定可执行文件后，让 `coordinate-setup` 运行 `setup configure`；不要手工串联
   `config set`、`agent add`、工作流编辑和 `doctor`。

Codex App 对话承担 Planner/Reviewer 一侧。运行时会打开或复用按项目与 Agent 划分的
Execution Session，为 Implementer 提供持久 PTY，因此执行命令必须是同一台机器上已安装的可执行文件。
Session 独立于 Codex App Terminal 界面；Plugin 自带运行时，无需全局 npm 安装。
发现之后，让高层设置事务配置选定可执行文件、项目 Agent、Adapter 和 Implementer 角色。
以下命令仅用于独立 npm 兼容或调试路径：

```console
$ npx --yes @hogancv/coordinate-agents@2.4.0 config set agent.antigravity.command agy
$ npx --yes @hogancv/coordinate-agents@2.4.0 agent add claude \
    --adapter generic-cli --command claude \
    --args '["--print", "{prompt}"]'
```

使用实际启动 Implementer 的命令（`agy`、`claude` 或供应商包装器），并用该 CLI 自身的 `--help` 核验参数。
运行时把选定项目根目录作为子进程工作目录，因此 `--dir` 参数并非普遍可用或必需。
便捷设置可向 Codex App 提出：“用 `$coordinate-agents` 将 Claude Code 配置为本项目 Implementer；
检查 `claude --help`，通过 `generic-cli` 注册，运行 `doctor`，显示解析后的配置，等我确认后再启动。”
下方 CLI 路径仅用于自动化或不能直接执行 Codex App Skill 的主机。

Workspace 设置支持 Antigravity 提示模式或自动批准。Adapter 默认参数是
`--dangerously-skip-permissions`；显式保存的参数数组优先。
已发布的 npm 2.4.0 运行时需要下方明确的权限配置。
Legacy 单次执行路径先传入配置的 `args`，再追加 `--prompt-interactive <prompt>`；
持久 Session 为兼容当前 `agy` 解析器，以 `--prompt-interactive=` 启动，随后通过 PTY 写入第一条指令，
除非显式配置了 `{prompt}`。仅当 `agy --help` 确认支持 `--dangerously-skip-permissions`，
且用户明确要求时，才通过 Workspace 设置或 CLI 配置该参数；不要假定 Plugin 已添加它：

```console
$ npx --yes @hogancv/coordinate-agents@2.4.0 config set agent.antigravity.args '["--dangerously-skip-permissions"]'
$ npx --yes @hogancv/coordinate-agents@2.4.0 config list
```

<div id="_1-check-prerequisites-and-install-both-skills" class="doc-anchor" aria-hidden="true"></div>

## 1. 检查前置条件并安装两个 Skill

```console
$ node --version
v22.23.0
$ git --version
git version 2.53.0.windows.1
$ codex --version
codex-cli 0.146.0
$ agy --version
1.1.12
$ npx --yes @hogancv/coordinate-agents@2.4.0 config set agent.antigravity.command agy
Updated user configuration: ~/.coordinate-agents/config.json
$ npx --yes @hogancv/coordinate-agents@2.4.0 install
Installed Codex: .../skills/coordinate-agents
Installed Antigravity: .../skills/coordinate-agents
$ npx --yes @hogancv/coordinate-agents@2.4.0 doctor
Node.js: available (v22.23.0)
Git: available (git version 2.53.0.windows.1)
Codex CLI: available (codex-cli 0.146.0)
Antigravity CLI (agy): available (1.1.12)
Codex: healthy (1.2.3) at .../codex/skills/coordinate-agents
Antigravity: healthy (1.2.3) at .../agy/skills/coordinate-agents
All prerequisites and selected installations are healthy.
```

Implementer 最终命令按以下优先级解析：项目显式命令、用户级
`~/.coordinate-agents/config.json` 命令、Adapter 默认值。
`doctor` 报告解析后的命令及可执行文件状态。可执行文件不可用、启动失败、非零退出、
对话或运行时错误都会使 `launch` 快速失败，并将 Agent 设为 `ERROR`，不会静默回退或重试。

版本与用户目录因环境而异。最终健康摘要和退出状态 `0` 才是成功信号。
非零退出、`missing`、`invalid` 或 `requires attention` 表示安装未完成；
应遵循输出的修复建议并重新运行 `doctor`。

安装前，两个选定 Skill 目录都不含 `coordinate-agents`。安装后，每个选定目录包含相同的受管载荷：

```text
coordinate-agents/
├── .coordinate-agents.json
├── SKILL.md
├── agents/
├── references/
└── scripts/
```

安装器不复制账户 token。Codex 与 Antigravity 将原生凭据保留在各自的用户目录中。

<div id="_2-initialize-the-first-task" class="doc-anchor" aria-hidden="true"></div>

## 2. 初始化首个任务

Plugin 路径不能用 `quickstart` 代替 Task 分派。Codex 获得完整规格后，Skill 先调用
`task create`，再调用 `task dispatch`。分派会完成 Implementer 解析、可执行文件检查、
`IMPLEMENT` Bus 交接、Session 打开或复用、持久 PTY 输入及失败传播。
Task 保存不拥有会话生命周期的 `sessionId`。
成功的 `IMPLEMENTATION_DONE` 将 Task 转为 `REVIEWING`；若 Implementer 仍在运行，
Task 为 `WAITING_IMPLEMENTER`，Session 仍可检查。

审查返回 `CHANGES_REQUESTED` 后，下次显式分派复用同一健康 Session，并向其写入新反馈。
退出或失败的 Session 不会自动重启；恢复检查是只读操作，需要显式恢复或分派。

在项目 Git 根目录运行：

```console
$ npx --yes @hogancv/coordinate-agents@2.4.0 quickstart \
    --template feature --task "Add completion support to the Todo app"
Collaboration workspace initialized: .../todo-app
Generated role prompts: .../todo-app/.agent-bus/launch

1. Codex terminal (copy and run):
npx --yes @hogancv/coordinate-agents@2.4.0 launch --agent codex ...

2. Antigravity terminal (copy and run):
npx --yes @hogancv/coordinate-agents@2.4.0 launch --agent antigravity ...
```

在两个独立终端中分别运行输出的命令。实际命令包含编码后的项目路径，
因此空格和 Windows 元字符无需手工引用。

保持 Antigravity 启动终端打开。Adapter 声明的 supervisor 会在每次 `agy` 正常退出后等待，
在后续审查反馈到来时重新激活它，但 supervisor 本身不认领 Bus 消息。
使用 Ctrl+C 或已处理的 `STOP` 消息结束；脚本可用 `--once` 只激活一次。

`quickstart` 新增项目本地 `.agent-bus/` 目录，并通过 `.git/info/exclude` 排除该目录；
Bus 消息不会进入提交。在 Antigravity 实现已批准规格之前，项目源码树不会改变。

<div id="_3-complete-one-lifecycle" class="doc-anchor" aria-hidden="true"></div>

## 3. 完成一次生命周期

1. 告诉 Codex 可观察行为、约束与验收标准。
2. Codex 编写规格并发送 `IMPLEMENT`。
3. Antigravity 认领消息、修改产品代码、运行测试、提交，然后发送包含提交 ID 和证据的 `IMPLEMENTATION_DONE`。
4. Codex 检查真实提交并重跑相关检查，发送 `REVIEW_APPROVED` 或 `CHANGES_REQUESTED`。
5. Antigravity 修复要求的改动，再次交接证据。
6. 用户通过 `RELEASE_APPROVED` 批准明确的发布计划之前，发布始终被阻止。

仓库中的确定性演示不使用真实模型，也能证明完整生命周期：

```console
$ npm run demo
[CODEX] Clarify requirement and submit implementation specification
[ANTIGRAVITY] Claim message, implement, test, and commit
validation: node --test PASS
[CODEX] Claim result and review real commit plus validation evidence
review: APPROVED
[RESULT] IMPLEMENTED -> TESTED -> COMMITTED -> REVIEW_APPROVED
tests: PASS
bus: PASS
```

<div id="success-and-failure-signals" class="doc-anchor" aria-hidden="true"></div>

## 成功与失败信号

成功需要观察到所有条件：仅 Antigravity 修改产品文件；实现提交真实存在；测试通过；
Codex 审查了该确切提交；两个收件箱均没有异常的 `processing` 认领；没有把审查批准推断为发布许可。

若两个终端显示相同角色、两个代理都尝试写入 Git、工作进程退出后消息仍停留在 `processing`、
证据引用不存在的提交、测试失败，或两个终端使用不同的项目根目录，应停止并诊断。
参阅[故障排查](./troubleshooting.html)、[角色对比](./comparison.html)和[协议（英文）](../protocol.html)。
