---
title: 协议与恢复
description: 本地优先的 Agent Bus 如何协调消息、认领、审查、适配器及中断工作。
---

<div id="protocol-and-recovery" class="doc-anchor" aria-hidden="true"></div>

# 协议与恢复

::: tip 结构化工作流（沿用 v2.4 路线）
本参考文档对应保留的 Plugin／源码 Legacy 运行时，可能包含后续修复，并非固定的 v2.4.0 快照。npm 3.x Web 不提供这些结构化 API。

[v2.4.0 原始文档与迁移](./v2.4.html) · [当前 Web 入口](./getting-started.html)
:::

`.agent-bus` 是采用本地优先方式的协调运行时，提供原子消息发布、原子认领、去重键、租约、隔离区、仅追加的智能体状态、幂等完成，以及由 Runtime 管理的 Execution Session 记录。它不需要外部 CAO 服务或数据库。

关键的 Task、Session、审查、恢复和 Bus 生命周期钩子，还会将经过清理的 schema-v1 记录追加到 `.agent-bus/events/runtime.jsonl`。此日志用于提供可观测历史，不是以事件溯源方式替代当前状态。

<div id="architecture" class="doc-anchor" aria-hidden="true"></div>

## 架构

1. **协调层（Coordination Layer）：**将工作流角色（`planner`、`implementer`、`reviewer`）映射到已注册智能体，并强制执行人工发布门禁（`RELEASE_APPROVED`）。
2. **Agent Bus 协议层：**核心消息总线、队列生命周期（`new/`、`processing/`、`processed/`）、租约附属文件、仅追加状态和崩溃恢复。独立于厂商特定的传输方式。
3. **执行层（Execution Layer）：**将 Task 状态与按项目／智能体划定作用域的 `ExecutionSession` 对象分离。Session Manager 复用健康的 Session；PTY Runtime 管理有界交互式 I/O；Session Host 仅管理它自己创建的进程。
4. **适配器与运行时层（Adapters & Runtime Layer）：**将具体执行入口（CLI 可执行程序、桌面包装程序、IPC）与结构化任务连接起来。

适配器也会声明规范化的启动策略。标准 Plugin Task 路径会打开或复用持久化 PTY Session，并在 Task 上保存不拥有会话生命周期的 `sessionId` 引用。收到 `CHANGES_REQUESTED` 后会复用健康的 Session；处于 `exited`／`failed` 状态时只报告事实，不会自动循环重试。旧版 CLI `launch` 路径仍可能使用 `one-shot` 或 `bus-supervised` 兼容行为；它与 Session Manager 是独立路径。

典型工作流：

1. Planner（默认：Codex）发送包含规格说明的 `IMPLEMENT`。
2. Implementer（默认：Antigravity）认领消息、实施、测试、提交，并发送附带证据的 `IMPLEMENTATION_DONE`。
3. Reviewer（默认：Codex）验证提交与证据，再发送 `CHANGES_REQUESTED` 或 `REVIEW_APPROVED`。
4. 用户单独输入 `RELEASE_APPROVED` 之前，发布工作保持阻塞。
5. 对于 Task Graph，Runtime 随后在独立的聚合 worktree 中集成已验证的子任务提交，再让聚合结果通过现有审查者边界；集成与审查绝不会更改当前检出目录，也不会授权发布操作。

消息和状态在终端重启后仍保留。重新调用 Skill 并检查 `status` 以继续工作。只有确认不存在匹配的实施、提交或回复后，才恢复过期认领，因为恢复可能使这项工作重新具备投递资格。

`recover inspect` 只呈现事实；Task 有 `sessionId` 时，还会包含 Session 状态。它不会重启进程、重放输入、附加到任意 PID，也不会控制 Codex App Terminal 界面。Session 输出有界并经过脱敏；配置的可执行程序按精确身份解析，项目配置优先于用户配置。

完整命令与状态约定维护在 [`references/protocol.md`（英文技术参考）](https://github.com/hogancv/coordinate-agents/blob/main/skills/coordinate-agents/references/protocol.md)。
