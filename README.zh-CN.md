# Coordinate Agents

[English](./README.md) · [文档](./docs/zh-CN/index.md) · [安全说明](./SECURITY.md)

Coordinate Agents 是面向 Codex + Antigravity 协作的本地 Web Workspace。
**npm 3.0.1 是 Web-first 分发版本**：独立运行的轻量工作台，保留双终端、
项目与任务持久化，以及轻量角色提示词。

```sh
npx @hogancv/coordinate-agents@latest web
# 指定目录和端口（0 表示自动分配空闲端口）：
npx @hogancv/coordinate-agents@3.0.1 web --root "/path/to/project" --port 3000
```

先安装 Node.js >=18、Git、Codex 和 Antigravity CLI，并分别登录代理 CLI。
打开输出的 localhost 地址，在终端设置中配置 `agy-proxy` 等自定义命令、
Codex 模型及推理强度。创建任务后，在 Codex 终端输入需求；Codex 通过
`workspace-message` 向该任务的 Antigravity 派发实现要求，收到回复后审查并汇报。
多项目、原始终端输入输出、尺寸调整、关闭/重启、刷新和独立 Session Host 重连均保留。

Node 18 继续使用受管 stdio 回退后端。Windows Node >=20 在 npm 3.0.1 中先通过
一次性独立 Session Host 验证原生 PTY 启动和真实 TTY，再选择 node-pty。
预检失败或超时，仅在确认本次进程清理后才使用 stdio 回退；实际 Session 失败
不会自动重试 Agent 任务。会话诊断包含 `backend` 字段。回退保留有界输入输出
和生命周期，但不是真实终端，不能提供原生 TUI 或子进程可感知的 resize。

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

每次发送 Diff 审查反馈前，都必须确认 Codex 停在空白输入框。发送成功后会清除该确认；修改已发送的反馈后，必须重新确认才能再次发送。预检期间切换文件、刷新 Diff 或关闭变更抽屉，会在终端输入发出前取消待发送的反馈。

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

仓库的 [Adapter SDK 验收门禁](./docs/adapter-conformance.md#repository-acceptance-gate)在独立 Legacy Plugin CI 中运行：Plugin、旧 CLI 或共享 Adapter/Session 源码变化时自动触发，也支持显式手动触发。仅修改 Web npm 包版本不会运行旧插件矩阵。兼容矩阵覆盖 Linux Node.js 18/22，以及 macOS/Windows Node.js 22。Web CI 与真实 tarball 隔离安装验收分别负责 Web 回归和 npm 分发验证，详见 [CI 覆盖与成本说明](./docs/releases/v3-ci.md)。

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
**协作时间线** 默认折叠在 Default Collaboration 双终端上方。展开后可按时间查看已持久化的 SENT、WORKING、DONE、REVIEWING、CHANGES_REQUESTED、APPROVED、FAILED，包括时间、来源 Agent、roundId、状态变化及已脱敏的简短回执；支持当前轮次、全部轮次和指定历史轮次筛选。刷新页面、重启 Workspace 或重启双终端后保留历史，此前版本未记录的历史不会补造。SENT 仅表示输入已派发，其余状态是 Agent 正式回执，不代表系统独立验证。时间线不会派发、重试或审查任务，在 Custom Terminals 与 Zen Mode 中隐藏。清理已归档任务会同时删除其时间线。

点击“新建任务”先打开模式选择窗口。默认协作模式启动全新的 Codex + Antigravity 双终端，原有 Web-lite 角色提示词与协作流程保持不变；
需求直接输入 Codex 终端。“终端设置”支持 `agy-proxy` 等自定义启动命令，
以及 Codex 模型和推理强度设置。保留刷新、关闭、重启和关闭所有终端操作。
拖动终端间的分隔线可调整宽度（25%–75%），双击恢复 50:50，刷新后保留比例。标题栏的聚焦按钮可放大单个终端，不重启会话；还原时恢复原分屏比例，旁边的切换按钮可聚焦另一终端。这些控件也可在禅模式中使用，小屏幕仍采用上下布局。
侧边栏搜索按任务标题和项目名称实时过滤已加载或缓存的任务，并保留项目分组；尚未加载任务的项目会明确提示。清空搜索或按 Escape 可恢复原来的项目展开状态。
不再提供 Composer、聊天消息流或 Graph / Agents / Sessions / Activity 页面。

任务组独立保存在 `.agent-bus/workspace-tasks/*.json`，不与标准 Task 混用。
选择与刷新不会启动会话；明确操作通过受保护的 `POST /api/action` 执行。
默认 Web API 不再暴露结构化 Task/Graph 的读写操作。原有 CLI、MCP 和只读 `inspector` 契约仍保留在 GitHub 源码的 Legacy 入口中。
运行本仓库的新 Web 行为请使用 `node bin/coordinate-agents.mjs web --port 3000`；
合入 main 不等于发布新的 npm 版本。详见
[Inspector 与 Web Workspace](./docs/inspector.md)
与 [Event Journal](./docs/event-journal.md)。

### 自定义双终端

预检期间关闭 Prompt 预览会取消待发送操作；已经派发的终端输入无法撤回。创建窗口打开时保存自定义默认配置，仅同步未编辑过的命令框，不覆盖临时命令。选中 Custom 任务时，健康检查检测该任务快照中的两个命令，不再要求安装 Codex / Antigravity；未选中 Custom 任务时保留默认检查。

选择 Custom 后使用独立的 Terminal 1 / Terminal 2 槽位，通过原有 Generic CLI、安全 executable 检查和 PTY Host 启动两个真实 Session。命令只能是可执行文件名或绝对路径（支持路径中的空格），不能包含参数或 Shell 语法；两个命令允许相同。保留 Codex 的 Windows 安全入口和 agy 的交互启动要求，但不据此分配默认协作角色。

终端设置中有独立的 **自定义终端默认配置**：两个命令、可选项目共享 Prompt（UTF-8 最多 8KB）以及两个终端 Prompt（各 4KB）。配置使用明确 Schema 原子写入当前项目的 `.agent-bus/workspace-custom.json`，不修改默认 Agent 设置。新建任务保存快照，可临时覆盖命令；后续项目配置修改不会影响已有任务，重启同样使用旧快照。

Custom 不注入内置角色、不启动合作 roundId，也不启用 Diff 审查反馈的“发送给 Codex”。仍可查看和复制 Diff。每个终端的 **项目 Prompt** 按钮提供合成预览（共享 Prompt + `---` + 当前终端 Prompt）、复制与显式发送。发送前必须确认 CLI 已就绪并支持多行括号粘贴；发送预留键盘输入队列，通过一次原始 Session Write 完成粘贴与一次 Enter。网络结果不确定时不会自动重发或重启。刷新、关闭、重启和归档均验证当前 Task / Slot / Session 的归属，不从全局 Session 中寻找替代终端。

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

### 桌面通知（Windows 10/11 和 macOS）

工作区设置分为 **默认协作**、**自定义终端**、**桌面通知** 三个 Tab，各页独立保存，
保存后窗口保持打开，切换 Tab 保留未保存的输入。底部操作栏常驻，显示「关闭」和
当前 Tab 的保存按钮；仅中间内容区域滚动。
归档清理折叠在默认协作页中。

在 **工作区设置 → 桌面通知** 中启用并保存当前项目的通知设置。总开关默认关闭；
启用后默认通知 APPROVED（审查通过）和 FAILED（执行失败），DONE（实现完成、等待审查）
可单独开启。点击 **发送测试通知** 使用固定模板，不创建 Task，不修改协作回执。
「通知命令已接受」不代表系统已经展示；请同时检查通知权限、专注模式或勿扰模式。

只有 Default Collaboration 中通过校验、成功持久化的正式回执会触发通知。
关闭网页后仍可通知：`workspace-message report` 直接在 Node 侧派发，不依赖网页、
浏览器权限、SSE 或轮询。后端、Agent 和操作系统交互登录会话需要继续运行；关闭这些
进程后不保证通知。Custom 终端输出、idle、退出、Task 关闭、重启和归档都不算完成。

Windows 使用系统自带的 Windows PowerShell 5.1 和 WinRT Toast。首次启用派发或测试时，
按[微软桌面 Toast 身份要求](https://learn.microsoft.com/en-us/windows/win32/shell/enable-desktop-toast-with-appusermodelid)
创建当前用户的「Coordinate Agents Notifications」开始菜单快捷方式，设置稳定的
`CoordinateAgents.Workspace` AppUserModelID，之后重复使用。不修改注册表、不要求管理员
权限、不安装第三方模块或常驻服务。macOS 使用 `/usr/bin/osascript` 固定脚本与独立文本
参数，发送者权限由系统控制。Linux 返回不支持，不影响任务或配置。

设置原子保存在 `.agent-bus/workspace-notifications.json`，下次回执立即读取。
`.agent-bus/notifications/` 中的持久去重记录按项目、Task、roundId 和状态的哈希，
先标记、后调用系统；采用尽力而为、至多派发一次语义，失败不重试，标记后进程崩溃
允许丢失该次通知。修改 summary 不重发，新一轮 roundId 可再次通知。
通知只显示经过清理和截断的项目名、任务标题及状态，不包含 Prompt、输出、摘要或绝对路径。

去重表最多保存 4096 个事件；满额时仅清理对应 Task 记录已删除的条目。如果对应 Task
仍然存在，停止新派发并记录容量诊断，避免遗忘旧记录后重复通知。清理归档会话可回收
已删除 Task 的容量。仅保留一条有限诊断，不保存系统 stderr。配置或路径异常会停止
派发，绝不影响正式回执；系统命令超时上限 10 秒，report 返回结构保持兼容。

真实展示仍需在 Windows 10、Windows 11、macOS 人工验收：点击测试通知、完成一次默认
协作、检查启用事件和 APPROVED 不重复，再关闭网页、保持后端与 Agent 运行后测试新一轮。
自动化测试模拟系统通知命令，不能证明桌面实际展示成功。
