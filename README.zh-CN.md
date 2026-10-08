# Coordinate Agents

[English](./README.md) · [文档](./docs/zh-CN/index.md) · [安全说明](./SECURITY.md)

Coordinate Agents 是面向 Codex + Antigravity 协作的本地 Web Workspace。
**npm 3.0.0 是 Web-first 分发版本**：独立运行的轻量工作台，保留双终端、
项目与任务持久化，以及轻量角色提示词。

```sh
npx @hogancv/coordinate-agents@latest web
# 指定目录和端口（0 表示自动分配空闲端口）：
npx @hogancv/coordinate-agents@3.0.0 web --root "/path/to/project" --port 3000
```

先安装 Node.js >=18、Git、Codex 和 Antigravity CLI，并分别登录代理 CLI。
打开输出的 localhost 地址，在终端设置中配置 `agy-proxy` 等自定义命令、
Codex 模型及推理强度。创建任务后，在 Codex 终端输入需求；Codex 通过
`workspace-message` 向该任务的 Antigravity 派发实现要求，收到回复后审查并汇报。
多项目、原始终端输入输出、尺寸调整、关闭/重启、刷新和独立 Session Host 重连均保留。

原有 PTY 平台策略保持不变：Node 18 和 Windows Node >=22 使用受管 stdio
回退后端，支持的原生组合使用 node-pty。回退后端保留会话输入输出与生命周期，
但可能无法运行代理完整交互 TUI。继续支持 Node 18；如果所用 CLI 必须使用原生
终端，应选择相应的较新 Node 环境。

**GitHub 中完整的 Plugin / Legacy CLI / MCP / Task Graph 源码仍然保留**，包括原有本地优先协作协议和运行时。
结构化协作使用 GitHub Plugin；其版本独立管理，目前仍为 2.4.0。
npm 3.x 不再携带插件 manifest、Skill 资源、MCP、Task Graph、Adapter SDK、
conformance kit、示例、测试及开发脚本。tarball 的 `skills/` 路径只保留必要共享
`.mjs` 模块，并不分发 Codex Skill。打包无需构建或 prepack 步骤。

## 两种协作模式

| 模式 | 执行方式与保障 |
| --- | --- |
| Web Workspace | 全新双 PTY、轻量角色提示词、任务绑定的终端通信。在 Codex 中输入需求，由 Antigravity 实现；不自动调用 skill 或运行 Task/Graph 生命周期。 |
| 结构化 Skill / CLI / MCP | Agent Bus 消息、持久 Task 与 Task Graph、实现证据、审查记录和显式恢复。 |

Web 任务组状态表示终端生命周期，**不代表实现或审查完成**。角色提示词是行为约定，不是强制执行的工作流状态机。Web 提示词要求未经用户授权不得提交、推送或发布；结构化模式继续遵守原有审查与发布授权流程。

![完整端到端终端演示](https://raw.githubusercontent.com/hogancv/coordinate-agents/main/assets/demo.gif)

该动图由 `npm run demo` 在隔离 Git 仓库中生成；脱敏后的原始记录见 [assets/demo-transcript.txt](./assets/demo-transcript.txt)。

## 为什么使用 Coordinate Agents

一个优秀的编码代理可以独立工作。当你希望第二个代理负责实现，同时让 Codex 清晰地维护规格与审查边界时，协作层才真正有价值。

- Codex 澄清任务、记录验收标准、派发工作并审查证据。
- 已配置的 Implementer CLI 在受管 Execution Session 中修改代码并运行测试。
- Agent Bus 在本地持久化任务、消息、审查、Session 和恢复事实。
- 发布操作与实现流程严格分离，必须由用户单独明确授权。

## 结构化流程的工作原理

```text
你
 |
 v
Codex：澄清 -> 定义规格 -> 派发 --------------------------+
 |                                                        |
 v                                                        |
本地 Agent Bus -> 已配置适配器 -> Implementer CLI          |
 ^                                      |                 |
 |                                      v                 |
 +----------- 持久化结果与证据 ---------------------------+
 |
 v
Codex：审查 -> 批准变更或请求返工
```

Runtime 只管理自己创建的 Session。健康 Session 可在审查返工时复用；失败或退出的 Session 必须经过新的显式派发。完整任务、消息和 Session 契约见[协议文档](./docs/protocol.md)。

## 快速开始

从规范 GitHub Marketplace 安装插件：

```sh
codex plugin marketplace add hogancv/coordinate-agents
codex plugin add coordinate-agents@coordinate-agents
```

然后在 Codex App 中打开一个 Git 仓库，并从以下任一提示词开始：

```text
使用 $coordinate-agents 检查这个仓库，并说明当前可用的协作配置。
```

```text
使用 $coordinate-agents，把我已安装的 Antigravity 或其他编码代理 CLI 配置为 Implementer。
```

```text
使用 $coordinate-agents 实现这个任务。先澄清验收标准，再派发实现，最后审查结果：<任务>
```

插件路径不要求全局安装 npm 包。环境要求、验证、升级和卸载步骤见[快速入门](./docs/getting-started.md)、[让 AI 安装](./docs/install-with-ai.md)与[插件端到端指南](./docs/plugin-e2e.md)。

## 示例

例如你提出：

```text
使用 $coordinate-agents 修复偶发失败的缓存失效测试。保持公共 API 不变，增加回归测试，不要执行任何发布操作。
```

Codex 会把要求转成持久任务，选择已配置的 Implementer 适配器，创建或复用受管 Execution Session，等待实现证据，并审查 diff 与测试。审查失败会通过同一任务返回具体问题；审查通过也不代表获得发布授权。

## 核心能力

- 持久化本地任务、消息、审查结论和运行时事件。
- 在任何执行副作用之前校验显式 DAG 与可选 Intent Map v1 写入范围，并支持带有界风险和资源估算的确定性冲突感知 Graph Preflight、显式有界多波次 advance、执行后范围审计、跨隔离 worktree/Session 的并行执行与基于事实的恢复。
- 明确区分 Planner、Implementer 与 Reviewer 角色。
- 通过适配器精确执行已配置的 CLI 命令。
- 提供持久、有限输出且可检查的 Execution Session。
- 审查返工时复用健康上下文，同时避免无限重试。
- 使用规范本地事实恢复中断的图执行，显式 resume、有限 stop 与所有权安全 cleanup；不从文件名/描述推断成功，也不自动重试。
- 通过本地 Inspector 查看任务、Session 与事件时间线。
- 严格区分审查门禁和发布门禁。
- 所有必需子任务成功后，可在独立 Runtime-owned 聚合 worktree 中按确定性顺序执行 graph-integrate，再通过 graph-review 记录 REVIEW_APPROVED 或 CHANGES_REQUESTED；来源事实过期或聚合 worktree 有未提交改动时拒绝审查，冲突可检查且不会修改用户 checkout。

创建图时可通过 CLI 的 `--intent-map <intent-map.json>` 或 MCP 的 `intentMap`
对象附加写入意图。配套映射必须恰好覆盖每个子任务一次，默认采用
`scopePolicy: "warn"`，并持久化标准化的仓库相对模式。status、inspect 与 plan
会区分旧图的“覆盖不可用”和显式空 `writeIntent`。
存在覆盖信息时，调度器会按稳定子任务 ID 顺序选择不超过 `maxConcurrency` 的
非冲突波次，对保守相交的写入模式返回有界 `WRITE_INTENT_CONFLICT` 事实并延后执行。
实现完成并通过提交证据校验后，Runtime 会在解锁依赖项之前，将基线到实现提交的
变更以及仍未提交的 worktree 变更与声明范围比较。`observe` 仅记录偏移，`warn`
在保持成功的同时显示 `INTENT_SCOPE_DRIFT` 警告，`strict` 则保留实现提交和
worktree 并记录可恢复失败。该审计不会创建依赖边，也不会修改用户 checkout。

## 支持的代理与适配器

内置参考工作流由 Codex 担任 Planner 和 Reviewer。Implementer 通过适配器选择：

| 适配器 | 适用场景 |
| --- | --- |
| `antigravity-cli` | Google Antigravity CLI，包括 `agy-proxy` 等精确自定义可执行文件 |
| `codex-cli` | 明确配置为外部 Runtime 的 Codex CLI |
| `generic-cli` | 其他交互式编码 CLI，例如本地配置的 Claude 命令 |

项目命令配置优先于用户配置，用户配置优先于适配器默认值。Runtime 不会猜测最终可执行文件名称。详见 [Codex CLI](./docs/codex-cli.md)、[Antigravity CLI](./docs/antigravity-cli.md)和[方案对比](./docs/comparison.md)。

### Adapter Contract v1

GitHub 源码/Plugin 与 **npm 2.4.0** 通过 `adapter-sdk.mjs` 提供带版本的验证边界；npm 2.x 使用者从 `@hogancv/coordinate-agents/adapter-sdk.mjs` 导入。npm 3.x 移除了 SDK 导出和 conformance 资源。Contract v1 约束适配器身份、能力、检测、配置兼容性、参数数组形式的启动计划、持久 Session 首次输入与启动策略。可执行文件和路径验证、进程与 Session 生命周期、有限输出、持久化状态、审查及发布门禁仍完全由 Runtime 管理。

公开的 [Adapter Conformance Kit](./docs/adapter-conformance.md) 会在隔离临时根目录中的确定性 fake executable 上运行同一套 Contract v1 检查，覆盖包含空格和 shell 元字符的路径，并返回有界、适合 CI 的诊断；它不会连接 Provider，也不会修改用户配置。本地模块只能通过 `coordinate-agents adapter register <local-file>` 显式注册；Runtime 只加载选中的正规 `.mjs`、`.js` 或 `.cjs` 文件，descriptor/配置失败时不会改变用户配置或项目状态。模块属于在当前 Node.js 权限下运行的可信代码，契约验证不是针对恶意 JavaScript 的沙箱。详见随包提供的 [Adapter Contract v1 参考](./skills/coordinate-agents/references/adapter-contract-v1.md)。

内置的 Codex CLI、Antigravity CLI 和 generic CLI 适配器现在都通过经过验证的 Contract v1 descriptor 创建，并运行同一套 conformance runner。Runtime 的 Session 决策使用冻结的 descriptor capabilities，同时保留旧版适配器 metadata 方法的兼容性。

面向第三方作者的[外部 Adapter 作者指南](./docs/adapter-author-guide.md)说明了公共导入、Contract v1 方法、离线 fixture、显式 trusted-local 注册和包内容校验。完整的[最小外部 Adapter 示例](./examples/minimal-external-adapter/README.md)位于内置 registry 之外，不需要访问 Provider。

仓库的 [Adapter SDK 验收门禁](./docs/adapter-conformance.md#repository-acceptance-gate)只在包版本变化时自动运行精简跨平台矩阵；标签和显式手动触发仍可用于发布与维护校验。门禁会让内置与外部 descriptor 通过同一套 kit，并覆盖 Linux 上的 Node.js 18 以及 Windows、macOS、Linux 上的 Node.js 22；Task、Bus、Event Journal、Inspector、MCP、审查和发布权责保持不变。

Setup discovery 以及现有 MCP setup/Task 工具会暴露同一个、向后兼容的
`adapters` registry snapshot，其中包含已注册外部适配器的身份和 Contract
能力。Discovery 不会启动适配器；已配置的外部 Agent 只会提供其 Contract
定义的检测事实。Setup 可以选择外部适配器，同时保持 Agent、Adapter 与可执行文件
身份分离；canonical Task/持久 Session 路径继续遵守项目命令 > 用户命令 >
适配器默认值的精确优先级。

## Web Workspace 与本地 Inspector

**Web Workspace** 是主要的本地浏览器入口。在文件夹中即可启动一个仅回环的
多项目双终端工作台 —— 无需 Codex Plugin 或全局安装
（代理 CLI 仍使用各自配置的模型服务）：

```sh
npx @hogancv/coordinate-agents@latest web --port 3000
```

Workspace 支持 `zh-CN` / `en-US` 双语，左侧按“项目 → 任务”分组。
启动目录自动登记为项目，Git 子目录归并到仓库根目录；普通启动目录自动初始化。
“新增项目”支持浏览本地文件夹，普通目录需确认初始化 Git 和 Workspace 存储，不创建提交。
切换项目不会关闭后台终端；终端设置与“关闭所有终端”仅作用于当前项目。
右键对话记录或项目标题可直接归档；归档会关闭对应终端并隐藏记录，保留项目源码。设置中可一键永久清除所有登记项目的已归档对话。归档项目刷新和重启后仍隐藏；重新添加同一文件夹可恢复项目入口。
点击“新建任务”启动全新的 Codex + Antigravity 双终端并注入 Web-lite 提示词；
需求直接输入 Codex 终端。“终端设置”支持 `agy-proxy` 等自定义启动命令，
以及 Codex 模型和推理强度设置。保留刷新、关闭、重启和关闭所有终端操作。
不再提供 Composer、聊天消息流或 Graph / Agents / Sessions / Activity 页面。

任务组独立保存在 `.agent-bus/workspace-tasks/*.json`，不与标准 Task 混用。
选择与刷新不会启动会话；明确操作通过受保护的 `POST /api/action` 执行。
默认 Web API 不再暴露结构化 Task/Graph 的读写操作。原有 CLI、MCP 和只读 `inspector` 契约仍保留在 GitHub 源码的 Legacy 入口中。
运行本仓库的新 Web 行为请使用 `node bin/coordinate-agents.mjs web --port 3000`；
合入 main 不等于发布新的 npm 版本。详见
[Inspector 与 Web Workspace](./docs/inspector.md)
与 [Event Journal](./docs/event-journal.md)。

## npm 3.0 迁移

npm 公共 CLI 保留 `coordinate-agents web`、`coordinate-agents --help`、
`coordinate-agents --version`，以及 Web 的 `--root`、`--port`、`--json`。
旧版 `install`、`update`、`uninstall`、`doctor`、`quickstart`、`launch`、`setup`、
`discover`、`config`、`adapter`、`agent`、`task`、`status`、`inspector` 不再作为
npm 3.x 命令提供。不支持的命令会明确显示迁移说明，不尝试加载缺失模块。
移除通配内部导出和 `./adapter-sdk` / `./adapter-sdk.mjs`，仅公开 `./package.json`。
Codex 角色提示词会提供绑定当前任务的消息脚本路径。

需要旧 npm CLI 时，请固定版本：

```sh
npx @hogancv/coordinate-agents@2.4.0 --help
npx @hogancv/coordinate-agents@2.4.0 doctor
# GitHub 源码中的完整结构化 CLI：
node bin/coordinate-agents-legacy.mjs --help
node bin/coordinate-agents-legacy.mjs inspector --port 3000
```

Plugin 自动选择自身携带的 Legacy 入口。npm 与 Plugin 的验证和版本分别管理。
参见 [V3 分发与发布验证记录](./docs/releases/v3-web-first.md)。

## 本地开发

默认测试命令运行精简核心测试（约 20–30 秒），覆盖 CLI 分发、Web Workspace、
Inspector、文档、仓库布局、共享 Runtime 契约与 Web 终端消息：

```sh
npm test
```

需要完整本地回归时再显式运行以下命令。它包含较慢的 Task Graph、Session、Plugin
与 MCP 集成守卫，不会被默认命令或跨平台 CI 隐式重复触发：

```sh
npm run test:full
```

`npm run check` 是快速的帮助/索引/核心检查；`npm run check:full` 会额外运行完整本地回归。

## 文档导航

- 开始使用：[AI 安装契约](./AI_INSTALL.md)、[快速入门](./docs/getting-started.md)、[让 AI 安装](./docs/install-with-ai.md)、[常见问题](./docs/faq.md)、[变更记录](./CHANGELOG.md)
- 核心 Runtime：[协议](./docs/protocol.md)、[Execution Session](./docs/session-runtime.md)、[Event Journal](./docs/event-journal.md)、[MCP](./docs/mcp.md)
- Task Graph：[Task Graph v1 契约](./docs/task-graph-v1.md)
- 聚合集成审查输出：[集成 schema](./schemas/task-graph-v1-integrate.schema.json)、[审查 schema](./schemas/task-graph-v1-review.schema.json)
- 运维与安全：[Inspector](./docs/inspector.md)、[故障排查](./docs/troubleshooting.md)、[MCP 故障排查](./docs/MCP_TROUBLESHOOTING.md)、[安全](./docs/security.md)
- 代理与选型：[Codex CLI](./docs/codex-cli.md)、[Antigravity CLI](./docs/antigravity-cli.md)、[方案对比](./docs/comparison.md)
- Adapter 作者：[作者指南](./docs/adapter-author-guide.md)、[最小外部 Adapter 示例](./examples/minimal-external-adapter/README.md)
- 机器可读索引：[llms.txt](./docs/llms.txt)

## 安全与发布边界

`.agent-bus` 是本地明文状态，应始终排除在版本控制之外。不要把凭据、令牌、Cookie、私钥或未脱敏的敏感输出写入任务记录、fixture、日志或提交。Runtime 会拒绝不安全路径，也不会附加到任意进程。

实现完成与 `REVIEW_APPROVED` 都不构成发布授权。Web-lite 提示词要求提交、推送或发布前取得用户授权，但没有技术上强制执行的发布门禁。结构化流程继续要求对 merge、push、tag、publish、deploy、GitHub Release 与发布工作流先说明计划，再获得原样输入的 `RELEASE_APPROVED`。结构化边界见 [SECURITY.md](./SECURITY.md)。

## 项目状态

Coordinate Agents 是本地优先项目，同时维护轻量 Web 与结构化 Plugin / CLI / MCP 模式。GitHub 插件分发结构化技能，`@hogancv/coordinate-agents` 分发独立 Runtime 和 Web 入口。CI 与发布策略见 [AGENTS.md](./AGENTS.md)；npm 发布仍是单独的、手动且必须明确批准的工作流。

## 开发

贡献者设置与必需检查命令见 [AGENTS.md](./AGENTS.md)。每项行为变更都应包含隔离测试，且不得调用真实模型账号或修改用户的真实项目。

## 许可证

[MIT](./LICENSE)
