---
title: 恢复 Codex 协作对话
description: 保存并恢复 Codex 原生对话、恢复执行者，以及 UUID、会话归属、运行代次和验收范围的完整边界。
---

<div id="自动保存与恢复-codex-原生对话" class="doc-anchor" aria-hidden="true"></div>
<div id="resume-a-codex-collaboration-conversation" class="doc-anchor" aria-hidden="true"></div>

# 恢复 Codex 协作对话

适用于 **`f9f0210` 及之后的源码实现**，核对日期为 2026-10-21，已纳入 **Web 3.0.2**。最初源码阶段使用的包版本为 3.0.1；仅凭该版本号无法确定某个流程已经发布。早期设计和验收记录描述了额外的人工确认阶段；参阅[历史范围](#历史范围)。

默认协作让 Codex 持续担任规划者／审查者。关闭 Task 会停止它所管理的终端，同时保留 Task、Git 工作区、原生 Codex 绑定及协作时间线。**Restart Pair（重启终端对）不是 Resume（恢复对话）。**一旦 Task 有了原生绑定或预留的 Resume 目标，重启全新终端对会在关闭终端前被拒绝：继续原对话请使用 Reopen；需要新上下文请创建新 Task。未绑定的 Task 和自定义终端仍可执行全新重启。

<div id="action-table" class="doc-anchor" aria-hidden="true"></div>

## 动作表

| 动作与入口 | 条件与范围 | 终端行为 | 保留状态及下一步 |
| --- | --- | --- | --- |
| 重连终端：浏览器刷新／重新连接 | 原有 Session Host 仍在运行 | 将浏览器终端视图重新连接到相同会话；不启动原生 Resume | 保留原有会话和仍可用的输出；断线期间的输出保存有界，不保证完整历史 |
| 新建任务：**New task** | 当前项目；默认协作或自定义终端 | 打开绑定到任务的全新终端；默认模式初始化双方角色 | 创建新 Task／上下文；不恢复其他 Task 的对话 |
| 关闭任务：红色电源图标 | 所选任务；Web 会要求确认 | 停止该 Task 所管理的终端 | 保留 Task、Git 工作区、绑定／预留 UUID、轮次及时间线；关闭不会派发工作 |
| 关闭所有终端：品牌旁电源图标 | 仅当前项目；Web 会要求确认 | 关闭该项目内每个尚未关闭 Task 的终端 | 保留内容与关闭任务相同；不影响其他项目 |
| 重新打开任务：恢复图标／回退入口 **Resume Conversation（继续对话）** | 未归档的默认任务，处于 CLOSED、EXITED、DEGRADED 或 ERROR；要求确切有效的原始 UUID，且无锁存身份冲突 | 复用仍有效的活跃槽位；缺失 Codex 时通过 `codex resume <uuid>` 启动，缺失执行者时创建全新会话 | 保留 Task、Git 变更、绑定／目标、轮次及时间线；完成正常终端启动后即可就绪，无需人工确认身份 |
| 恢复执行者：同一恢复图标，使用不同标签 | 默认任务中由运行时管理的 Codex 仍活跃，Antigravity 不活跃／缺失；UUID 校验与重新打开相同 | 保留现有 Codex 会话／运行代次；只打开缺失的执行者，并初始化其当前角色／辅助脚本 | 不恢复 Antigravity 的旧对话，也不重放旧指令；替代执行者不能完成前任的轮次 |
| 继续启动：Web 自动刷新／`workspaceTaskContinue` | 已有默认任务处于 STARTING 或 AWAITING_INPUT | 登录／信任确认后重新检查现有终端，继续初始化 | 不创建新对话；角色注入结果不确定时属于错误，不代表允许重发 |
| 重启终端对：`workspaceTaskRestart` 运行时／HTTP 操作，当前 Web 无独立按钮 | 未绑定／未预留目标的默认任务，或自定义终端；拒绝已归档任务 | 关闭旧终端并打开全新会话；已绑定／已预留目标的默认任务会在关闭前被拒绝 | 保留 Task／工作区／历史，默认任务重置当前协作状态；新上下文不是原生 Resume |
| 归档任务：任务右键菜单 | 所选未归档 Task | 关闭所管理的终端并隐藏 Task | 明确删除归档数据之前保留记录；已归档任务不能重新打开 |

**就绪（Ready）**要求两个终端关联的 Task／槽位／Session／运行代次归属均有效且活跃，双方启动槽位都为 `READY`，并且没有锁存的 Codex 身份冲突。Codex 不活跃或有冲突时为 `FAILED`；执行者不活跃或终端启动未完成时为 `PARTIAL`。启动仍在进行时可保持 `STARTING`；已关闭／归档 Task 显示 `CLOSED`。读取旧数据时仍接受 `AWAITING_CONFIRMATION`，但它不是当前用户操作步骤，也不是就绪前提。Task 生命周期及这些恢复状态都不能证明实施工作已经完成。

UUID 对话框用于提供恢复目标，不是恢复后的验证关卡。关闭确认、CLI 登录／信任提示、自定义提示词的就绪确认，以及审查反馈发送确认，仍是独立操作。这些属于 Web 工作台 Task 操作，与[结构化工作流](./structured-workflow.html)描述的 Legacy 结构化 `task resume` 命令不同。

<div id="正常流程" class="doc-anchor" aria-hidden="true"></div>
<div id="first-binding-and-continuing-later" class="doc-anchor" aria-hidden="true"></div>

## 首次绑定与后续继续

1. 创建默认协作 Task。使用受支持的本地 Codex CLI 0.163.x 时，标题栏先显示 **Identifying conversation（正在识别对话）**，然后显示 **Conversation saved（对话已保存）**。保存原始对话不需要 `/status` 或 UUID 输入。
2. 关闭 Task。标题栏 **Closed（已关闭）**状态后会立即显示 **Reopen task（重新打开任务）**图标，点击即可直接恢复已保存的对话。如果自动捕获不可用且 Task 没有绑定，恢复对话框会接受原始原生 UUID，再通过 **Resume Conversation／继续对话**操作恢复。原生记录必须存在于本地，并属于当前项目及主 Codex CLI 对话。
3. 完成 CLI 正常的登录、信任和启动界面。两个终端都就绪后，任务即可立即派发和审查，无需 `/status` 或人工确认。旧版本保存为 Awaiting Confirmation（等待确认）的任务，也会根据当前终端状态直接就绪。
4. Resume 不会发送旧角色提示词，也不会重放历史。自定义任务和已归档 Task 不提供原生对话恢复入口。

失败或部分恢复的终端对也会显示恢复入口。直接重新打开失败时，会打开回退对话框并预填已保存的 UUID。对话框支持 Escape、关闭按钮和点击背景关闭；切换项目或 Task 也会关闭它。打开或关闭对话框不会恢复 CLI；只有 **Reopen task** 或对话框中的明确操作才启动恢复。

Resume 使用经过验证的原始 UUID 和当前所管理的运行实例。自动绑定依据限定到进程的原生启动事件，以及精确的主 CLI 元数据。错误目标、项目不匹配、与原绑定冲突，或 UUID 已被其他 Task 预留时，都会被拒绝；系统不会悄悄创建一个空白 Codex 对话来替代。就绪允许继续协作，但不意味着持续验证原生对话身份。

在同一个 TUI 中运行 `/new` 或切换对话，可能不会改变 Runtime Session ID 和运行代次。如果受支持的原生事件和主记录暴露了不同 UUID，任务会锁存身份冲突，阻止新的派发／审查。事件导出是异步的，因此无法保证立即或必然检测到变化。切换后请停止协作，并检查原任务绑定。输入其他 UUID 不能清除已锁存的冲突。

“已发现候选”“已可靠绑定”和“当前 TUI 身份已验证”是不同事实。JSONL 存在、进程存活或历史绑定本身，都不能证明当前 TUI 身份。

现有的内置 Codex 适配器配置、用户命令／包装程序、认证、模型／权限选项和原生 TUI／PTY 会继续使用。安全的普通 CLI 选项和 Node 入口脚本前缀会保留。Resume 会拒绝有歧义的位置参数、提示词、远端、目标和 worktree 选项。不使用 `--last`、私有 CLI profile，也不改写全局 CLI 配置。原生目标记录从生效的 `CODEX_HOME`，或常规 `~/.codex` 下的 sessions 和 archived_sessions 目录读取；不会在项目路径之间移动记录。

自动绑定保持 Hooks 关闭，使用专用本地 CLI 进程（`--no-daemon`）及仅驻留内存的环回 OTLP 接收器。启动配置仅针对本次调用，将 OTEL 日志发送到该接收器，覆盖已配置的日志导出器；提示词／响应日志关闭。Trace／Metric 导出器、原生通知、模型设置、权限和登录保持原样。不向全局 Codex 配置写入任何内容。CLI 版本未知、远端运行时、来源不受支持、记录缺失／有歧义，或捕获失败时，仍保留手动恢复。不按最新文件选择，也不进行无界轮询。参阅[来源／信任与原生验收说明（英文技术参考）](../codex-native-auto-binding.html)。

采集采用 OTLP／HTTP JSON 日志，由分离运行的 Session Host 为每次启动创建随机本地接收地址。只用事件给出的精确 UUID 查找主 CLI 原生记录，并验证规范化 cwd、版本及来源，不绕过正常信任确认。现有 Identity Store 负责 Session／Generation／Revision CAS、跨任务占用、禁止静默覆盖及原子持久化；采集失败不会取消原有手动恢复路径。

<div id="何时需要人工处理" class="doc-anchor" aria-hidden="true"></div>
<div id="executor-and-interrupted-work" class="doc-anchor" aria-hidden="true"></div>

## 执行者与中断工作

已有健康且归属正确的 Antigravity Session 时，会重新连接它。否则，全新 Session 使用现有适配器、真实用户设置和代理包装程序（包括 agy-proxy 参数／环境）。仅初始化当前执行者角色和工作台辅助脚本，不重放旧实施指令。如果执行者启动失败，Codex 仍保持可用；Resume 只重试缺失的执行者。如果角色注入被中断，请关闭后恢复，以替换该执行者，不要重试结果不确定的写入。

Resume 保留 roundId、Cooperation Revision 和时间线。中断轮次会展示出来供检查，包括投递不确定的派发。读取时，恢复界面根据当前已记录的 Session Facts 派生：已经退出的 Codex 不再显示 READY，同时保留已持久化的恢复元数据及旧确认历史。这不会新建实时进程探测或原生身份探测。Codex 检查 Git Changes 和先前记录，并决定何时发送新指令。新执行者不能报告前任执行者轮次已完成。恢复后的辅助脚本要求 CLI 环境继承的当前 Task／槽位／Session／运行代次归属声明；旧运行实例的操作和缺失声明会被拒绝。这些声明是本地运行时防护，不是操作系统用户之间的安全边界。

Codex 恢复期间，未更换且仍活跃的 Antigravity Session，仍可为自己的已有轮次报告 WORKING／DONE／FAILED。Task／槽位／Session／运行代次、轮次归属、合法状态转换及当前 Cooperation Revision，会在同一个生命周期事务下检查。重复回执保持幂等。此例外不允许新派发、Codex 审查、对已归档／已关闭 Task 的写入、旧执行者或错误轮次；新 Codex 指令和审查要求当前运行实例归属有效，并已完成启动。

已归档 Task 仍不可用。Resume 准备和最终提交使用现有 Task 锁；较慢的 CLI 启动／就绪过程在锁外执行，让当前执行者能够报告自己的轮次。身份／回执提交继续保留既有归属检查。锁持有者已失效时，由选举出的 reaper（回收者）执行恢复，绝不依据锁的存续时间判断。启动进程前先持久保存启动意图；后端崩溃后，能够精确确认归属的待完成 Session 可以被接管，归属不明确的孤儿进程则需要检查。不会自动重试派发。

<div id="本地配置与隐私" class="doc-anchor" aria-hidden="true"></div>
<div id="validation-boundary" class="doc-anchor" aria-hidden="true"></div>

## 验证边界

自动化测试通过真实 Session Host 使用确定性的原生记录和 CLI 测试夹具。它们验证参数、归属、生命周期、并发、HTTP／界面和包行为，不能证明模型记忆。单独的 [macOS 原生 CLI 证据（英文技术参考）](../diagnostics/codex-conversation-resume-macos.html)记录了真实对话记忆、执行者完成和 WORKING 期间的中断。Windows CI 的存储／PTY 检查不代表已完成 Windows 10 原生 CLI Resume 验收。引用的原生验收报告是历史结果，不是对当前就绪策略的新验收。

<div id="历史方案与适用版本" class="doc-anchor" aria-hidden="true"></div>
<div id="historical-scope" class="doc-anchor" aria-hidden="true"></div>

## 历史范围

| 文档 | 适用实现 | 当前用途 |
| --- | --- | --- |
| [Resume v1 设计（英文技术参考）](../superpowers/specs/2026-10-20-codex-conversation-resume-design.html)和[实现计划（英文技术参考）](../superpowers/plans/2026-10-20-codex-conversation-resume.html) | 2026-10-20 Resume v1；`f9f0210` 之前的人工确认阶段 | 设计历史；恢复后的旧 `/status` 确认已被上方动作表取代 |
| [原生身份存储 v1（英文技术参考）](../native-conversation-identity-store.html)和[存储计划（英文技术参考）](../superpowers/plans/2026-10-19-native-identity-store.html) | PR #137 的纯存储阶段，早于原生 Resume 和自动捕获 | 存储／CAS 历史；不是当前来源注册、重启或恢复指南 |
| [自动绑定计划（英文技术参考）](../native-auto-binding-plan.html) | `5fad370`，自动绑定但仍使用原确认阶段 | 历史来源／传输决策；不会重新引入确认界面 |
| [macOS Resume 验收（英文技术参考）](../diagnostics/codex-conversation-resume-macos.html) | 2026-10-20，Codex CLI 0.162.1 和 Resume v1 | 仅作为当时所测流程的证据 |
| [原生捕获验收说明（英文技术参考）](../codex-native-auto-binding.html#independent-native-acceptance) | 2026-10-21，CLI 0.163.0，`f9f0210` 之前的自动绑定阶段 | 历史原生传输证据；须与当前就绪策略的回归检查区分 |

这些阶段使用相同的源码包版本 3.0.1。提交／阶段和原生 CLI 版本决定适用范围；它们不代表不同的 npm 发布版本。后端保留 `workspaceTaskConfirmConversation`，用于兼容和明确的人工证明，但当前 Web 没有确认入口，就绪也不依赖该端点。恢复元数据中的旧人工确认记录可以保留，但不会因为刷新而变成自动实时身份验证。
