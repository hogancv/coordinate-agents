---
title: 安全
description: Web Workspace 的本机回环访问、受信任智能体权限、本地明文数据，以及独立的结构化运行时和安装器边界。
---

<div id="security" class="doc-anchor" aria-hidden="true"></div>

# 安全

## Web Workspace

Web 服务器仅监听本机回环地址，防护包括以每次启动为范围的能力令牌检查、Host/Origin 验证、请求体大小限制和操作白名单检查。能力令牌不等同于多用户身份验证。

::: warning 访问边界
没有独立的安全边界时，不要通过代理或隧道暴露此服务。
:::

智能体可执行文件及其包装程序是受信任的本地程序，拥有其配置的权限。HTTP 项目绑定不会为智能体的 shell 提供沙箱，也不会阻止文件系统修改。CLI 登录与模型提供方配置仍然彼此独立；本地协作不代表模型推理离线进行，也不代表凭据隔离。

每个 Web 任务都使用所属项目的工作目录。新建终端对不会创建隔离的 worktree。角色提示要求在 commit、push 和 release 前获得用户授权，但并不提供技术层面强制执行的发布门禁。正式的 DONE/APPROVED 回执是智能体的报告，并非独立验证。

关闭浏览器或停止 Web 服务器不等于关闭终端。请使用明确的关闭控件停止所属智能体 Session。归档会关闭终端并隐藏历史记录，同时保留源文件；清除已归档对话则会永久删除其存储的任务和时间线历史。

项目/任务记录、提示快照、时间线页面、Session 数据和项目注册表均以本地明文存储。Git 排除规则不等于加密。智能体提供方可能根据各自配置接收提示和代码。通知文本不包含提示、终端输出、回执摘要或绝对路径，但操作系统的显示策略及其他本地进程不受 Workspace 控制。

分享诊断信息前，请先检查并脱敏。存储路径和生命周期详情见 [Workspace 指南](./inspector.html)。

<div id="shared-session-runtime-and-structured-workflow" class="doc-anchor" aria-hidden="true"></div>

## 共享 Session Runtime 与结构化工作流

下文关于 Task、Task Graph、Agent Bus、适配器和安装器的保证，适用于各自的源码/Plugin 或 Legacy API，不能从 Web 任务回执中推定这些保证。入口见[结构化工作流](./structured-workflow.html)。

::: warning 本地明文工作数据
`.agent-bus` 是**本地明文工作数据**，包括 `.agent-bus/events/` 下仅追加写入的 Event Journal。它未经加密，不得包含令牌、Cookie、密码、私钥或不必要的生产数据。
:::

Execution Session 元数据有大小限制，且不包含环境变量。Session 端点根据已验证的仓库根目录和 Session ID 派生；输入是结构化文本，而非 shell 字符串；Session Host 只能中断或终止自己创建的进程。Runtime 不会附加到任意 PID，也不会自动操作 Codex App Terminal 界面。当直接使用的 Plugin 源码检出目录未安装包依赖时，首选的 `node-pty` 后端可以使用受限的 owned-stdio 兼容后端。

Task Graph v1 验证是只读操作，发生在 Git 发现、Bus 交接、Adapter 解析、worktree 或 Session 创建以及子进程启动之前。无效 DAG 会返回有界的 `TASK_GRAPH_INVALID` Runtime 错误，不会初始化 `.agent-bus`，也不会持久化图状态。独立的 graph-create 操作只会持久化已验证的图记录及其仅追加写入的生命周期事件；它不会启动 Adapter、Session 或 Implementer 进程。

可选的 Intent Map v1 配套数据会在此边界之前进行大小限制和规范化。未知、缺失或重复的子任务覆盖；重复模式；绝对路径、驱动器相对路径、越界路径或包含控制字符的路径；不支持的策略；以及相互矛盾的持久化映射事实，都会以拒绝执行的方式处理。写入意图模式是结构化数据，绝不会通过 shell 求值。

图规划会报告确定性的依赖关系、容量，以及配置中确切的 Agent/Adapter/可执行文件事实，而不会创建 worktree、Bus 消息、Session、生命周期事件或子进程。

存在 Intent Map 覆盖时，字面量前缀不匹配可证明两者分离，所有未能解析的 glob 关系均保守处理。顺序靠后的 READY 项会被延后，并记录有界的 `WRITE_INTENT_CONFLICT` 事实。调度会在图锁保护下、任何 worktree、Session 或进程启动之前，针对 RUNNING 项重复同一兼容性检查。它不会添加依赖边，模式绝不会通过 shell 执行，基于声明的调度也不等于 diff 审计。

graph-dispatch 操作会捕获一个确切的基础提交，并且只为选中的 READY 子任务使用 Runtime 拥有、位于仓库内且不是符号链接的 worktree 和分支。其持久 Session 以该 worktree 为根目录；精确的 Adapter 命令优先级、有界 I/O 和非零退出语义仍然有效。启动或完成失败不会触发自动重试/回退，也不会修改无关子任务，调度始终不会改变用户的检出目录。

并行图执行会在图锁保护下领取 READY 子任务，以原子方式强制执行持久化的并发上限，并为每个选中的子任务分配独立的 worktree、分支/ref、消息和 Session 标识；这些标识均基于同一个确切的图基础提交。失败保持隔离，绝不触发回退或自动重试。

有界的图推进要求显式指定 1–32 的波次上限，在每一波之前读取新的 Preflight，并在出现冲突、非成功结果、恢复状态、集成失败或要求修改时停止。它绝不会调用恢复、重试、改变依赖、集成、审查或授权发布。

图恢复以事实为先：status 和 inspect 会显示持久化的 Session/worktree/commit/evidence 分类，恢复只会推进已验证的 `IMPLEMENTATION_DONE` 提交，或记录被中断的 `FAILED` 状态。显式 resume 会复用已验证且健康的 Runtime 所属 Session/worktree，否则返回 `READY`，等待独立的 dispatch；它绝不会循环执行，也不会根据文件名或文字说明推断成功。

显式的图 stop/cleanup 只会关闭匹配且属于 Runtime 的 Session，并且只在有界超时后移除确切的 Runtime 所属 worktree。所有权不匹配、符号链接、路径越界和清理失败都会保留为持久化的有界错误；分支、ref、提交、证据及用户的 worktree 均保持完整。

图集成是独立且显式的边界。只有每个必需子任务都具备已验证的完成证据后才会执行；它会检查确切的 Runtime 源 ref 和捕获的基础提交，并在独立的 Runtime 所属聚合 worktree 中按确定顺序应用提交。它绝不会改变当前检出目录或源 worktree。cherry-pick 冲突会保留在原处，并附带有界的来源、已应用 ref、Git 状态和冲突事实，供检查；不会自动解决、reset、重试、merge、push、tag、publish、deploy 或 release。聚合审查会在记录 `REVIEW_APPROVED` 或 `CHANGES_REQUESTED` 前重新检查这些事实，清理操作会保留聚合分支、提交、冲突事实和证据。

本地 Git 排除规则可防止普通提交，但无法阻止管理员、同一用户的进程、备份、云同步或恶意软件访问。分享诊断信息前，请检查并脱敏 Bus 数据。仅对于 Legacy runtime，`clean --confirm DELETE_AGENT_BUS` 是在不再需要保留审计记录后使用的显式破坏性操作。它不是 Web 卸载步骤。

安装器默认拒绝未知目录、符号链接、junction、路径越界、已修改的安装和额外文件。请阅读完整的[安全策略](https://github.com/hogancv/coordinate-agents/blob/main/.github/SECURITY.md)，其中包括私密漏洞报告方式。
