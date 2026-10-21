---
title: 执行会话与 PTY 运行时
description: 持久化、按项目划定作用域的编程智能体会话，以及有界 PTY I/O、复用、恢复和安全边界。
---

<div id="execution-session-and-pty-runtime" class="doc-anchor" aria-hidden="true"></div>

# 执行会话与 PTY 运行时

::: tip 结构化工作流（沿用 v2.4 路线）
本参考文档对应保留的 Plugin／源码 Legacy 运行时，可能包含后续修复，并非固定的 v2.4.0 快照。npm 3.x Web 不提供这些结构化 API。

[v2.4.0 原始文档与迁移](./v2.4.html) · [当前 Web 入口](./getting-started.html)
:::

Web 工作台和结构化 Plugin 共享 Session Host 与 PTY 基础设施。Web 创建绑定到任务的全新终端对（自定义模式还会绑定各终端槽位）；刷新会重新连接，而明确重启会创建新 Session。下文关于健康 Session 复用和 Task／Graph 工具的约定，描述的是独立的结构化工作流。Web 行为请参阅[工作台指南](./inspector.html)。

Plugin Task API 使用独立的 `Execution Session` 来承载长期运行的编程智能体进程。Task 保存不拥有会话生命周期的 `sessionId` 引用；Session Manager 管理生命周期，PTY Runtime 管理有界交互式 I/O。Task Graph Session 还会持久化 `taskId` 和 `subtaskId`，其 Session 事件同时携带这两个关联，因此并行 worktree 的本地日志不会被错误归属到其他同级子任务。

```text
Task --sessionId--> Session Manager --owns--> PTY Session Host --owns--> Implementer CLI
```

Session 按规范化仓库根目录、智能体身份和生效的可执行程序划定作用域。健康且匹配的 Session 可跨 Task 派发和审查返工复用。Task 不会仅因为审查轮次改变，就重启或关闭它的 Session。

<div id="lifecycle-and-tools" class="doc-anchor" aria-hidden="true"></div>

## 生命周期与工具

```text
starting -> running <-> busy -> idle
                 \-> exited | failed
```

Plugin 提供六个有界 MCP 工具：

| 工具 | 用途 |
| --- | --- |
| `coordinate_agents_session_open` | 解析配置的可执行程序，启动或复用 Session。 |
| `coordinate_agents_session_status` | 读取状态、根目录、命令、时间戳、PID 和退出事实。 |
| `coordinate_agents_session_inspect` | 只读状态，加上有界、经过脱敏的近期输出。 |
| `coordinate_agents_session_write` | 向所管理的进程发送结构化输入，不进行 shell 解析。 |
| `coordinate_agents_session_read` | 使用游标读取有界缓冲输出。 |
| `coordinate_agents_session_close` | 先优雅中断，再在有界期限内关闭所管理的进程。 |

`resize` 和 `interrupt` 是供适配器及诊断使用的内部 Runtime 操作，不提供桌面界面自动化。

<div id="task-and-review-loop" class="doc-anchor" aria-hidden="true"></div>

## Task 与审查循环

`task dispatch` 验证最终可执行程序，发送 `IMPLEMENT`，并打开或复用 Session。如果适配器未将首次规格说明作为启动参数消费，Runtime 会将其写入 PTY。一个短暂宽限期用于捕获立即完成的证据；否则 Task 保持 `WAITING_IMPLEMENTER`，Session 仍可检查。

收到 `CHANGES_REQUESTED` 后，下一次明确派发会将新反馈写入同一个健康 Session。Session 为 `exited` 或 `failed` 时，Runtime 会报告该事实；替换会话需要经过正常的明确派发路径，绝不会无限重试。`recover inspect` 只呈现事实，不会重启、重放输入、恢复 Task，也不会附加到任意 PID。

执行 Task Graph 时，`task graph-status`／`graph-inspect` 会展示相同的 Session 事实，以及父 Task、子任务、智能体、worktree 和已验证的完成证据。Session Host 不再健康时，`graph-recover` 会记录子任务中断，绝不会把文件名或自然语言消息当作证明。`graph-resume` 只复用经过验证、健康且根目录与 Runtime 管理的 worktree 匹配的 Session；已退出／失败的 Session 对应子任务会回到 `READY`，等待明确派发替代会话。`graph-stop` 和 `graph-cleanup` 仅在有界超时内关闭 Runtime 管理的 Graph Session；清理失败时会保留用户的 worktree、分支、引用、提交和证据。

<div id="executable-and-platform-rules" class="doc-anchor" aria-hidden="true"></div>

## 可执行程序与平台规则

解析采用精确匹配，失败时拒绝继续（fail-closed）：

```text
explicit project command > user command > Adapter default
```

智能体身份不等于可执行程序身份。将 `antigravity` 配置为 `agy-proxy` 时，启动的是 `agy-proxy`，绝不会猜测并启动 `agy`。参数以数组传递，因此带空格的 Windows 路径、`.cmd` 包装程序、PowerShell 入口、Unicode 和 ANSI 输出无需拼装 shell 字符串即可处理。

优先使用 `node-pty`。直接使用 Plugin 检出目录而未安装包依赖，或原生 PTY 无法初始化的平台／Node 组合，可以通过有界 stdio 管道使用同一套受运行时管理的 Session 协议，作为降级兼容后端。两种模式下，Session Host 都只能中断或终止自己创建的进程。元数据不包含环境变量，输出有界且经过脱敏，根目录经过验证，Runtime 绝不会控制 Codex App Terminal 界面。
