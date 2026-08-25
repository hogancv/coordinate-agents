# Coordinate Agents

[English](./README.md) · [文档](./docs/zh-CN/index.md) · [安全说明](./SECURITY.md)

Coordinate Agents 是一个面向 Codex 与外部 AI 编码代理的本地优先协作协议和运行时。它为需求澄清、实现、审查、恢复和发布授权建立明确边界，同时让代码仓库及持久化 `.agent-bus` 状态始终由你控制。

推荐通过本 GitHub 仓库安装 Codex 插件。npm 包继续用于 standalone Runtime 和兼容性工作流。

![完整端到端终端演示](./assets/demo.gif)

该动图由 `npm run demo` 在隔离 Git 仓库中生成；脱敏后的原始记录见 [assets/demo-transcript.txt](./assets/demo-transcript.txt)。

## 为什么使用 Coordinate Agents

一个优秀的编码代理可以独立工作。当你希望第二个代理负责实现，同时让 Codex 清晰地维护规格与审查边界时，协作层才真正有价值。

- Codex 澄清任务、记录验收标准、派发工作并审查证据。
- 已配置的 Implementer CLI 在受管 Execution Session 中修改代码并运行测试。
- Agent Bus 在本地持久化任务、消息、审查、Session 和恢复事实。
- 发布操作与实现流程严格分离，必须由用户单独明确授权。

## 工作原理

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
- 明确区分 Planner、Implementer 与 Reviewer 角色。
- 通过适配器精确执行已配置的 CLI 命令。
- 提供持久、有限输出且可检查的 Execution Session。
- 审查返工时复用健康上下文，同时避免无限重试。
- 根据规范本地事实恢复被中断的协作流程。
- 通过本地 Inspector 查看任务、Session 与事件时间线。
- 严格区分审查门禁和发布门禁。

## 支持的代理与适配器

内置参考工作流由 Codex 担任 Planner 和 Reviewer。Implementer 通过适配器选择：

| 适配器 | 适用场景 |
| --- | --- |
| `antigravity-cli` | Google Antigravity CLI，包括 `agy-proxy` 等精确自定义可执行文件 |
| `codex-cli` | 明确配置为外部 Runtime 的 Codex CLI |
| `generic-cli` | 其他交互式编码 CLI，例如本地配置的 Claude 命令 |

项目命令配置优先于用户配置，用户配置优先于适配器默认值。Runtime 不会猜测最终可执行文件名称。详见 [Codex CLI](./docs/codex-cli.md)、[Antigravity CLI](./docs/antigravity-cli.md)和[方案对比](./docs/comparison.md)。

### Adapter Contract v1

npm 包与 Plugin payload 通过 `adapter-sdk.mjs` 提供带版本的验证边界；npm 使用者从 `@hogancv/coordinate-agents/adapter-sdk.mjs` 导入。Contract v1 约束适配器身份、能力、检测、配置兼容性、参数数组形式的启动计划、持久 Session 首次输入与启动策略。可执行文件和路径验证、进程与 Session 生命周期、有限输出、持久化状态、审查及发布门禁仍完全由 Runtime 管理。

公开的 [Adapter Conformance Kit](./docs/adapter-conformance.md) 会在隔离临时根目录中的确定性 fake executable 上运行同一套 Contract v1 检查，覆盖包含空格和 shell 元字符的路径，并返回有界、适合 CI 的诊断；它不会连接 Provider，也不会修改用户配置。本地模块只能通过 `coordinate-agents adapter register <local-file>` 显式注册；Runtime 只加载选中的正规 `.mjs`、`.js` 或 `.cjs` 文件，descriptor/配置失败时不会改变用户配置或项目状态。模块属于在当前 Node.js 权限下运行的可信代码，契约验证不是针对恶意 JavaScript 的沙箱。详见随包提供的 [Adapter Contract v1 参考](./skills/coordinate-agents/references/adapter-contract-v1.md)。

内置的 Codex CLI、Antigravity CLI 和 generic CLI 适配器现在都通过经过验证的 Contract v1 descriptor 创建，并运行同一套 conformance runner。Runtime 的 Session 决策使用冻结的 descriptor capabilities，同时保留旧版适配器 metadata 方法的兼容性。

面向第三方作者的[外部 Adapter 作者指南](./docs/adapter-author-guide.md)说明了公共导入、Contract v1 方法、离线 fixture、显式 trusted-local 注册和包内容校验。完整的[最小外部 Adapter 示例](./examples/minimal-external-adapter/README.md)位于内置 registry 之外，不需要访问 Provider。

仓库的 [Adapter SDK 验收门禁](./docs/adapter-conformance.md#repository-acceptance-gate)会让内置与外部 descriptor 通过同一套 kit，并在 Windows/macOS/Linux × Node.js 18/22 矩阵中运行；Task、Bus、Event Journal、Inspector、MCP、审查和发布权责保持不变。

Setup discovery 以及现有 MCP setup/Task 工具会暴露同一个、向后兼容的
`adapters` registry snapshot，其中包含已注册外部适配器的身份和 Contract
能力。Discovery 不会启动适配器；已配置的外部 Agent 只会提供其 Contract
定义的检测事实。Setup 可以选择外部适配器，同时保持 Agent、Adapter 与可执行文件
身份分离；canonical Task/持久 Session 路径继续遵守项目命令 > 用户命令 >
适配器默认值的精确优先级。

## 本地 Inspector

在已初始化 Agent Bus 的仓库中启动只读本地 Inspector：

```sh
npx @hogancv/coordinate-agents@latest inspector --port 3000
```

它展示任务、Session 与 Event Journal 时间线，但浏览器页面不是事实源。详见 [Inspector](./docs/inspector.md)与 [Event Journal](./docs/event-journal.md)。

## Standalone npm Runtime

兼容性 npm 包提供 installer、doctor、quickstart、task、agent、session、MCP 和 Inspector 命令：

```sh
npx @hogancv/coordinate-agents@latest --help
```

该路径适用于旧版 standalone Skill 安装、外部自动化或协议调试。完整命令工作流见[快速入门](./docs/getting-started.md)与 [MCP 集成](./docs/mcp.md)。

## 文档导航

- 开始使用：[AI 安装契约](./AI_INSTALL.md)、[快速入门](./docs/getting-started.md)、[让 AI 安装](./docs/install-with-ai.md)、[常见问题](./docs/faq.md)
- 核心 Runtime：[协议](./docs/protocol.md)、[Execution Session](./docs/session-runtime.md)、[Event Journal](./docs/event-journal.md)、[MCP](./docs/mcp.md)
- 运维与安全：[Inspector](./docs/inspector.md)、[故障排查](./docs/troubleshooting.md)、[MCP 故障排查](./docs/MCP_TROUBLESHOOTING.md)、[安全](./docs/security.md)
- 代理与选型：[Codex CLI](./docs/codex-cli.md)、[Antigravity CLI](./docs/antigravity-cli.md)、[方案对比](./docs/comparison.md)
- Adapter 作者：[作者指南](./docs/adapter-author-guide.md)、[最小外部 Adapter 示例](./examples/minimal-external-adapter/README.md)
- 机器可读索引：[llms.txt](./docs/llms.txt)

## 安全与发布边界

`.agent-bus` 是本地明文状态，应始终排除在版本控制之外。不要把凭据、令牌、Cookie、私钥或未脱敏的敏感输出写入任务记录、fixture、日志或提交。Runtime 会拒绝不安全路径，也不会附加到任意进程。

实现完成与 `REVIEW_APPROVED` 都不构成发布授权。merge、push、tag、publish、deploy、创建 GitHub Release 或运行发布工作流，都必须先说明具体计划，再获得用户原样输入的 `RELEASE_APPROVED`。完整边界见 [SECURITY.md](./SECURITY.md)。

## 项目状态

Coordinate Agents 以插件优先、本地优先的方式维护。GitHub 插件是主要分发渠道，`@hogancv/coordinate-agents` 是兼容性分发渠道。CI 与发布策略见 [AGENTS.md](./AGENTS.md)；npm 发布仍是手动且必须获得明确批准的工作流。

## 开发

贡献者设置与必需检查命令见 [AGENTS.md](./AGENTS.md)。每项行为变更都应包含隔离测试，且不得调用真实模型账号或修改用户的真实项目。

## 许可证

[MIT](./LICENSE)
