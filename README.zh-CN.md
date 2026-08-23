# Coordinate Agents

[English](./README.md) · [文档](./docs/zh-CN/index.md) · [安全说明](./SECURITY.md)

Coordinate Agents 是一个面向 Codex 与外部 AI 编码代理的本地优先协作协议和运行时。它为需求澄清、实现、审查、恢复和发布授权建立明确边界，同时让代码仓库及持久化 `.agent-bus` 状态始终由你控制。

推荐通过本 GitHub 仓库安装 Codex 插件。npm 包继续用于 standalone Runtime 和兼容性工作流。

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
