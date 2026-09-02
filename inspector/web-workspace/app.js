/* Coordinate Agents Web Workspace — chat-first control plane.
 *
 * All visible UI strings live in the I18N dictionaries below. Raw user data
 * (titles, specifications, IDs, commits, paths, logs, Agent IDs, error codes)
 * is never translated or rewritten. Unknown statuses/event types fall back to
 * a localised generic label while preserving the original code.
 */

/* ------------------------------------------------------------------ */
/* I18N                                                               */
/* ------------------------------------------------------------------ */
const LOCALE_KEY = 'coordinate-agents.locale';

const I18N = {
  'en-US': {
    'nav.newTask': 'New task',
    'nav.chat': 'Chat',
    'nav.tasks': 'Tasks',
    'nav.agents': 'Agents',
    'nav.sessions': 'Sessions',
    'nav.activity': 'Activity',
    'nav.recent': 'Recent',
    'view.chat': 'Chat',
    'view.tasks': 'Tasks',
    'view.agents': 'Agents',
    'view.sessions': 'Sessions',
    'view.activity': 'Activity',
    'view.subtitleWorkspace': 'Workspace for your local AI coding team',
    'view.subtitleChat': 'Task conversations and workspace events',
    'view.subtitleTasks': 'All durable Tasks and Task Graphs in this repository',
    'view.subtitleAgents': 'Configure local coding Agents, Adapters and executables',
    'view.subtitleSessions': 'Execution Sessions owned by the Runtime',
    'view.subtitleActivity': 'Append-only Event Journal',
    'view.tasksTitle': 'Tasks',
    'view.activityTitle': 'Recent events',
    'view.activityHint': 'recorded events · legacy fallback',
    'view.sessionsTitle': 'Sessions',
    'repo.loading': 'Loading repository…',
    'repo.details': 'Repository details',
    'repo.hideDetails': 'Hide details',
    'repo.detached': 'detached',
    'repo.head': 'HEAD',
    'repo.latestOn': 'Latest commit on {branch}',
    'repo.latest': 'Latest commit',
    'repo.committed': 'Committed',
    'repo.remote': 'Remote',
    'repo.noOrigin': 'no origin remote',
    'repo.boundRoot': 'Bound root',
    'repo.noCommits': 'no commits yet',
    'repo.factsError': 'Repository facts',
    'repo.repo': 'Repository',
    'status.connected': 'localhost · live',
    'composer.placeholder': 'Describe a task for your local AI team… (Enter to create, Shift+Enter for a new line)',
    'composer.agent': 'Agent',
    'composer.mode': 'Mode',
    'composer.modeTask': 'Single task',
    'composer.modeGraph': 'Task Graph…',
    'composer.send': 'Send',
    'composer.openGraph': 'Open graph form',
    'composer.enterHint': 'Enter to create a Task · Shift+Enter for a new line',
    'composer.noAgents': 'No Agents configured — tasks still create, but add Agents in the Agents view to assign roles.',
    'composer.titleRequired': 'Describe the task first (title is required).',
    'composer.creating': 'Creating Task…',
    'composer.created': 'Created {title} · {id}',
    'composer.failed': 'Create failed: {message}',
    'composer.graphHint': 'Graph mode opens the authoring form; validate, preview, then create explicitly.',
    'composer.sent': 'Request sent — Runtime accepted.',
    'context.title': 'Context',
    'context.agentFlow': 'Agent flow',
    'context.selectionHint': 'Select a Task or Session to inspect it here.',
    'context.openDetails': 'Details & topology',
    'context.execution': 'Execution',
    'context.review': 'Review & integrate',
    'context.close': 'Close',
    'context.newTask': 'New task',
    'context.browseAgents': 'Configure Agents',
    'context.recentTasks': '{n} Tasks',
    'context.recentSessions': '{n} Sessions',
    'context.taskStatus': 'Task',
    'context.graphStatus': 'Task Graph',
    'drawer.taskDetail': 'Task & graph details',
    'drawer.close': 'Close',
    'welcome.title': 'Coordinate Agents Workspace',
    'welcome.subtitle': 'A local, browser-only control plane for the AI coding team running on this machine.',
    'welcome.whatYouCan': 'What you can do here',
    'welcome.w1': 'Describe work in the composer and create durable Tasks or Task Graphs.',
    'welcome.w2': 'Watch real Task, Agent, Session and Runtime events as a conversation timeline.',
    'welcome.w3': 'Configure your local Agents and their executables.',
    'welcome.w4': 'Explicitly dispatch, advance, recover, integrate and review — nothing runs automatically.',
    'welcome.hint': 'Everything shown is read from the local Runtime records; the Workspace never invents agent thoughts, replies, or status.',
    'welcome.startTask': 'Describe a task below',
    'welcome.configAgents': 'Configure Agents',
    'empty.tasks': 'No Tasks found in this project.',
    'empty.events': 'No Runtime events found.',
    'empty.sessions': 'No Execution Sessions recorded.',
    'empty.recent': 'Nothing here yet — create a Task from the composer.',
    'empty.detailTimeline': 'No Task events recorded yet.',
    'empty.subtasks': 'No persisted subtasks.',
    'empty.graphNoReadable': 'Task Graph record has no readable subtasks.',
    'empty.selectNode': 'Select a map node to inspect its bounded Runtime evidence.',
    'empty.discovery': 'No discovery snapshot available.',
    'empty.discoveryAgents': 'No coding CLIs detected on this machine.',
    'empty.discoveryAdapters': 'No adapters registered.',
    'empty.configuredAgents': 'No Agents are registered in this repository yet.',
    'empty.dependencies': 'none',
    'empty.noSpec': 'No specification recorded.',
    'empty.noEvidence': 'No review decisions recorded.',
    'graph.map': 'Graph map',
    'graph.frontier': 'Frontier & preflight wave',
    'graph.conflicts': 'Conflicts & scope audit',
    'graph.integration': 'Integration & review',
    'graph.topology': 'Task Graph topology',
    'graph.largeGraph': 'Large graph: rendering the first {max} of {total} subtasks in deterministic order; the complete bounded topology remains below.',
    'graph.nodeLabel': 'Subtask {id}: {title} ({state})',
    'lb.Depends on': 'Depends on',
    'lb.Dependency edges': 'Dependency edges',
    'lb.Evidence records': 'Evidence records',
    'lb.Adapters & command sources': 'Adapters & command sources',
    'lb.Detected coding CLIs': 'Detected coding CLIs',
    'detail.timelineTitle': 'Event timeline',
    'detail.agentFlowTitle': 'Agent flow',
    'detail.evidenceTitle': 'Evidence & review',
    'detail.specTitle': 'Specification',
    'msg.agent': 'Agent',
    'msg.session': 'Session',
    'msg.round': 'Round {round}',
    'msg.graph': 'Task Graph',
    'msg.updated': 'Updated {time}',
    'msg.created': 'Created {time}',
    'msg.lastActivity': 'Last activity {time}',
    'msg.graphSubtask': '{n} subtasks',
    'msg.reviewApproved': 'Review approved',
    'msg.reviewRequested': 'Changes requested',
    'msg.actionRecorded': 'You ran {action}',
    'msg.actionDone': '{action} completed',
    'msg.actionFailed': '{action} failed',
    'msg.actionRunning': '{action} running…',
    'msg.actionWillRefresh': 'Refreshing authoritative Runtime state…',
    'msg.unknownEvent': 'Unknown event',
    'msg.unknownStatus': 'Unknown status',
    'msg.noFeedback': 'No feedback',
    'msg.graphNoConflict': 'No conflict or scope facts recorded.',
    'msg.graphNoIntegration': 'Integration and review have not been recorded.',
    'msg.recordedEvent': 'Recorded Event',
    'msg.legacyHistory': 'Derived / Legacy History',
    'msg.subtasks': 'subtasks',
    'msg.concurrency': 'concurrency {n}',
    'msg.output': 'Session output',
    'msg.noOutput': 'No recent output available.',
    'msg.reviewDecision': 'Recorded review decision',
    'msg.sessionInput': 'Send input to Session',
    'msg.feedback': 'Feedback',
    'chat.action': 'Action',
    'chat.user': 'You',
    'chat.runtime': 'Runtime',
    'toast.copied': 'Copied.',
    'tooltip.copy': 'Copy',
    'tasks.cardRound': 'R{round}',
    'execution.titleTask': 'Execution · {title}',
    'execution.titleGraph': 'Execution · {title}',
    'execution.confirm': 'I understand: this explicitly launches an Agent process that may write to the repository; failures are never retried automatically and no merge, push, tag, publish, deploy, or release occurs.',
    'execution.dispatch': 'Dispatch task',
    'execution.dispatchFor': 'Dispatch {id}',
    'execution.notDispatchable': 'status {status} — dispatch applies to created / planning / spec-ready / changes-requested Tasks with a specification.',
    'execution.sessionWait': 'Session wait (ms, 0–10000)',
    'execution.runWave': 'Run eligible wave',
    'execution.runFor': 'Run eligible wave of {id}',
    'execution.maxWaves': 'maxWaves (1–32)',
    'execution.advance': 'Advance graph',
    'execution.advanceFor': 'Advance {id}',
    'execution.executing': '{label}: executing…',
    'execution.failed': '{label} failed',
    'execution.completed': '{label} completed',
    'execution.stopTask': 'Stop Task',
    'execution.resumeTask': 'Resume Task',
    'execution.stopGraph': 'Stop graph',
    'execution.recoverGraph': 'Recover graph',
    'execution.resumeGraph': 'Resume graph',
    'execution.cleanup': 'Clean up worktrees',
    'execution.noRecovery': '{state} — no automatic recovery action; review the Runtime facts and act explicitly.',
    'execution.recoverySep': 'Recovery & ownership',
    'execution.requestFailed': '{label} request failed: {message}',
    'execution.noSessionFacts': '(no identity facts returned)',
    'review.title': 'Review & integrate',
    'review.releaseLabel': 'review approval is never release approval',
    'review.note': 'Integration applies verified subtask commits only to the Runtime-owned aggregate review worktree — never to your checked-out worktree or remote refs. Recording a review decision is durable and visible after reload; requested changes never trigger an automatic retry. This Workspace offers no merge, push, tag, publish, deploy, or release control: releasing requires the separate human RELEASE_APPROVED gate.',
    'review.integrate': 'Integrate verified subtasks',
    'review.decision': 'Decision',
    'review.feedback': 'Feedback',
    'review.evidence': 'Evidence (optional JSON object)',
    'review.record': 'Record review decision',
    'review.notReviewable': 'Current state is not reviewable; review applies to reviewed/changes-requested Tasks or running/succeeded graphs',
    'review.state': 'state {state}',
    'review.confirm': 'I understand: integration/review targets Runtime-owned artifacts only; review approval is not release approval; no merge, push, tag, publish, deploy, or release happens here.',
    'review.recording': '{label}: recording decision…',
    'review.recorded': '{label} recorded ({decision}). Durable after reload.',
    'review.rejected': '{label} rejected: {message}',
    'review.integrating': 'Integrating verified subtask commits into the Runtime-owned aggregate review worktree…',
    'review.integrated': 'Integration recorded. Review the aggregate facts, then record a decision.',
    'review.integrationFailed': 'Integration rejected: {message}',
    'review.integrationComplete': 'Integration complete',
    'review.evidenceInvalid': 'Review evidence must be valid JSON object text.',
    'review.chooseDecision': 'Choose a review decision.',
    'author.title': 'Author new work',
    'author.panelTitle': 'Author new work',
    'author.hint': 'validate first · preflight is side-effect free · create persists the Runtime record only',
    'author.emptyAgents': 'No Agents are configured yet. Configure an Agent in the Agents view before authoring.',
    'author.singleTask': 'Single Task',
    'author.taskTitleLabel': 'Title',
    'author.specLabel': 'Specification',
    'author.taskIdLabel': 'Deterministic ID (optional)',
    'author.createTask': 'Create Task',
    'author.graphTitle': 'Task Graph v1',
    'author.intentMapHint': 'with optional Intent Map v1',
    'author.parentId': 'Parent ID',
    'author.graphTitleLabel': 'Title',
    'author.maxConcurrency': 'Max concurrency',
    'author.intentMap': 'Intent Map (write intents)',
    'author.scopePolicy': 'Scope policy',
    'author.scopeWarn': 'warn (default)',
    'author.scopeObserve': 'observe',
    'author.scopeStrict': 'strict',
    'author.subtasks': 'Subtasks',
    'author.addSubtask': '+ Add subtask',
    'author.subtaskHint': 'Leave write intent empty in a row for an explicitly empty intent; disable the Intent Map for missing (unverified) coverage.',
    'author.validate': 'Validate',
    'author.createGraph': 'Create Graph (persist only)',
    'agents.title': 'Agents',
    'agents.discover': 'Discover CLIs',
    'agents.note': 'Configure a local coding Agent, its Adapter, and its exact executable command. Resolution order stays project command → user command → Adapter default. Detection runs only when you click Discover; the Workspace never performs automatic login, remote lookup, package download, or arbitrary process launch.',
    'agents.discoverHint': 'Click “Discover CLIs” to inspect installed coding CLIs and registered Adapters.',
    'agents.agentId': 'Agent ID',
    'agents.agentIdPh': 'e.g. codex / antigravity',
    'agents.adapter': 'Adapter',
    'agents.command': 'Executable command',
    'agents.commandPh': 'exact command, e.g. agy-proxy',
    'agents.role': 'Workflow role',
    'agents.apply': 'Apply configuration',
    'agents.configured': 'Configured runtime agents',
    'agents.scopeNote': 'Only explicitly registered or loaded local Adapter modules are treated as trusted local code; configuring an Agent grants no browser filesystem or process sandbox bypass. The Workspace never renders or persists credentials, tokens, cookies, or secrets.',
    'agents.configureThis': 'Configure this command',
    'agents.discovering': 'Discovering local coding CLIs…',
    'agents.discoveryFailed': 'Discovery failed ({code}): {message}',
    'agents.discoveryOk': 'Discovery complete. Configure a command below or pick “Configure this command”.',
    'agents.configuring': 'Applying configuration…',
    'agents.configFailed': 'Configuration failed: {message}',
    'agents.configOk': 'Configured {id} ({adapter}) → {command} [{source}] · workflow {roles}',
    'agents.required': 'Agent ID and executable command are required.',
    'agents.adapterOf': 'adapter {adapter}',
    'agents.commandOf': 'command {command}',
    'agents.configuredPill': 'configured',
    'agents.available': 'available',
    'agents.unavailable': 'unavailable',
    'agents.notConfiguredHere': 'not configured in this project',
    'agents.builtin': 'built-in',
    'agents.localAdapter': 'registered local adapter',
    'agents.noCapabilities': 'no capabilities',
    'agents.roles': 'roles',
    'agents.unassigned': 'unassigned',
    'agents.queue': 'queue {new} new · {processing} processing',
    'agents.lastActivity': 'last activity {activity}',
    'agents.unregistered': 'unregistered',
    'roles.planner': 'Planner',
    'roles.implementer': 'Implementer',
    'roles.reviewer': 'Reviewer',
    'roles.unassigned': 'unassigned',
    'roles.noneConfigured': '(no agents configured)',
    'session.send': 'Send input',
    'session.inputPh': 'Bounded input to this owned Session…',
    'session.close': 'Close Session',
    'session.closing': 'Closing Session…',
    'session.closed': 'Session closed.',
    'session.closeRejected': 'Close rejected: {message}',
    'session.sending': 'Sending bounded input…',
    'session.sent': 'Input accepted.',
    'session.rejected': 'Input rejected: {message}',
    'session.tasks': 'Tasks: {tasks}',
    'session.recorded': 'Recorded Events',
    'session.derived': 'Derived / Legacy History',
    'status.creator': 'created',
    'date.justNow': 'just now',
    'generic.ok': 'Ok',
    'generic.error': 'Error',
    'generic.details': 'Details',
    'generic.validating': 'Validating…',
    'generic.loading': 'Loading…',
    'generic.failed': 'failed',
    'author.validated': 'Graph validates: {count} subtask(s)',
    'author.missingIntent': 'intent coverage missing (unverified)',
    'author.intentPresent': 'intent facts present',
    'author.validatedOk': 'Validation passed. Review Preflight after creating, or fix the form.',
    'author.preflightFailed': 'Preflight unavailable',
    'author.preflightTitle': 'Graph Preflight',
    'author.creatingGraph': 'Creating the validated Runtime record (no dispatch)…',
    'author.createFailed': 'Create failed.',
    'author.createdGraph': 'Created {id}',
    'author.loadingPreflight': 'Loading Preflight…',
    'execution.factTask': 'Task / parent',
    'execution.factSubtasks': 'Subtasks',
    'execution.factState': 'State',
    'execution.factSession': 'Session',
    'execution.factCommit': 'Commit',
    'execution.factWaves': 'Waves executed',
    'execution.factStop': 'Stop reason',
    'execution.factAgent': 'Agent',
    'generic.copy': 'Copy',
    'subtask.dependsOn': 'Depends on',
    'subtask.writeIntent': 'Write intent (optional)',
    'subtask.remove': 'Remove',
  },
  'zh-CN': {
    'nav.newTask': '新建任务',
    'nav.chat': '聊天',
    'nav.tasks': '任务',
    'nav.agents': 'Agents',
    'nav.sessions': '会话',
    'nav.activity': '活动',
    'nav.recent': '最近',
    'view.chat': '聊天',
    'view.tasks': '任务',
    'view.agents': 'Agents',
    'view.sessions': '会话',
    'view.activity': '活动',
    'view.subtitleWorkspace': '本机 AI 编码团队工作台',
    'view.subtitleChat': '任务对话与工作区事件',
    'view.subtitleTasks': '仓库内所有持久化 Task 与 Task Graph',
    'view.subtitleAgents': '配置本地编码 Agent、Adapter 与可执行命令',
    'view.subtitleSessions': '由 Runtime 持有的执行会话',
    'view.subtitleActivity': '只追加的 Event Journal',
    'view.tasksTitle': '任务',
    'view.activityTitle': '最近事件',
    'view.activityHint': '已记录事件 · 旧版回溯',
    'view.sessionsTitle': '执行会话',
    'repo.loading': '正在加载仓库…',
    'repo.details': '仓库详情',
    'repo.hideDetails': '收起详情',
    'repo.detached': '游离 HEAD',
    'repo.head': 'HEAD',
    'repo.latestOn': '{branch} 上的最新提交',
    'repo.latest': '最新提交',
    'repo.committed': '提交时间',
    'repo.remote': '远程',
    'repo.noOrigin': '无 origin 远程',
    'repo.boundRoot': '绑定根目录',
    'repo.noCommits': '尚无提交',
    'repo.factsError': '仓库信息',
    'repo.repo': '仓库',
    'status.connected': 'localhost · 实时',
    'composer.placeholder': '向你的本机 AI 团队描述一项任务…（Enter 发送，Shift+Enter 换行）',
    'composer.agent': 'Agent',
    'composer.mode': '模式',
    'composer.modeTask': '单个任务',
    'composer.modeGraph': '任务图…',
    'composer.send': '发送',
    'composer.openGraph': '打开图表单',
    'composer.enterHint': 'Enter 创建任务 · Shift+Enter 换行',
    'composer.noAgents': '尚未配置 Agent —— 仍可创建任务；在 Agents 视图配置后即可分配角色。',
    'composer.titleRequired': '请先描述任务（标题必填）。',
    'composer.creating': '正在创建任务…',
    'composer.created': '已创建 {title} · {id}',
    'composer.failed': '创建失败：{message}',
    'composer.graphHint': '图模式会打开创作表单；先验证与预检，再显式创建。',
    'composer.sent': '请求已发送 —— Runtime 已接受。',
    'context.title': '上下文',
    'context.agentFlow': 'Agent 流转',
    'context.selectionHint': '选中一个 Task 或 Session 在此查看。',
    'context.openDetails': '详情与拓扑',
    'context.execution': '执行控制',
    'context.review': '评审与集成',
    'context.close': '关闭',
    'context.newTask': '新建任务',
    'context.browseAgents': '配置 Agents',
    'context.recentTasks': '{n} 个任务',
    'context.recentSessions': '{n} 个会话',
    'context.taskStatus': '任务',
    'context.graphStatus': '任务图',
    'drawer.taskDetail': '任务与图详情',
    'drawer.close': '关闭',
    'welcome.title': 'Coordinate Agents Workspace',
    'welcome.subtitle': '为本机 AI 编码团队打造的本地、纯浏览器控制台。',
    'welcome.whatYouCan': '这里可以做什么',
    'welcome.w1': '在下方 Composer 描述工作，创建持久化 Task 或 Task Graph。',
    'welcome.w2': '把真实的 Task、Agent、Session 与 Runtime 事件当作对话时间线查看。',
    'welcome.w3': '配置本地 Agent 及其可执行命令。',
    'welcome.w4': '显式派发、推进、恢复、集成与评审 —— 一切都不会自动运行。',
    'welcome.hint': '所有内容都来自本地 Runtime 记录；Workspace 不会虚构任何 Agent 思考、回复或状态。',
    'welcome.startTask': '在下方描述一项任务',
    'welcome.configAgents': '配置 Agents',
    'empty.tasks': '此项目中暂无 Task。',
    'empty.events': '暂无 Runtime 事件。',
    'empty.sessions': '暂无执行会话记录。',
    'empty.recent': '暂无内容 —— 在 Composer 创建一项任务吧。',
    'empty.detailTimeline': '该任务尚无事件记录。',
    'empty.subtasks': '暂无持久化子任务。',
    'empty.graphNoReadable': 'Task Graph 记录中没有可读子任务。',
    'empty.selectNode': '选择一个地图节点以查看其有界 Runtime 证据。',
    'empty.discovery': '暂无发现快照。',
    'empty.discoveryAgents': '未在本机检测到编码 CLI。',
    'empty.discoveryAdapters': '未注册任何 Adapter。',
    'empty.configuredAgents': '仓库中尚未注册 Agent。',
    'empty.dependencies': '无',
    'empty.noSpec': '未记录规格说明。',
    'empty.noEvidence': '暂无评审决策记录。',
    'graph.map': '依赖图',
    'graph.frontier': '前沿与预检波次',
    'graph.conflicts': '冲突与范围审计',
    'graph.integration': '集成与评审',
    'graph.topology': 'Task Graph 拓扑',
    'graph.largeGraph': '大图：按确定性顺序渲染 {total} 个子任务中的前 {max} 个；完整有界拓扑仍在下方。',
    'graph.nodeLabel': '子任务 {id}：{title}（{state}）',
    'lb.Depends on': '依赖',
    'lb.Dependency edges': '依赖边',
    'lb.Evidence records': '证据记录',
    'lb.Adapters & command sources': 'Adapter 与命令来源',
    'lb.Detected coding CLIs': '检测到的编码 CLI',
    'detail.timelineTitle': '事件时间线',
    'detail.agentFlowTitle': 'Agent 流转',
    'detail.evidenceTitle': '证据与评审',
    'detail.specTitle': '规格说明',
    'msg.agent': 'Agent',
    'msg.session': '会话',
    'msg.round': '第 {round} 轮',
    'msg.graph': '任务图',
    'msg.updated': '更新于 {time}',
    'msg.created': '创建于 {time}',
    'msg.lastActivity': '最近活动 {time}',
    'msg.graphSubtask': '{n} 个子任务',
    'msg.reviewApproved': '评审通过',
    'msg.reviewRequested': '已请求修改',
    'msg.actionRecorded': '你执行了 {action}',
    'msg.actionDone': '{action} 已完成',
    'msg.actionFailed': '{action} 失败',
    'msg.actionRunning': '{action} 进行中…',
    'msg.actionWillRefresh': '正在刷新权威 Runtime 状态…',
    'msg.unknownEvent': '未知事件',
    'msg.unknownStatus': '未知状态',
    'msg.noFeedback': '无反馈',
    'msg.graphNoConflict': '未记录冲突或范围事实。',
    'msg.graphNoIntegration': '尚未记录集成与评审。',
    'msg.recordedEvent': '已记录事件',
    'msg.legacyHistory': '派生 / 旧版历史',
    'msg.subtasks': '个子任务',
    'msg.concurrency': '并发 {n}',
    'msg.output': '会话输出',
    'msg.noOutput': '暂无最近输出。',
    'msg.reviewDecision': '已记录的评审决策',
    'msg.sessionInput': '向会话发送输入',
    'msg.feedback': '反馈',
    'chat.action': '操作',
    'chat.user': '你',
    'chat.runtime': 'Runtime',
    'toast.copied': '已复制。',
    'tooltip.copy': '复制',
    'tasks.cardRound': '第 {round} 轮',
    'execution.titleTask': '执行 · {title}',
    'execution.titleGraph': '执行 · {title}',
    'execution.confirm': '我理解：此操作会显式启动一个可写入仓库的 Agent 进程；失败绝不会自动重试，也不会发生任何 merge、push、tag、publish、deploy 或 release。',
    'execution.dispatch': '派发任务',
    'execution.dispatchFor': '派发 {id}',
    'execution.notDispatchable': '状态 {status} —— 派发适用于已创建 / 规划中 / 规格就绪 / 已请求修改且含规格说明的任务。',
    'execution.sessionWait': '会话等待（毫秒，0–10000）',
    'execution.runWave': '运行可执行波次',
    'execution.runFor': '运行 {id} 的可执行波次',
    'execution.maxWaves': '波次数上限（1–32）',
    'execution.advance': '推进图',
    'execution.advanceFor': '推进 {id}',
    'execution.executing': '{label}：执行中…',
    'execution.failed': '{label} 失败',
    'execution.completed': '{label} 完成',
    'execution.stopTask': '停止任务',
    'execution.resumeTask': '恢复任务',
    'execution.stopGraph': '停止图',
    'execution.recoverGraph': '恢复图',
    'execution.resumeGraph': '恢复图',
    'execution.cleanup': '清理 worktree',
    'execution.noRecovery': '{state} —— 无自动恢复动作；请查看 Runtime 事实后显式操作。',
    'execution.recoverySep': '恢复与归属',
    'execution.requestFailed': '{label} 请求失败：{message}',
    'execution.noSessionFacts': '（无身份事实返回）',
    'review.title': '评审与集成',
    'review.releaseLabel': '评审通过不等于发布批准',
    'review.note': '集成只把已验证的子任务提交应用到 Runtime 持有的聚合评审 worktree——绝不触及你的工作区或远程引用。评审决策持久可见，重载后仍在；请求的修改绝不会自动重试。本 Workspace 不提供任何 merge、push、tag、publish、deploy 或 release 控件：发布必须走独立的人工 RELEASE_APPROVED 闸门。',
    'review.integrate': '集成已验证子任务',
    'review.decision': '决策',
    'review.feedback': '反馈',
    'review.evidence': '证据（可选 JSON 对象）',
    'review.record': '记录评审决策',
    'review.notReviewable': '当前状态不可评审；评审适用于评审中 / 已请求修改的任务或运行中 / 已成功的图',
    'review.state': '状态 {state}',
    'review.confirm': '我理解：集成 / 评审只作用于 Runtime 持有的产物；评审通过不是发布批准；这里不会发生任何 merge、push、tag、publish、deploy 或 release。',
    'review.recording': '{label}：正在记录决策…',
    'review.recorded': '{label} 已记录（{decision}）。重载后依然持久可见。',
    'review.rejected': '{label} 被拒绝：{message}',
    'review.integrating': '正在把已验证的子任务提交集成进 Runtime 持有的聚合评审 worktree…',
    'review.integrated': '集成已记录。请查看聚合事实后再记录决策。',
    'review.integrationFailed': '集成被拒绝：{message}',
    'review.integrationComplete': '集成完成',
    'review.evidenceInvalid': '评审证据必须是合法的 JSON 对象文本。',
    'review.chooseDecision': '请选择评审决策。',
    'author.title': '创作新工作',
    'author.panelTitle': '创作新工作',
    'author.hint': '先验证 · 预检无副作用 · 创建只持久化 Runtime 记录',
    'author.emptyAgents': '尚未配置 Agent。请先在 Agents 视图配置后再创作。',
    'author.singleTask': '单个任务',
    'author.taskTitleLabel': '标题',
    'author.specLabel': '规格说明',
    'author.taskIdLabel': '确定性 ID（可选）',
    'author.createTask': '创建任务',
    'author.graphTitle': 'Task Graph v1',
    'author.intentMapHint': '可选 Intent Map v1',
    'author.parentId': '父任务 ID',
    'author.graphTitleLabel': '标题',
    'author.maxConcurrency': '最大并发',
    'author.intentMap': 'Intent Map（写入意图）',
    'author.scopePolicy': '范围策略',
    'author.scopeWarn': 'warn（默认）',
    'author.scopeObserve': 'observe',
    'author.scopeStrict': 'strict',
    'author.subtasks': '子任务',
    'author.addSubtask': '+ 添加子任务',
    'author.subtaskHint': '某行留空写入意图表示显式空意图；关闭 Intent Map 表示缺失（未验证）覆盖。',
    'author.validate': '验证',
    'author.createGraph': '创建图（仅持久化）',
    'agents.title': 'Agents',
    'agents.discover': '发现 CLIs',
    'agents.note': '配置本地编码 Agent、其 Adapter 与精确可执行命令。解析顺序保持项目命令 → 用户命令 → Adapter 默认。只有点击「发现」才会运行检测；Workspace 从不自动登录、远程查询、下载包或启动任意进程。',
    'agents.discoverHint': '点击「发现 CLIs」检查已安装的编码 CLI 与已注册的 Adapter。',
    'agents.agentId': 'Agent ID',
    'agents.agentIdPh': '例如 codex / antigravity',
    'agents.adapter': 'Adapter',
    'agents.command': '可执行命令',
    'agents.commandPh': '精确命令，例如 agy-proxy',
    'agents.role': '工作流角色',
    'agents.apply': '应用配置',
    'agents.configured': '已配置的运行 Agent',
    'agents.scopeNote': '只有显式注册或加载的本地 Adapter 模块才被视为可信本地代码；配置 Agent 不授予任何浏览器文件系统或进程沙箱绕过能力。Workspace 从不渲染或持久化凭据、令牌、Cookie 或密钥。',
    'agents.configureThis': '配置此命令',
    'agents.discovering': '正在发现本机编码 CLI…',
    'agents.discoveryFailed': '发现失败（{code}）：{message}',
    'agents.discoveryOk': '发现完成。请在下方配置命令，或选择「配置此命令」。',
    'agents.configuring': '正在应用配置…',
    'agents.configFailed': '配置失败：{message}',
    'agents.configOk': '已配置 {id}（{adapter}）→ {command} [{source}] · 工作流 {roles}',
    'agents.required': 'Agent ID 与可执行命令必填。',
    'agents.adapterOf': 'adapter {adapter}',
    'agents.commandOf': 'command {command}',
    'agents.configuredPill': '已配置',
    'agents.available': '可用',
    'agents.unavailable': '不可用',
    'agents.notConfiguredHere': '未在此项目配置',
    'agents.builtin': '内置',
    'agents.localAdapter': '已注册本地 Adapter',
    'agents.noCapabilities': '无能力',
    'agents.roles': '角色',
    'agents.unassigned': '未分配',
    'agents.queue': '队列 {new} 新 · {processing} 处理中',
    'agents.lastActivity': '最近活动 {activity}',
    'agents.unregistered': '未注册',
    'roles.planner': '规划者',
    'roles.implementer': '实现者',
    'roles.reviewer': '评审者',
    'roles.unassigned': '未分配',
    'roles.noneConfigured': '（未配置 Agent）',
    'session.send': '发送输入',
    'session.inputPh': '向此持有的会话发送有界输入…',
    'session.close': '关闭会话',
    'session.closing': '正在关闭会话…',
    'session.closed': '会话已关闭。',
    'session.closeRejected': '关闭被拒绝：{message}',
    'session.sending': '正在发送有界输入…',
    'session.sent': '输入已接受。',
    'session.rejected': '输入被拒绝：{message}',
    'session.tasks': '任务：{tasks}',
    'session.recorded': '已记录事件',
    'session.derived': '派生 / 旧版历史',
    'status.creator': '已创建',
    'date.justNow': '刚刚',
    'generic.ok': '确定',
    'generic.error': '错误',
    'generic.details': '详情',
    'generic.validating': '验证中…',
    'generic.loading': '加载中…',
    'generic.failed': '失败',
    'author.validated': '图通过验证：{count} 个子任务',
    'author.missingIntent': '意图覆盖缺失（未验证）',
    'author.intentPresent': '意图事实存在',
    'author.validatedOk': '验证通过。创建后可查看预检，或继续修改表单。',
    'author.preflightFailed': '预检不可用',
    'author.preflightTitle': '图预检',
    'author.creatingGraph': '正在创建已验证的 Runtime 记录（不派发）…',
    'author.createFailed': '创建失败。',
    'author.createdGraph': '已创建 {id}',
    'author.loadingPreflight': '正在加载预检…',
    'execution.factTask': '任务 / 父任务',
    'execution.factSubtasks': '子任务数',
    'execution.factState': '状态',
    'execution.factSession': '会话',
    'execution.factCommit': '提交',
    'execution.factWaves': '已执行波次',
    'execution.factStop': '停止原因',
    'execution.factAgent': 'Agent',
    'lb.Specification': '规格说明',
    'lb.Executable': '可执行命令',
    'lb.Worktree / branch / commit': 'Worktree / 分支 / 提交',
    'lb.Evidence': '证据',
    'lb.Scope audit': '范围审计',
    'lb.Recovery': '恢复',
    'lb.Cleanup': '清理',
    'lb.Last error': '最后错误',
    'lb.Max concurrency': '最大并发',
    'lb.Current frontier': '当前前沿',
    'lb.Selected preflight wave': '选定预检波次',
    'lb.Write-intent conflicts': '写入意图冲突',
    'lb.Intent coverage': '意图覆盖',
    'lb.Recovery classifications': '恢复分类',
    'lb.Integration': '集成',
    'lb.Integration facts': '集成事实',
    'lb.Review': '评审',
    'lb.Review history': '评审历史',
    'lb.Aggregate commit': '聚合提交',
    'lb.Applied refs': '已应用引用',
    'lb.Review worktree': '评审 worktree',
    'lb.Branch': '分支',
    'lb.Conflicts': '冲突',
    'lb.Frontier': '前沿',
    'lb.Selected wave': '选定波次',
    'lb.Scope policy': '范围策略',
    'lb.Risks': '风险',
    'lb.Estimated resources': '资源估算',
    'lb.Base commit': '基础提交',
    'lb.Commit': '提交',
    'lb.Frontier & preflight wave': '前沿与预检波次',
    'lb.Conflicts & scope audit': '冲突与范围审计',
    'lb.Integration & review': '集成与评审',
    'generic.copy': '复制',
    'subtask.dependsOn': '依赖',
    'subtask.writeIntent': '写入意图（可选）',
    'subtask.remove': '移除',
  },
};

const STATUS_I18N = {
  'en-US': {
    CREATED: 'Created', PLANNING: 'Planning', SPEC_READY: 'Spec ready',
    IMPLEMENTING: 'Implementing', WAITING_IMPLEMENTER: 'Waiting for implementer',
    REVIEWING: 'Reviewing', CHANGES_REQUESTED: 'Changes requested', APPROVED: 'Approved',
    ERROR: 'Error', STOPPED: 'Stopped', RUNNING: 'Running', SUCCEEDED: 'Succeeded',
    FAILED: 'Failed', BLOCKED: 'Blocked', WAITING: 'Waiting', READY: 'Ready',
    REVIEW_APPROVED: 'Review approved', IDLE: 'Idle', BUSY: 'Busy', AVAILABLE: 'Available',
    UNAVAILABLE: 'Unavailable', UNKNOWN: 'Unknown', STARTING: 'Starting',
    RECOVERING: 'Recovering', RECOVERED: 'Recovered', REVIEW: 'Review', PLANNED: 'Planned',
    QUEUED: 'Queued', SESSION_STARTED: 'Session started',
  },
  'zh-CN': {
    CREATED: '已创建', PLANNING: '规划中', SPEC_READY: '规格就绪',
    IMPLEMENTING: '实现中', WAITING_IMPLEMENTER: '等待实现者',
    REVIEWING: '评审中', CHANGES_REQUESTED: '已请求修改', APPROVED: '已批准',
    ERROR: '出错', STOPPED: '已停止', RUNNING: '运行中', SUCCEEDED: '已成功',
    FAILED: '失败', BLOCKED: '受阻', WAITING: '等待中', READY: '就绪',
    REVIEW_APPROVED: '评审通过', IDLE: '空闲', BUSY: '忙碌', AVAILABLE: '可用',
    UNAVAILABLE: '不可用', UNKNOWN: '未知', STARTING: '启动中',
    RECOVERING: '恢复中', RECOVERED: '已恢复', REVIEW: '评审', PLANNED: '已规划',
    QUEUED: '排队中', SESSION_STARTED: '会话已启动',
  },
};

function t(key, vars = {}) {
  let text = (I18N[locale] && I18N[locale][key]) ?? I18N['en-US'][key] ?? key;
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value));
  }
  return text;
}

function statusText(raw) {
  const key = `${raw ?? ''}`.toUpperCase().replace(/\s+/g, '_');
  if (STATUS_I18N[locale] && STATUS_I18N[locale][key]) return STATUS_I18N[locale][key];
  if (STATUS_I18N['en-US'][key]) return STATUS_I18N['en-US'][key];
  return raw ? `${raw}`.replaceAll('_', ' ') : t('msg.unknownStatus');
}

function eventText(raw) {
  const key = `${raw ?? ''}`.toUpperCase().replace(/\s+/g, '_');
  if (STATUS_I18N[locale] && STATUS_I18N[locale][key]) return STATUS_I18N[locale][key];
  if (STATUS_I18N['en-US'][key]) return STATUS_I18N['en-US'][key];
  if (raw) return `${raw}`.replaceAll('_', ' ');
  return t('msg.unknownEvent');
}

function labelText(label) {
  const text = `${label}`;
  const translated = (I18N[locale] && I18N[locale][`lb.${text}`]) ?? I18N['en-US'][`lb.${text}`];
  return translated ?? text;
}

function applyStaticI18n() {
  document.documentElement.lang = locale === 'zh-CN' ? 'zh-CN' : 'en-US';
  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    element.placeholder = t(element.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(element => {
    element.title = t(element.dataset.i18nTitle);
  });
  // Document title keeps the product anchor "Coordinate Agents Workspace".
  document.title = locale === 'zh-CN' ? 'Coordinate Agents 工作台' : 'Coordinate Agents Workspace';
}

function persistLocale(next) {
  locale = next === 'zh-CN' ? 'zh-CN' : 'en-US';
  try { localStorage.setItem(LOCALE_KEY, locale); } catch { /* storage may be unavailable */ }
  applyStaticI18n();
  renderLanguageControls();
  updateSendLabel();
  setViewHeading(state.currentView);
  renderChatArea();
  refresh();
}

function renderLanguageControls() {
  const zh = document.getElementById('lang-zh');
  const en = document.getElementById('lang-en');
  if (!zh || !en) return;
  zh.setAttribute('aria-pressed', String(locale === 'zh-CN'));
  en.setAttribute('aria-pressed', String(locale === 'en-US'));
}

function detectInitialLocale() {
  let saved = null;
  try { saved = localStorage.getItem(LOCALE_KEY); } catch { /* ignore */ }
  if (saved === 'zh-CN' || saved === 'en-US') return saved;
  const nav = `${navigator.language || ''}`.toLowerCase();
  return nav.startsWith('zh') ? 'zh-CN' : 'en-US';
}

let locale = detectInitialLocale();

const STATUS_ORDER = [
  'CREATED',
  'PLANNING',
  'SPEC_READY',
  'IMPLEMENTING',
  'WAITING_IMPLEMENTER',
  'REVIEWING',
  'CHANGES_REQUESTED',
  'APPROVED',
  'ERROR',
  'STOPPED',
];

/* Local, truthful record of explicit actions performed in this browser
 * session (creation, dispatch, review, …). Never fabricated: each entry is
 * written only after the Runtime acknowledged the operation. */
const localActions = new Map(); // taskId -> array of {label, kind, at}

const state = {
  tasks: [],
  agents: [],
  sessions: [],
  events: [],
  repository: null,
  discovery: null,
  selectedTask: null,
  selectedSubtask: null,
  graphDetail: null,
  currentView: 'chat',
  contextOpen: true,
  detailOpen: false,
  authorOpen: false,
};

const capabilityMeta = document.querySelector('meta[name="coordinate-agents-capability"]');
const workspaceCapability = capabilityMeta?.content && capabilityMeta.content !== '__COORDINATE_AGENTS_CAPABILITY__'
  ? capabilityMeta.content
  : null;

async function postAction(action, params, { correlationId = null } = {}) {
  const response = await fetch('/api/action', {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(workspaceCapability ? { 'x-coordinate-agents-capability': workspaceCapability } : {}),
      ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
    },
    body: JSON.stringify({ action, params, correlationId }),
  });
  return { status: response.status, payload: await response.json() };
}

const elements = Object.fromEntries([
  'tasks', 'task-count', 'agent-flow', 'task-detail', 'detail-title', 'detail-summary',
  'timeline', 'detail-agent-flow', 'evidence', 'spec', 'sessions', 'session-count',
  'events', 'refresh-button', 'close-detail', 'graph-detail', 'graph-topology',
  'graph-frontier', 'graph-conflicts', 'graph-integration', 'repository',
  'repo-name', 'repo-branch', 'repo-facts', 'repo-facts-toggle', 'graph-map-region', 'graph-map',
  'graph-node-detail', 'graph-map-note', 'graph-legend',
  'discover-agents', 'agents-discovery', 'agent-configure', 'cfg-agent',
  'cfg-adapter', 'cfg-command', 'cfg-role', 'apply-agent', 'agent-status',
  'agent-id-options', 'configured-agents',
  'author-empty-agents', 'task-create-form', 'author-task-title', 'author-task-spec',
  'author-task-planner', 'author-task-implementer', 'author-task-reviewer', 'author-task-id',
  'author-task-submit', 'author-task-status', 'graph-create-form', 'author-graph-id',
  'author-graph-title', 'author-graph-spec', 'author-graph-planner', 'author-graph-reviewer',
  'author-graph-max', 'author-graph-intent', 'author-graph-scope', 'author-subtask-add',
  'author-subtask-rows', 'author-graph-validate', 'author-graph-create', 'author-graph-status',
  'author-graph-errors', 'author-graph-validated', 'author-graph-preflight',
  'execution-panel', 'execution-title', 'execution-controls', 'execution-status', 'execution-result',
  'review-panel', 'review-controls', 'review-status', 'review-result',
  'view-title', 'view-subtitle', 'chat-welcome', 'chat-feed', 'recent-list', 'recent-toggle',
  'context-panel', 'context-body', 'context-selection', 'context-toggle', 'context-close',
  'new-task-button', 'composer-input', 'composer-agent', 'composer-mode', 'composer-send',
  'composer-hint', 'composer-status', 'toast-region',
  'drawer-scrim', 'detail-drawer', 'drawer-title', 'drawer-close',
  'author-drawer', 'author-drawer-close', 'chat-scroll',
  'sidebar', 'sidebar-open', 'sidebar-close', 'lang-zh', 'lang-en',
].map(id => [id, document.getElementById(id)]));

function escapeHtml(value) {
  return `${value ?? ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return `${value}`;
  return date.toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en-US');
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return `${value}`;
  return date.toLocaleTimeString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' });
}

function statusClass(status) {
  return `${status || 'UNKNOWN'}`.toLowerCase().replaceAll('_', '-');
}

function statusLabel(status) {
  return statusText(status);
}

function shortId(value) {
  const text = `${value || ''}`;
  return text.length > 18 ? `${text.slice(0, 12)}…${text.slice(-4)}` : text;
}

async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Inspector request failed (${response.status}).`);
  return response.json();
}

/* ------------------------------------------------------------------ */
/* Toast                                                              */
/* ------------------------------------------------------------------ */
function toast(message, kind = 'info', timeout = 4000) {
  const region = elements['toast-region'];
  if (!region) return;
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  region.appendChild(node);
  window.setTimeout(() => {
    node.classList.add('leaving');
    window.setTimeout(() => node.remove(), 300);
  }, timeout);
}

/* ------------------------------------------------------------------ */
/* Navigation & layout                                                */
/* ------------------------------------------------------------------ */
function setViewHeading(view) {
  const title = elements['view-title'];
  const subtitle = elements['view-subtitle'];
  if (title) title.textContent = t(`view.${view}`);
  if (subtitle) subtitle.textContent = t(`view.subtitle${view.charAt(0).toUpperCase()}${view.slice(1)}`);
}

function switchView(view) {
  if (!['chat', 'tasks', 'agents', 'sessions', 'activity'].includes(view)) return;
  state.currentView = view;
  document.querySelectorAll('[data-view-panel]').forEach(panel => {
    const active = panel.dataset.viewPanel === view;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    const active = item.dataset.view === view;
    item.classList.toggle('active', active);
    if (active) item.setAttribute('aria-current', 'true');
    else item.removeAttribute('aria-current');
  });
  setViewHeading(view);
  if (view !== 'chat') {
    closeSidebarIfMobile();
  }
  if (view === 'chat') renderChatArea();
}

function isNarrowSidebar() {
  return window.matchMedia('(max-width: 1024px)').matches;
}

function openSidebar() {
  elements.sidebar?.classList.add('open');
  document.body.classList.add('sidebar-open');
  elements['sidebar-close']?.removeAttribute('hidden');
  if (elements['sidebar-close']) elements['sidebar-close'].focus();
}

function closeSidebarIfMobile() {
  if (!isNarrowSidebar()) return;
  elements.sidebar?.classList.remove('open');
  document.body.classList.remove('sidebar-open');
  if (elements['sidebar-close']) elements['sidebar-close'].hidden = true;
}

function updateContextState() {
  const open = state.contextOpen;
  const panel = elements['context-panel'];
  if (!panel) return;
  const narrow = window.matchMedia('(max-width: 1180px)').matches;
  document.body.classList.toggle('cx-open', open && narrow);
  panel.setAttribute('aria-hidden', String(!open));
  const toggle = elements['context-toggle'];
  if (toggle) toggle.setAttribute('aria-expanded', String(open));
  // Wide layout: hide via the hidden attribute. Narrow layout: the panel
  // slides in/out via the transform controlled by .cx-open.
  panel.hidden = !open && !narrow;
}

function toggleContext() {
  state.contextOpen = !state.contextOpen;
  updateContextState();
}

function openDetailDrawer(focusId = null) {
  state.detailOpen = true;
  elements['detail-drawer'].hidden = false;
  elements['drawer-scrim'].hidden = false;
  document.body.classList.add('drawer-open');
  elements['detail-drawer'].setAttribute('aria-hidden', 'false');
  window.setTimeout(() => {
    const target = focusId ? elements['detail-drawer'].querySelector(`#${CSS.escape(focusId)}`) : null;
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    (elements['drawer-close'] || elements['detail-drawer']).focus();
  }, 30);
}

function openAuthorDrawer() {
  state.authorOpen = true;
  elements['author-drawer'].hidden = false;
  elements['drawer-scrim'].hidden = false;
  document.body.classList.add('drawer-open');
  elements['author-drawer'].setAttribute('aria-hidden', 'false');
  window.setTimeout(() => (elements['author-drawer-close'] || elements['author-drawer']).focus(), 30);
}

function closeTopDrawer() {
  if (state.authorOpen) {
    state.authorOpen = false;
    elements['author-drawer'].hidden = true;
    elements['author-drawer'].setAttribute('aria-hidden', 'true');
  } else if (state.detailOpen) {
    state.detailOpen = false;
    elements['detail-drawer'].hidden = true;
    elements['detail-drawer'].setAttribute('aria-hidden', 'true');
  } else {
    return;
  }
  if (!state.authorOpen && !state.detailOpen) {
    elements['drawer-scrim'].hidden = true;
    document.body.classList.remove('drawer-open');
    if (state.selectedTask) {
      const source = document.querySelector(`[data-task-id="${CSS.escape(state.selectedTask)}"]`);
      source?.focus();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Sidebar & recent list                                              */
/* ------------------------------------------------------------------ */
function renderRecentList() {
  const container = elements['recent-list'];
  if (!container) return;
  const tasks = (state.tasks || []).slice(0, 6);
  const sessions = (state.sessions || []).slice(0, 3);
  if (!tasks.length && !sessions.length) {
    container.innerHTML = `<div class="recent-empty">${escapeHtml(t('empty.recent'))}</div>`;
    return;
  }
  const taskItems = tasks.map(task => `
    <button class="recent-item ${state.selectedTask === task.id ? 'selected' : ''}" type="button"
      data-task-id="${escapeHtml(task.id)}" title="${escapeHtml(task.title || task.id)}">
      <span class="recent-item-type">${task.graph ? 'GRAPH' : 'TASK'}</span>
      <span class="recent-item-main"><strong>${escapeHtml(task.title || task.id)}</strong>
      <span class="recent-item-sub"><span class="state-dot ${statusClass(task.status)}"></span>${escapeHtml(statusText(task.status))}</span></span>
      <time>${escapeHtml(formatTime(task.updatedAt))}</time>
    </button>`).join('');
  const sessionItems = sessions.map(session => `
    <button class="recent-item" type="button" data-session-id="${escapeHtml(session.sessionId)}"
      title="${escapeHtml(session.agent || session.sessionId)}">
      <span class="recent-item-type">SESS</span>
      <span class="recent-item-main"><strong>${escapeHtml(session.agent || shortId(session.sessionId))}</strong>
      <span class="recent-item-sub"><span class="state-dot ${statusClass(session.status)}"></span>${escapeHtml(statusText(session.status))}</span></span>
      <time>${escapeHtml(formatTime(session.lastActivity))}</time>
    </button>`).join('');
  container.innerHTML = (taskItems ? `<div class="recent-group-label">${escapeHtml(t('nav.tasks'))}</div>${taskItems}` : '')
    + (sessionItems ? `<div class="recent-group-label">${escapeHtml(t('nav.sessions'))}</div>${sessionItems}` : '');
  container.querySelectorAll('[data-task-id]').forEach(button => {
    button.addEventListener('click', () => selectTask(button.dataset.taskId));
  });
  container.querySelectorAll('[data-session-id]').forEach(button => {
    button.addEventListener('click', () => selectSession(button.dataset.sessionId));
  });
}

function selectSession(sessionId) {
  switchView('sessions');
  const target = elements.sessions?.querySelector(`[data-session="${CSS.escape(sessionId)}"]`);
  target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target?.focus();
}

/* ------------------------------------------------------------------ */
/* Repository                                                         */
/* ------------------------------------------------------------------ */
function renderRepository() {
  const repository = state.repository;
  if (!repository) {
    elements.repository.hidden = true;
    return;
  }
  elements.repository.hidden = false;
  elements['repo-name'].textContent = repository.name || repository.root || t('repo.repo');
  elements['repo-branch'].textContent = repository.branch || (repository.detached ? t('repo.detached') : '—');
  const facts = [];
  if (repository.head) {
    facts.push(`<div class="repo-fact"><span>${escapeHtml(t('repo.head'))}</span><code>${escapeHtml(repository.head.short || '—')}</code></div>`);
    facts.push(`<div class="repo-fact repo-fact-wide"><span>${escapeHtml(repository.branch ? t('repo.latestOn', { branch: repository.branch }) : t('repo.latest'))}</span><strong>${escapeHtml(repository.head.subject || '—')}</strong></div>`);
    if (repository.head.committedAt) {
      facts.push(`<div class="repo-fact"><span>${escapeHtml(t('repo.committed'))}</span><time>${escapeHtml(formatDate(repository.head.committedAt))}</time></div>`);
    }
  } else {
    facts.push(`<div class="repo-fact"><span>${escapeHtml(t('repo.head'))}</span><code>${escapeHtml(t('repo.noCommits'))}</code></div>`);
  }
  facts.push(`<div class="repo-fact"><span>${escapeHtml(t('repo.remote'))}</span><code>${escapeHtml(repository.remoteUrl || t('repo.noOrigin'))}</code></div>`);
  facts.push(`<div class="repo-fact repo-fact-wide"><span>${escapeHtml(t('repo.boundRoot'))}</span><code>${escapeHtml(repository.root || '—')}</code></div>`);
  if (repository.error) facts.push(`<div class="repo-fact repo-fact-wide"><span>${escapeHtml(t('repo.factsError'))}</span><code>${escapeHtml(repository.error)}</code></div>`);
  elements['repo-facts'].innerHTML = facts.join('');
}

function toggleRepoFacts() {
  const facts = elements['repo-facts'];
  const toggle = elements['repo-facts-toggle'];
  if (!facts || !toggle) return;
  const willShow = facts.hidden;
  facts.hidden = !willShow;
  toggle.textContent = willShow ? t('repo.hideDetails') : t('repo.details');
  toggle.setAttribute('aria-expanded', String(willShow));
}

/* ------------------------------------------------------------------ */
/* Agent discovery / configuration (Agents view)                      */
/* ------------------------------------------------------------------ */
function commandSourceClass(source) {
  const value = `${source || ''}`.toLowerCase();
  if (value.startsWith('project')) return 'project';
  if (value.startsWith('user')) return 'user';
  return 'adapter';
}

function setAgentStatus(message, kind = 'info') {
  const element = elements['agent-status'];
  if (!element) return;
  element.textContent = message;
  element.className = `agent-status ${kind}`;
}

function escapeAgent(value) {
  return escapeHtml(value ?? '');
}

function fillConfigureForm(entry) {
  const agentId = entry.configuredAgent || entry.agent || entry.command || '';
  elements['cfg-agent'].value = agentId;
  elements['cfg-command'].value = entry.command || '';
  if (entry.adapter) elements['cfg-adapter'].value = entry.adapter;
  elements['cfg-role'].value = 'implementer';
  elements['agent-configure'].scrollIntoView({ behavior: 'smooth', block: 'center' });
  elements['cfg-agent'].focus();
}

function renderAgentsDiscovery(snapshot) {
  if (!snapshot) {
    elements['agents-discovery'].innerHTML = `<div class="empty-state">${escapeHtml(t('empty.discovery'))}</div>`;
    return;
  }
  const agents = Array.isArray(snapshot.agents) ? snapshot.agents : [];
  const adapters = Array.isArray(snapshot.adapters) ? snapshot.adapters : [];
  const options = [];
  for (const agent of agents) {
    const identity = agent.configuredAgent || agent.command || '';
    if (identity) options.push(`<option value="${escapeHtml(identity)}"></option>`);
  }
  elements['agent-id-options'].innerHTML = options.join('');

  const agentRows = agents.map(agent => {
    const available = agent.available === true;
    const identity = agent.configuredAgent || agent.command || '?';
    return `<article class="agent-row">
      <div class="agent-row-main">
        <strong>${escapeAgent(identity)}</strong>
        <span class="status-pill ${available ? 'idle' : 'error'}">${available ? escapeHtml(t('agents.available')) : escapeHtml(t('agents.unavailable'))}</span>
        ${agent.configured ? `<span class="history-label">${escapeHtml(t('agents.configuredPill'))}</span>` : ''}
        ${agent.adapter ? `<span class="agent-muted">${escapeHtml(t('agents.adapterOf', { adapter: agent.adapter }))}</span>` : ''}
        ${agent.command ? `<span class="agent-muted">${escapeHtml(t('agents.commandOf', { command: agent.command }))}<code>${escapeAgent(agent.command)}</code></span>` : ''}
      </div>
      <div class="agent-row-detail">${escapeAgent(agent.details || agent.code || '')}</div>
      <button class="button ghost agent-fill" type="button" data-json="${escapeHtml(JSON.stringify({ agent: identity, command: agent.command, adapter: agent.adapter || '' }))}">${escapeHtml(t('agents.configureThis'))}</button>
    </article>`;
  }).join('') || `<div class="empty-state">${escapeHtml(t('empty.discoveryAgents'))}</div>`;

  const adapterBlocks = adapters.map(adapter => {
    const capabilities = Object.entries(adapter.capabilities || {})
      .filter(([, value]) => value === true)
      .map(([key]) => escapeHtml(key))
      .join(', ');
    const configured = (adapter.configuredAgents || []).map(item => `
      <div class="configured-agent-row">
        <code>${escapeAgent(item.id)}</code>
        <span class="agent-muted">${escapeHtml(t('agents.adapterOf', { adapter: item.adapter || adapter.id }))}</span>
        <code>${escapeAgent(item.command || '—')}</code>
        <span class="source-badge ${commandSourceClass(item.commandSource)}">${escapeAgent(item.commandSource || 'adapter-default')}</span>
      </div>`).join('') || `<span class="agent-muted">${escapeHtml(t('agents.notConfiguredHere'))}</span>`;
    return `<article class="adapter-card">
      <div class="adapter-card-heading">
        <strong>${escapeAgent(adapter.id)}</strong>
        <span class="history-label">${adapter.builtin ? escapeHtml(t('agents.builtin')) : escapeHtml(t('agents.localAdapter'))}</span>
        <span class="agent-muted">contract v${escapeAgent(adapter.contractVersion)}</span>
      </div>
      <div class="agent-muted">${capabilities || escapeHtml(t('agents.noCapabilities'))}</div>
      <div class="configured-agents-list">${configured}</div>
    </article>`;
  }).join('');

  elements['agents-discovery'].innerHTML = `
    <div class="discovery-grid">
      <div><h3>${escapeHtml(t('lb.Detected coding CLIs'))}</h3><div class="discovery-list">${agentRows}</div></div>
      <div><h3>${escapeHtml(t('lb.Adapters & command sources'))}</h3><div class="discovery-list">${adapterBlocks || `<div class="empty-state">${escapeHtml(t('empty.discoveryAdapters'))}</div>`}</div></div>
    </div>`;
  elements['agents-discovery'].querySelectorAll('.agent-fill').forEach(button => {
    button.addEventListener('click', () => {
      try { fillConfigureForm(JSON.parse(button.dataset.json)); } catch { /* ignore malformed presets */ }
    });
  });
}

function renderConfiguredAgents(agents) {
  const list = Array.isArray(agents) ? agents : [];
  if (list.length === 0) {
    elements['configured-agents'].innerHTML = `<div class="empty-state">${escapeHtml(t('empty.configuredAgents'))}</div>`;
    return;
  }
  elements['configured-agents'].innerHTML = list.map(agent => `
    <article class="configured-agent">
      <div class="configured-agent-head">
        <strong>${escapeAgent(agent.id)}</strong>
        <span class="status-pill ${statusClass(agent.status)}">${escapeHtml(statusText(agent.status))}</span>
      </div>
      <div class="configured-agent-facts">
        <span>${escapeHtml(t('agents.adapterOf', { adapter: agent.adapter || '—' }))}</span>
        <span>${escapeHtml(t('agents.roles'))} <code>${escapeAgent(agent.roles?.join(', ') || t('agents.unassigned'))}</code></span>
        <span>${escapeHtml(t('agents.queue', { new: agent.queue?.new || 0, processing: agent.queue?.processing || 0 }))}</span>
      </div>
      ${agent.lastActivity ? `<div class="agent-muted">${escapeHtml(t('agents.lastActivity', { activity: agent.lastActivity }))}</div>` : ''}
    </article>`).join('');
}

function authorAgentIds() {
  return Array.isArray(state.agents) ? state.agents.map(agent => agent.id).filter(Boolean) : [];
}

function refreshAgentSelects() {
  const ids = authorAgentIds();
  elements['author-empty-agents'].hidden = ids.length > 0;
  const selects = [
    'author-task-planner', 'author-task-implementer', 'author-task-reviewer',
    'author-graph-planner', 'author-graph-reviewer',
  ];
  const emptyLabel = t('roles.noneConfigured');
  const options = ids.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join('');
  for (const name of selects) {
    const element = elements[name];
    if (!element) continue;
    const previous = element.value;
    element.innerHTML = options || `<option value="">${escapeHtml(emptyLabel)}</option>`;
    if (previous && ids.includes(previous)) element.value = previous;
    else if (element.name === 'implementer' && ids.includes('antigravity')) element.value = 'antigravity';
  }
  document.querySelectorAll('[data-implementer-select]').forEach(select => {
    if (!select) return;
    const previous = select.value;
    select.innerHTML = options || `<option value="">${escapeHtml(emptyLabel)}</option>`;
    if (previous && ids.includes(previous)) select.value = previous;
  });
}

function addSubtaskRow(preset = {}) {
  const row = document.createElement('div');
  row.className = 'subtask-row';
  row.innerHTML = `
    <label>ID<input class="sub-id" maxlength="64" placeholder="sub-a" value="${escapeHtml(preset.id || '')}"></label>
    <label>${escapeHtml(t('author.graphTitleLabel'))}<input class="sub-title" maxlength="1024" placeholder="${escapeHtml(preset.title || '')}"></label>
    <label>${escapeHtml(t('roles.implementer'))}<select class="sub-implementer" data-implementer-select></select></label>
    <label>${escapeHtml(t('author.specLabel'))}<input class="sub-spec" maxlength="262144" placeholder="What this subtask must change"></label>
    <label>${escapeHtml(t('subtask.dependsOn'))}<input class="sub-depends" maxlength="1024" placeholder="sub-a sub-b (ids)"></label>
    <label>${escapeHtml(t('subtask.writeIntent'))}<input class="sub-intent" maxlength="2048" placeholder="src/a/** docs/a/**"></label>
    <button class="button ghost sub-remove" type="button" aria-label="Remove subtask">${escapeHtml(t('subtask.remove'))}</button>`;
  row.querySelector('.sub-remove').addEventListener('click', () => row.remove());
  elements['author-subtask-rows'].appendChild(row);
  refreshAgentSelects();
  return row;
}

function readSubtaskRows() {
  return [...elements['author-subtask-rows'].querySelectorAll('.subtask-row')].map(row => {
    const splitList = value => (value || '').split(/[\s,]+/).map(item => item.trim()).filter(Boolean);
    return {
      id: row.querySelector('.sub-id').value.trim(),
      title: row.querySelector('.sub-title').value.trim(),
      implementer: row.querySelector('.sub-implementer').value,
      spec: row.querySelector('.sub-spec').value.trim(),
      dependsOn: splitList(row.querySelector('.sub-depends').value),
      writeIntent: splitList(row.querySelector('.sub-intent').value),
    };
  });
}

function setGraphStatus(message, kind = 'info') {
  const element = elements['author-graph-status'];
  if (!element) return;
  element.textContent = message;
  element.className = `author-status ${kind}`;
}

function graphInputs() {
  const parentId = elements['author-graph-id'].value.trim();
  const subtasks = readSubtaskRows();
  const intentEnabled = elements['author-graph-intent'].checked;
  const parentTask = {
    id: parentId,
    title: elements['author-graph-title'].value.trim(),
    planner: elements['author-graph-planner'].value,
    reviewer: elements['author-graph-reviewer'].value,
  };
  const spec = elements['author-graph-spec'].value.trim();
  if (spec) parentTask.spec = spec;
  const graph = {
    schemaVersion: 1,
    parentTask,
    subtasks: subtasks.map(item => {
      const subtask = {
        id: item.id,
        implementer: item.implementer,
        spec: item.spec,
        dependsOn: item.dependsOn,
      };
      if (item.title) subtask.title = item.title;
      return subtask;
    }),
    maxConcurrency: Math.max(1, Math.min(32, Number(elements['author-graph-max'].value) || 1)),
  };
  let intentMap = null;
  if (intentEnabled) {
    intentMap = {
      schemaVersion: 1,
      parentTaskId: parentId,
      scopePolicy: elements['author-graph-scope'].value || 'warn',
      subtasks: subtasks.map(item => ({ id: item.id, writeIntent: item.writeIntent })),
    };
  }
  return { graph, intentMap, parentId };
}

function renderActionError(container, payload) {
  const error = payload?.error || {};
  container.innerHTML = `<div class="empty-state error-state">${escapeHtml(error.code || 'ACTION_FAILED')} — ${escapeHtml(error.message || t('generic.error'))}${error.details ? `<div>${escapeHtml(error.details)}</div>` : ''}</div>`;
  container.hidden = false;
}

async function validateGraphNow() {
  elements['author-graph-errors'].hidden = true;
  elements['author-graph-validated'].hidden = true;
  const { graph, intentMap } = graphInputs();
  if (!graph.parentTask.title || !graph.subtasks.length) {
    setGraphStatus('Graph title, parent ID, and at least one subtask are required.', 'error');
    return;
  }
  setGraphStatus(t('generic.validating'));
  try {
    const { status, payload } = await postAction('taskGraphValidate', {
      graph,
      ...(intentMap ? { intentMap } : {}),
    });
    if (status !== 200 || payload?.ok !== true) {
      renderActionError(elements['author-graph-errors'], payload);
      setGraphStatus('Validation failed.', 'error');
      return;
    }
    const count = payload.subtaskCount ?? payload.subtasks?.length ?? 'ok';
    elements['author-graph-validated'].innerHTML = `<div class="author-ok-banner">${escapeHtml(t('author.validated', { count }))} ${payload.missingIntentCoverage ? escapeHtml(t('author.missingIntent')) : escapeHtml(t('author.intentPresent'))} · scope ${escapeHtml(payload.scopePolicy || payload.intentCoverage?.scopePolicy || '—')}</div>`;
    elements['author-graph-validated'].hidden = false;
    setGraphStatus(t('author.validatedOk'), 'ok');
  } catch (error) {
    setGraphStatus(`Validation request failed: ${error.message}`, 'error');
  }
}

async function showGraphPreflight(taskId) {
  const region = elements['author-graph-preflight'];
  region.hidden = false;
  region.innerHTML = `<div class="empty-state">${escapeHtml(t('generic.loading'))}</div>`;
  try {
    const { status, payload } = await postAction('taskGraphPlan', { taskId });
    if (status !== 200 || payload?.ok !== true) {
      region.innerHTML = `<div class="empty-state error-state">${escapeHtml(t('author.preflightFailed'))}: ${escapeHtml(payload?.error?.message || `HTTP ${status}`)}</div>`;
      return;
    }
    const plan = payload.plan && typeof payload.plan === 'object' ? payload.plan : {};
    region.innerHTML = `
      <h3>${escapeHtml(t('author.preflightTitle'))}</h3>
      <div class="preflight-grid">
        ${factBlock('Frontier', payload.frontier)}
        ${factBlock('Selected wave', plan.wave)}
        ${factBlock('Write-intent conflicts', plan.conflicts)}
        ${factBlock('Intent coverage', plan.intentCoverage || payload.intentCoverage)}
        ${factBlock('Scope policy', plan.scopePolicy || payload.scopePolicy)}
        ${factBlock('Risks', plan.risks)}
        ${factBlock('Estimated resources', plan.resourceEstimates)}
      </div>`;
  } catch (error) {
    region.innerHTML = `<div class="empty-state error-state">${escapeHtml(t('author.preflightFailed'))}: ${escapeHtml(error.message)}</div>`;
  }
}

async function createGraphNow() {
  const { graph, intentMap, parentId } = graphInputs();
  if (!graph.parentTask.id || !graph.parentTask.title || !graph.subtasks.length) {
    setGraphStatus('Parent ID, title, and at least one subtask are required.', 'error');
    return;
  }
  setGraphStatus(t('author.creatingGraph'));
  elements['author-graph-create'].disabled = true;
  try {
    const { status, payload } = await postAction('taskGraphCreate', {
      graph,
      ...(intentMap ? { intentMap } : {}),
    });
    if (status !== 200 || payload?.ok !== true) {
      renderActionError(elements['author-graph-errors'], payload);
      setGraphStatus(t('author.createFailed'), 'error');
      return;
    }
    const createdId = payload.parentTaskId || payload.graphId || parentId;
    setGraphStatus(`${escapeHtml(t('author.createdGraph', { id: createdId }))} (${escapeHtml(statusText(payload.state || payload.status || 'CREATED'))}). ${escapeHtml(t('author.loadingPreflight'))}`, 'ok');
    await showGraphPreflight(createdId);
    await refresh();
  } catch (error) {
    setGraphStatus(`Create request failed: ${error.message}`, 'error');
  } finally {
    elements['author-graph-create'].disabled = false;
  }
}

async function createSingleTask(event) {
  event.preventDefault();
  const params = {
    title: elements['author-task-title'].value.trim(),
    spec: elements['author-task-spec'].value.trim() || undefined,
    planner: elements['author-task-planner'].value || undefined,
    implementer: elements['author-task-implementer'].value || undefined,
    reviewer: elements['author-task-reviewer'].value || undefined,
  };
  const id = elements['author-task-id'].value.trim();
  if (id) params.id = id;
  const statusNode = elements['author-task-status'];
  if (!params.title) {
    statusNode.textContent = t('composer.titleRequired');
    statusNode.className = 'author-status error';
    return;
  }
  statusNode.textContent = t('composer.creating');
  try {
    const { status, payload } = await postAction('taskCreate', params);
    if (status !== 200 || payload?.ok !== true) {
      const error = payload?.error || {};
      statusNode.textContent = t('composer.failed', { message: `${error.code || `HTTP ${status}`} — ${error.message || ''}` });
      statusNode.className = 'author-status error';
      return;
    }
    const taskId = payload.task?.id || payload.id;
    statusNode.textContent = t('composer.created', { title: params.title, id: taskId || '' });
    statusNode.className = 'author-status ok';
    elements['author-task-id'].value = '';
    elements['author-task-title'].value = '';
    elements['author-task-spec'].value = '';
    await refresh();
    if (taskId) selectTask(taskId);
  } catch (error) {
    statusNode.textContent = t('composer.failed', { message: error.message });
    statusNode.className = 'author-status error';
  }
}

async function discoverAgents() {
  setAgentStatus(t('agents.discovering'));
  try {
    const { status, payload } = await postAction('setupDiscover', {});
    if (status !== 200 || payload?.ok !== true) {
      const code = payload?.error?.code || `HTTP ${status}`;
      elements['agents-discovery'].innerHTML = `<div class="empty-state error-state">${escapeHtml(t('agents.discoveryFailed', { code, message: payload?.error?.message || 'unknown error' }))}</div>`;
      setAgentStatus(t('generic.failed'), 'error');
      return;
    }
    state.discovery = payload;
    renderAgentsDiscovery(payload);
    setAgentStatus(t('agents.discoveryOk'), 'ok');
  } catch (error) {
    setAgentStatus(`${t('agents.discovering')} ${t('generic.failed')}: ${error.message}`, 'error');
  }
}

async function applyAgentConfigure(event) {
  event.preventDefault();
  const params = {
    agent: elements['cfg-agent'].value.trim(),
    adapter: elements['cfg-adapter'].value,
    command: elements['cfg-command'].value.trim(),
    role: elements['cfg-role'].value,
  };
  if (!params.agent || !params.command) {
    setAgentStatus(t('agents.required'), 'error');
    return;
  }
  setAgentStatus(t('agents.configuring'));
  elements['apply-agent'].disabled = true;
  try {
    const { status, payload } = await postAction('setupConfigure', params);
    if (status !== 200 || payload?.ok !== true) {
      const error = payload?.error || {};
      setAgentStatus(t('agents.configFailed', { message: `${error.code || `HTTP ${status}`} — ${error.message || 'unknown error'}${error.details ? ` (${error.details})` : ''}` }), 'error');
      return;
    }
    const configured = payload.agent || {};
    setAgentStatus(t('agents.configOk', {
      id: configured.id,
      adapter: configured.adapter,
      command: configured.command,
      source: configured.commandSource,
      roles: Object.keys(payload.workflow || {}).join(', '),
    }), 'ok');
    toast(t('agents.configOk', {
      id: configured.id,
      adapter: configured.adapter,
      command: configured.command,
      source: configured.commandSource,
      roles: Object.keys(payload.workflow || {}).join(', '),
    }), 'ok');
    await discoverAgents();
    await refresh();
  } catch (error) {
    setAgentStatus(`${t('agents.configFailed', { message: error.message })}`, 'error');
  } finally {
    elements['apply-agent'].disabled = false;
  }
}

function agentFor(id) {
  return state.agents.find(agent => agent.id === id) || { id, status: 'UNKNOWN', adapter: '—', roles: [] };
}

function renderAgentFlow() {
  const roles = ['planner', 'implementer', 'reviewer'];
  elements['agent-flow'].innerHTML = roles.map((role, index) => {
    const configured = state.agents.find(agent => agent.roles?.includes(role));
    const agent = configured || { id: t('roles.unassigned'), status: 'UNKNOWN', adapter: '—', roles: [] };
    return `
      <div class="flow-node">
        <span class="flow-role">${escapeHtml(role)}</span>
        <strong>${escapeHtml(agent.id)}</strong>
        <span class="status-line"><span class="state-dot ${statusClass(agent.status)}"></span>${escapeHtml(statusText(agent.status))}</span>
        <span class="adapter">${escapeHtml(agent.adapter)}</span>
      </div>
      ${index < roles.length - 1 ? '<span class="flow-arrow" aria-hidden="true">→</span>' : ''}
    `;
  }).join('');
}

/* ------------------------------------------------------------------ */
/* Sessions (Sessions view)                                           */
/* ------------------------------------------------------------------ */
function renderSessions() {
  elements['session-count'].textContent = state.sessions.length;
  if (state.sessions.length === 0) {
    elements.sessions.innerHTML = `<div class="empty-state">${escapeHtml(t('empty.sessions'))}</div>`;
    return;
  }
  elements.sessions.innerHTML = state.sessions.map(session => `
    <article class="session-card" data-session="${escapeHtml(session.sessionId)}">
      <div class="session-header">
        <div>
          <span class="eyebrow">${escapeHtml(session.agent || t('chat.runtime'))}</span>
          <h3>${escapeHtml(shortId(session.sessionId))}</h3>
        </div>
        <span class="status-pill ${statusClass(session.status)}">${escapeHtml(statusText(session.status))}</span>
      </div>
      <div class="session-meta"><span>${escapeHtml(t('msg.created', { time: formatDate(session.createdAt) }))}</span><span>${escapeHtml(t('msg.lastActivity', { time: formatDate(session.lastActivity) }))}</span></div>
      <pre class="session-output">${escapeHtml(session.recentOutput || t('msg.noOutput'))}</pre>
      ${session.taskIds?.length ? `<div class="session-tasks">${escapeHtml(t('session.tasks', { tasks: session.taskIds.join(', ') }))}</div>` : ''}
      ${['starting', 'running', 'idle', 'busy'].includes(session.status) ? `
      <div class="session-controls">
        <form class="session-input-form" data-session="${escapeHtml(session.sessionId)}">
          <input class="session-input-text" maxlength="4096" placeholder="${escapeHtml(t('session.inputPh'))}">
          <button class="button" type="submit">${escapeHtml(t('session.send'))}</button>
        </form>
        <button class="button ghost session-close-btn" type="button" data-session="${escapeHtml(session.sessionId)}">${escapeHtml(t('session.close'))}</button>
      </div>` : ''}
      <span class="session-control-status" data-session="${escapeHtml(session.sessionId)}" aria-live="polite"></span>
      <div class="session-history">
        <span class="history-label">${session.historySource === 'recorded' ? escapeHtml(t('session.recorded')) : escapeHtml(t('session.derived'))}</span>
        ${(session.events || []).slice(-8).map(event => `<div><code>${event.sequence ? `#${escapeHtml(event.sequence)}` : '—'}</code><strong>${escapeHtml(eventText(event.event))}</strong><time>${escapeHtml(formatDate(event.timestamp))}</time></div>`).join('')}
      </div>
    </article>
  `).join('');
}

/* ------------------------------------------------------------------ */
/* Events (Activity view)                                             */
/* ------------------------------------------------------------------ */
function renderEvents() {
  if (state.events.length === 0) {
    elements.events.innerHTML = `<div class="empty-state">${escapeHtml(t('empty.events'))}</div>`;
    return;
  }
  elements.events.innerHTML = state.events.map(event => `
    <article class="event-row">
      <time>${event.sequence ? `#${escapeHtml(event.sequence)} · ` : ''}${escapeHtml(formatDate(event.timestamp))}</time>
      <span class="event-marker ${statusClass(event.event)}"></span>
      <div class="event-body">
        <div class="event-title"><strong>${escapeHtml(eventText(event.event))}</strong><span>${escapeHtml([event.agent || event.from || t('chat.runtime'), event.sessionId ? shortId(event.sessionId) : null].filter(Boolean).join(' · '))}</span></div>
        <div class="event-details">${escapeHtml(event.details || '—')}</div>
        ${event.taskId ? `<button class="event-task" data-task-id="${escapeHtml(event.taskId)}" type="button">${escapeHtml(event.taskId)}</button>` : ''}
        <span class="history-label">${event.recorded ? escapeHtml(t('msg.recordedEvent')) : escapeHtml(t('msg.legacyHistory'))}</span>
      </div>
    </article>
  `).join('');
  elements.events.querySelectorAll('[data-task-id]').forEach(button => {
    button.addEventListener('click', () => selectTask(button.dataset.taskId));
  });
}

/* ------------------------------------------------------------------ */
/* Tasks view grid                                                    */
/* ------------------------------------------------------------------ */
function renderTasks() {
  elements['task-count'].textContent = state.tasks.length;
  if (state.tasks.length === 0) {
    elements.tasks.innerHTML = `<div class="empty-state">${escapeHtml(t('empty.tasks'))}</div>`;
    return;
  }
  elements.tasks.innerHTML = state.tasks.map(task => `
    <button class="task-card ${task.graph ? 'graph-card' : ''} ${state.selectedTask === task.id ? 'selected' : ''}" data-task-id="${escapeHtml(task.id)}" type="button">
      <span class="task-card-top"><span class="task-id">${escapeHtml(shortId(task.id))}</span><span class="round">${task.graph ? 'GRAPH' : escapeHtml(t('tasks.cardRound', { round: task.round }))}</span></span>
      <strong>${escapeHtml(task.title)}</strong>
      <span class="status-pill ${statusClass(task.status)}">${escapeHtml(statusText(task.status))}</span>
      ${task.graph ? `<span class="graph-card-meta">${escapeHtml(t('msg.graphSubtask', { n: task.subtaskCount }))} · ${escapeHtml(t('msg.concurrency', { n: task.maxConcurrency }))}</span>` : ''}
      <span class="task-updated">${escapeHtml(t('msg.updated', { time: formatDate(task.updatedAt) }))}</span>
    </button>
  `).join('');
  elements.tasks.querySelectorAll('[data-task-id]').forEach(button => {
    button.addEventListener('click', () => selectTask(button.dataset.taskId));
  });
}

/* ------------------------------------------------------------------ */
/* Task detail renderers (used by the detail drawer)                  */
/* ------------------------------------------------------------------ */
function renderTimeline(timeline = []) {
  if (timeline.length === 0) {
    elements.timeline.innerHTML = `<div class="empty-state">${escapeHtml(t('empty.detailTimeline'))}</div>`;
    return;
  }
  elements.timeline.innerHTML = timeline.map((event, index) => `
    <div class="timeline-item ${event.status ? 'has-status' : ''}">
      <div class="timeline-rail"><span class="timeline-dot ${event.status ? statusClass(event.status) : ''}"></span>${index < timeline.length - 1 ? '<span class="timeline-line"></span>' : ''}</div>
      <div class="timeline-content">
        <div class="timeline-title"><strong>${event.sequence ? `#${escapeHtml(event.sequence)} ` : ''}${escapeHtml(event.status ? statusText(event.status) : eventText(event.event))}</strong><time>${escapeHtml(formatDate(event.timestamp))}</time></div>
        <div class="timeline-meta">${escapeHtml(event.agent || t('chat.runtime'))} · ${event.recorded ? escapeHtml(t('msg.recordedEvent')) : escapeHtml(t('msg.legacyHistory'))}${event.sessionId ? ` · ${escapeHtml(shortId(event.sessionId))}` : ''}</div>
        ${event.details ? `<p>${escapeHtml(event.details)}</p>` : ''}
      </div>
    </div>
  `).join('');
}

function compactJson(value) {
  return escapeHtml(JSON.stringify(value ?? null, null, 2));
}

function factBlock(label, value) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return '';
  const rendered = typeof value === 'object' ? `<pre>${compactJson(value)}</pre>` : `<code>${escapeHtml(value)}</code>`;
  return `<div class="graph-fact"><span>${escapeHtml(labelText(label))}</span>${rendered}</div>`;
}

const GRAPH_MAP_MAX_NODES = 120;
const GRAPH_MAP_STATES = ['READY', 'WAITING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'STOPPED'];
const GRAPH_MAP_NODE_W = 176;
const GRAPH_MAP_NODE_H = 58;
const GRAPH_MAP_GAP_X = 64;
const GRAPH_MAP_GAP_Y = 16;
const GRAPH_MAP_PAD = 12;

function renderGraphLegend() {
  elements['graph-legend'].innerHTML = GRAPH_MAP_STATES
    .map(state => `<span class="legend-item"><i class="legend-dot ${statusClass(state)}"></i>${escapeHtml(statusText(state))}</span>`)
    .join('');
}

function graphNodeLevels(subtasks, dependencies) {
  const levels = new Map(subtasks.map(item => [item.id, 0]));
  const edges = (dependencies || []).filter(edge => levels.has(edge.from) && levels.has(edge.to));
  for (let pass = 0; pass <= subtasks.length; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const candidate = levels.get(edge.from) + 1;
      if (candidate > levels.get(edge.to)) {
        levels.set(edge.to, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { levels, edges };
}

function renderGraphNodeDetail(detail, subtaskId) {
  const subtask = (detail.subtasks || []).find(item => item.id === subtaskId);
  if (!subtask) {
    elements['graph-node-detail'].innerHTML = '';
    return;
  }
  const agent = subtask.agent || {};
  const blocks = [
    `<div class="graph-node-detail-heading"><span class="eyebrow">${escapeHtml(subtask.id)}</span>
       <span class="status-pill ${statusClass(subtask.state)}">${escapeHtml(statusText(subtask.state))}</span>
       <button class="button ghost graph-node-close" type="button" aria-label="Close subtask detail">${escapeHtml(t('drawer.close'))}</button></div>`,
    `<p class="graph-node-detail-title">${escapeHtml(subtask.title || subtask.id)}</p>`,
    factBlock('Specification', subtask.spec),
    `<div class="graph-dependencies">${escapeHtml(t('lb.Depends on'))}: ${subtask.dependsOn?.length ? subtask.dependsOn.map(item => `<code>${escapeHtml(item)}</code>`).join(' ') : `<span>${escapeHtml(t('empty.dependencies'))}</span>`}</div>`,
    `<div class="graph-node-meta"><span>${escapeHtml(t('msg.agent'))} <strong>${escapeHtml(subtask.implementer || '—')}</strong></span><span>Adapter <strong>${escapeHtml(agent.adapter || '—')}</strong></span><span>Registered <strong>${agent.registered === true ? 'yes' : 'no'}</strong></span><span>${escapeHtml(t('msg.session'))} <code>${escapeHtml(shortId(subtask.sessionId) || '—')}</code></span></div>`,
    factBlock('Executable', subtask.executable),
    factBlock('Worktree / branch / commit', { ...(subtask.worktree || {}), implementationCommit: subtask.implementationCommit }),
    factBlock('Evidence', subtask.evidence),
    factBlock('Scope audit', subtask.scopeAudit),
    factBlock('Recovery', subtask.recovery),
    factBlock('Cleanup', subtask.cleanup),
    factBlock('Last error', subtask.lastError),
  ];
  elements['graph-node-detail'].innerHTML = blocks.join('');
  elements['graph-node-detail'].querySelector('.graph-node-close')?.addEventListener('click', () => {
    state.selectedSubtask = null;
    renderGraphMap(detail);
  });
}

function renderGraphMap(detail) {
  state.graphDetail = detail;
  const subtasks = Array.isArray(detail?.subtasks) ? detail.subtasks : [];
  elements['graph-map-note'].textContent = '';
  if (!subtasks.length) {
    elements['graph-map'].innerHTML = `<div class="empty-state error-state">${escapeHtml(t('empty.graphNoReadable'))}</div>`;
    elements['graph-node-detail'].innerHTML = '';
    return;
  }
  const { levels, edges } = graphNodeLevels(subtasks, detail.dependencies || []);
  const truncated = subtasks.length > GRAPH_MAP_MAX_NODES;
  const visible = truncated ? subtasks.slice(0, GRAPH_MAP_MAX_NODES) : subtasks;
  if (truncated) {
    elements['graph-map-note'].textContent = t('graph.largeGraph', { max: GRAPH_MAP_MAX_NODES, total: subtasks.length });
  }

  const maxLevel = Math.max(0, ...visible.map(item => levels.get(item.id) || 0));
  const columns = [];
  for (let level = 0; level <= maxLevel; level += 1) {
    columns.push(visible.filter(item => (levels.get(item.id) || 0) === level));
  }
  const rowByLevel = new Map(columns.map((column, level) => [level, new Map(column.map((item, row) => [item.id, row]))]));
  const totalWidth = GRAPH_MAP_PAD * 2 + (maxLevel + 1) * GRAPH_MAP_NODE_W + maxLevel * GRAPH_MAP_GAP_X;
  const maxRows = Math.max(1, ...columns.map(column => column.length));
  const totalHeight = GRAPH_MAP_PAD * 2 + maxRows * GRAPH_MAP_NODE_H + (maxRows - 1) * GRAPH_MAP_GAP_Y;

  const nodeRect = new Map();
  const nodes = visible.map(item => {
    const level = levels.get(item.id) || 0;
    const row = rowByLevel.get(level).get(item.id);
    const x = GRAPH_MAP_PAD + level * (GRAPH_MAP_NODE_W + GRAPH_MAP_GAP_X);
    const y = GRAPH_MAP_PAD + row * (GRAPH_MAP_NODE_H + GRAPH_MAP_GAP_Y);
    nodeRect.set(item.id, { x, y });
    const selected = state.selectedSubtask === item.id;
    return `<button type="button" class="graph-map-node ${statusClass(item.state)}${selected ? ' selected' : ''}"
      data-subtask="${escapeHtml(item.id)}" style="left:${x}px;top:${y}px;width:${GRAPH_MAP_NODE_W}px;height:${GRAPH_MAP_NODE_H}px"
      aria-pressed="${selected}" aria-label="${escapeHtml(t('graph.nodeLabel', { id: item.id, title: item.title || item.id, state: statusText(item.state) }))}">
      <span class="graph-map-node-title">${escapeHtml(item.title || item.id)}</span>
      <span class="graph-map-node-meta"><code>${escapeHtml(item.id)}</code><i class="state-dot ${statusClass(item.state)}"></i>${escapeHtml(statusText(item.state))}</span>
    </button>`;
  }).join('');

  const arrows = edges.map(edge => {
    const from = nodeRect.get(edge.from);
    const to = nodeRect.get(edge.to);
    if (!from || !to) return '';
    const x1 = from.x + GRAPH_MAP_NODE_W;
    const y1 = from.y + GRAPH_MAP_NODE_H / 2;
    const x2 = to.x;
    const y2 = to.y + GRAPH_MAP_NODE_H / 2;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="graph-map-edge" marker-end="url(#graph-map-arrow)"></line>`;
  }).join('');
  const edgeLayer = visible.length > 1 ? `
    <svg class="graph-map-edges" width="${totalWidth}" height="${totalHeight}" aria-hidden="true">
      <defs><marker id="graph-map-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>
      ${arrows}
    </svg>` : '';

  elements['graph-map'].innerHTML = `<div class="graph-map-canvas" style="width:${totalWidth}px;height:${totalHeight}px">${edgeLayer}${nodes}</div>`;
  elements['graph-map'].querySelectorAll('[data-subtask]').forEach(button => {
    button.addEventListener('click', () => {
      state.selectedSubtask = button.dataset.subtask;
      renderGraphMap(detail);
      renderGraphNodeDetail(detail, state.selectedSubtask);
    });
  });
  if (state.selectedSubtask && subtasks.some(item => item.id === state.selectedSubtask)) {
    renderGraphNodeDetail(detail, state.selectedSubtask);
  } else {
    elements['graph-node-detail'].innerHTML = `<div class="empty-state">${escapeHtml(t('empty.selectNode'))}</div>`;
  }
  elements['graph-map-region'].hidden = false;
}

function closeGraphMap() {
  state.selectedSubtask = null;
  if (state.graphDetail) renderGraphMap(state.graphDetail);
}

function recoveryControls(detail) {
  const graph = Boolean(detail?.graph);
  const detailState = detail?.state || detail?.status;
  const buttons = [];
  const add = (action, label, taskId, extra = '') => buttons.push(
    `<button class="button ghost" type="button" data-run-action="${action}" data-label="${escapeHtml(label)}" data-params="${escapeHtml(JSON.stringify({ taskId: taskId || detail.id }))}">${escapeHtml(label)}</button>${extra}`);
  if (!graph) {
    if (['IMPLEMENTING', 'WAITING_IMPLEMENTER'].includes(detailState)) add('taskStop', t('execution.stopTask'), detail.id);
    if (['ERROR', 'STOPPED'].includes(detailState)) add('taskResume', t('execution.resumeTask'), detail.id);
  } else {
    const note = `<span class="agent-muted">${escapeHtml(t('review.state', { state: detailState || 'unknown' }))}</span>`;
    if (detailState === 'RUNNING') add('taskGraphStop', t('execution.stopGraph'), detail.id, note);
    if (['FAILED', 'RECOVERING'].includes(detailState)) add('taskGraphRecover', t('execution.recoverGraph'), detail.id, note);
    if (['FAILED', 'STOPPED', 'BLOCKED', 'RECOVERING'].includes(detailState)) add('taskGraphResume', t('execution.resumeGraph'), detail.id, note);
    if (['STOPPED', 'FAILED', 'SUCCEEDED', 'APPROVED'].includes(detailState)) add('taskGraphCleanup', t('execution.cleanup'), detail.id, note);
    if (!buttons.length) return `<span class="agent-muted">${escapeHtml(t('execution.noRecovery', { state: detailState || '' }))}</span>`;
  }
  return buttons.length ? `<span class="recovery-sep">${escapeHtml(t('execution.recoverySep'))}</span>${buttons.join(' ')}` : '';
}

function setSessionControlStatus(sessionId, message, kind = 'info') {
  const target = elements.sessions.querySelector(`.session-control-status[data-session="${CSS.escape(sessionId)}"]`);
  if (!target) return;
  target.textContent = message;
  target.className = `session-control-status ${kind}`;
}

async function submitSessionInput(form) {
  const sessionId = form.dataset.session;
  const input = form.querySelector('.session-input-text');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  setSessionControlStatus(sessionId, t('session.sending'));
  try {
    const { status, payload } = await postAction('sessionWrite', { sessionId, input: text });
    if (status !== 200 || payload?.ok !== true) {
      setSessionControlStatus(sessionId, t('session.rejected', { message: `${payload?.error?.code || `HTTP ${status}`} — ${payload?.error?.message || ''}` }), 'error');
      return;
    }
    setSessionControlStatus(sessionId, t('session.sent'), 'ok');
    await refresh();
  } catch (error) {
    setSessionControlStatus(sessionId, t('session.rejected', { message: error.message }), 'error');
  }
}

async function closeOwnedSession(sessionId) {
  setSessionControlStatus(sessionId, t('session.closing'));
  try {
    const { status, payload } = await postAction('sessionClose', { sessionId });
    if (status !== 200 || payload?.ok !== true) {
      setSessionControlStatus(sessionId, t('session.closeRejected', { message: `${payload?.error?.code || `HTTP ${status}`} — ${payload?.error?.message || ''}` }), 'error');
      return;
    }
    setSessionControlStatus(sessionId, t('session.closed'), 'ok');
    await refresh();
  } catch (error) {
    setSessionControlStatus(sessionId, t('session.closeRejected', { message: error.message }), 'error');
  }
}

function bindSessionActions(container) {
  if (!container) return;
  container.querySelectorAll('.session-input-form').forEach(form => {
    form.addEventListener('submit', event => {
      event.preventDefault();
      submitSessionInput(form);
    });
  });
  container.querySelectorAll('.session-close-btn').forEach(button => {
    button.addEventListener('click', () => closeOwnedSession(button.dataset.session));
  });
}

function setExecutionStatus(message, kind = 'info') {
  const element = elements['execution-status'];
  if (!element) return;
  element.textContent = message;
  element.className = `author-status ${kind}`;
}

function renderExecutionResult(label, payload) {
  const region = elements['execution-result'];
  region.hidden = false;
  if (!payload || payload.ok !== true) {
    const error = payload?.error || {};
    region.innerHTML = `<div class="empty-state error-state"><strong>${escapeHtml(t('execution.failed', { label }))}</strong> — ${escapeHtml(error.code || 'ACTION_FAILED')}: ${escapeHtml(error.message || t('generic.error'))}${error.details ? `<div class="execution-detail">${escapeHtml(error.details)}</div>` : ''}</div>`;
    setExecutionStatus(t('execution.failed', { label }) + ' (' + escapeHtml(error.code || 'error') + '). ' + t('msg.actionWillRefresh'), 'error');
    return;
  }
  const pick = keys => keys.map(key => payload[key]).find(value => value !== undefined && value !== null && value !== '');
  const facts = [];
  const show = (labelTextKey, value) => {
    if (value !== undefined && value !== null && value !== '') facts.push(`<div class="execution-fact"><span>${escapeHtml(t(labelTextKey))}</span><code>${escapeHtml(Array.isArray(value) ? value.join(', ') : value)}</code></div>`);
  };
  show('execution.factTask', pick(['taskId', 'parentTaskId', 'id']));
  show('execution.factSubtasks', payload.subtaskIds || payload.subtasks?.length);
  show('execution.factState', pick(['state', 'status']));
  const sessionValue = pick(['sessionId']) || (Array.isArray(payload.sessions) ? payload.sessions.length : undefined);
  show('execution.factSession', sessionValue);
  show('execution.factCommit', pick(['implementationCommit', 'commit', 'aggregateCommit']));
  show('execution.factWaves', payload.wavesExecuted || payload.waveCount);
  show('execution.factStop', payload.stopReason);
  show('execution.factAgent', pick(['agent', 'implementer']));
  region.innerHTML = `<div class="execution-ok"><strong>${escapeHtml(t('execution.completed', { label }))}</strong><div class="execution-facts">${facts.join('') || `<div class="agent-muted">${escapeHtml(t('execution.noSessionFacts'))}</div>`}</div>${payload.error ? `<div class="execution-detail">${escapeHtml(payload.error.message || '')}</div>` : ''}</div>`;
  setExecutionStatus(t('execution.completed', { label }) + '. ' + t('msg.actionWillRefresh'), 'ok');
}

async function runExecutionAction(actionName, params, label) {
  setExecutionStatus(t('execution.executing', { label }));
  const region = elements['execution-result'];
  region.hidden = true;
  try {
    const { status, payload } = await postAction(actionName, params);
    renderExecutionResult(label, status === 200 ? payload : { ok: false, error: { code: `HTTP ${status}`, message: payload?.error?.message || payload?.error || t('generic.error') } });
  } catch (error) {
    setExecutionStatus(t('execution.requestFailed', { label, message: error.message }), 'error');
  }
  await refresh();
}

function executionConfirmRow(labelText) {
  return `<label class="author-toggle execution-confirm-row"><input type="checkbox" class="execution-confirm" data-action-confirm> ${escapeHtml(labelText)}</label>`;
}

function bindExecutionControls(container, detail) {
  const confirm = container.querySelector('.execution-confirm');
  const runButtons = container.querySelectorAll('[data-run-action]');
  const update = () => {
    const armed = confirm ? confirm.checked : true;
    runButtons.forEach(button => { button.disabled = !armed; });
  };
  confirm?.addEventListener('change', update);
  update();
  runButtons.forEach(button => {
    button.addEventListener('click', async () => {
      if (confirm && !confirm.checked) return;
      button.disabled = true;
      try {
        await runExecutionAction(button.dataset.runAction, JSON.parse(button.dataset.params || '{}'), button.dataset.label || 'Execution');
        recordLocalAction(state.selectedTask, button.dataset.label || button.dataset.runAction, 'ok');
      } catch (error) {
        recordLocalAction(state.selectedTask, button.dataset.runAction, 'error');
      } finally {
        if (confirm) confirm.checked = false;
        button.disabled = false;
      }
    });
  });
}

function renderExecution(detail) {
  const panel = elements['execution-panel'];
  if (!detail) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  elements['execution-result'].hidden = true;
  setExecutionStatus('');
  const graph = Boolean(detail.graph);
  elements['execution-title'].textContent = graph
    ? t('execution.titleGraph', { title: detail.title || detail.id })
    : t('execution.titleTask', { title: detail.title || detail.id });
  const confirmText = t('execution.confirm');
  const id = detail.id;
  let controls = '';
  if (!graph) {
    const dispatchable = ['CREATED', 'PLANNING', 'SPEC_READY', 'CHANGES_REQUESTED'].includes(detail.status);
    controls = `
      ${executionConfirmRow(confirmText)}
      <button class="button" type="button" data-run-action="taskDispatch" data-label="${escapeHtml(t('execution.dispatch'))}" data-params="${escapeHtml(JSON.stringify({ taskId: id }))}" ${dispatchable ? '' : 'disabled title="Current status prevents dispatch; the Runtime will still validate"'}>${escapeHtml(t('execution.dispatch'))}</button>
      ${dispatchable ? '' : `<span class="agent-muted">${escapeHtml(t('execution.notDispatchable', { status: detail.status || '' }))}</span>`}`;
  } else {
    controls = `
      ${executionConfirmRow(confirmText)}
      <label class="execution-field">${escapeHtml(t('execution.sessionWait'))}<input type="number" class="execution-session-wait" min="0" max="10000" value="2000"></label>
      <button class="button" type="button" data-run-action="taskGraphRun" data-label="${escapeHtml(t('execution.runWave'))}">${escapeHtml(t('execution.runWave'))}</button>
      <label class="execution-field">${escapeHtml(t('execution.maxWaves'))}<input type="number" class="execution-max-waves" min="1" max="32" value="1"></label>
      <button class="button" type="button" data-run-action="taskGraphAdvance" data-label="${escapeHtml(t('execution.advance'))}">${escapeHtml(t('execution.advance'))}</button>`;
  }
  elements['execution-controls'].innerHTML = controls + recoveryControls(detail);
  const waitInput = elements['execution-controls'].querySelector('.execution-session-wait');
  const wavesInput = elements['execution-controls'].querySelector('.execution-max-waves');
  const setRunParams = () => {
    elements['execution-controls'].querySelectorAll('[data-run-action="taskGraphRun"]').forEach(button => {
      button.dataset.params = JSON.stringify({ taskId: id, sessionWaitMs: Number(waitInput?.value) || 0 });
    });
  };
  if (waitInput) {
    setRunParams();
    waitInput.addEventListener('input', setRunParams);
  }
  if (wavesInput) {
    const updateAdvance = () => {
      elements['execution-controls'].querySelectorAll('[data-run-action="taskGraphAdvance"]').forEach(button => {
        button.dataset.params = JSON.stringify({ taskId: id, maxWaves: Math.max(1, Math.min(32, Number(wavesInput.value) || 1)), sessionWaitMs: Number(waitInput?.value) || 0 });
      });
    };
    updateAdvance();
    wavesInput.addEventListener('input', updateAdvance);
    waitInput?.addEventListener('input', updateAdvance);
  }
  bindExecutionControls(elements['execution-controls'], detail);
}

function setReviewStatus(message, kind = 'info') {
  const element = elements['review-status'];
  if (!element) return;
  element.textContent = message;
  element.className = `author-status ${kind}`;
}

function reviewParams(detail) {
  const decision = elements['review-controls'].querySelector('.review-decision')?.value;
  const feedback = elements['review-controls'].querySelector('.review-feedback')?.value.trim() || undefined;
  const evidenceText = elements['review-controls'].querySelector('.review-evidence')?.value.trim() || '';
  let evidence;
  if (evidenceText) {
    try {
      evidence = JSON.parse(evidenceText);
      if (typeof evidence !== 'object' || evidence === null || Array.isArray(evidence)) throw new Error('object');
    } catch {
      setReviewStatus(t('review.evidenceInvalid'), 'error');
      return null;
    }
  }
  const params = { taskId: detail.id, decision };
  if (feedback) params.feedback = feedback;
  if (evidence) params.evidence = evidence;
  return params;
}

async function submitReview(detail) {
  const params = reviewParams(detail);
  if (!params) return;
  if (!params.decision) {
    setReviewStatus(t('review.chooseDecision'), 'error');
    return;
  }
  const action = Boolean(detail.graph) ? 'taskGraphReview' : 'taskReview';
  const label = Boolean(detail.graph) ? 'Graph review' : 'Task review';
  setReviewStatus(t('review.recording', { label }));
  try {
    const { status, payload } = await postAction(action, params);
    if (status !== 200 || payload?.ok !== true) {
      const error = payload?.error || {};
      setReviewStatus(t('review.rejected', { label, message: `${error.code || `HTTP ${status}`} — ${error.message || ''}${error.details ? ` (${error.details})` : ''}` }), 'error');
      return;
    }
    const decision = payload.review?.decision || payload.status || params.decision;
    setReviewStatus(t('review.recorded', { label, decision }), 'ok');
    recordLocalAction(detail.id, `${label}: ${decision}`, 'ok');
    await refresh();
  } catch (error) {
    setReviewStatus(t('review.rejected', { label, message: error.message }), 'error');
  }
}

async function integrateGraph(detail) {
  setReviewStatus(t('review.integrating'));
  try {
    const { status, payload } = await postAction('taskGraphIntegrate', { taskId: detail.id });
    if (status !== 200 || payload?.ok !== true) {
      const error = payload?.error || {};
      setReviewStatus(t('review.integrationFailed', { message: `${error.code || `HTTP ${status}`} — ${error.message || ''}${error.details ? ` (${error.details})` : ''}` }), 'error');
      return;
    }
    const region = elements['review-result'];
    region.hidden = false;
    region.innerHTML = `<div class="execution-ok"><strong>${escapeHtml(t('review.integrationComplete'))}</strong>
      <div class="execution-facts">
        ${factBlock('Aggregate commit', payload.integration?.aggregateCommit || payload.aggregateCommit)}
        ${factBlock('Applied refs', payload.integration?.appliedCommits)}
        ${factBlock('Review worktree', payload.integration?.worktreePath)}
        ${factBlock('Branch', payload.integration?.branch)}
        ${factBlock('Conflicts', payload.integration?.conflicts)}
      </div></div>`;
    setReviewStatus(t('review.integrated'), 'ok');
    recordLocalAction(detail.id, t('review.integrationComplete'), 'ok');
    await refresh();
  } catch (error) {
    setReviewStatus(t('review.integrationFailed', { message: error.message }), 'error');
  }
}

function renderReview(detail) {
  const panel = elements['review-panel'];
  if (!detail) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  elements['review-result'].hidden = true;
  setReviewStatus('');
  const graph = Boolean(detail.graph);
  const detailState = detail.state || detail.status;
  const reviewable = graph
    ? ['RUNNING', 'SUCCEEDED', 'APPROVED', 'REVIEW_APPROVED', 'CHANGES_REQUESTED'].includes(detailState)
    : ['REVIEWING', 'CHANGES_REQUESTED'].includes(detailState);
  const controls = [];
  controls.push(`<label class="author-toggle review-confirm-row"><input type="checkbox" class="review-confirm"> ${escapeHtml(t('review.confirm'))}</label>`);
  if (graph) {
    controls.push(`<button class="button" type="button" id="review-integrate">${escapeHtml(t('review.integrate'))}</button>`);
  }
  controls.push(`<div class="review-form">
    <label>${escapeHtml(t('review.decision'))}<select class="review-decision">
      <option value="REVIEW_APPROVED">REVIEW_APPROVED</option>
      <option value="CHANGES_REQUESTED">CHANGES_REQUESTED</option>
    </select></label>
    <label>${escapeHtml(t('review.feedback'))}<textarea class="review-feedback" rows="3" maxlength="16384" placeholder="Bounded review feedback…"></textarea></label>
    <label>${escapeHtml(t('review.evidence'))}<textarea class="review-evidence" rows="2" maxlength="65536" placeholder='{ "tests": "passed" }'></textarea></label>
    <button class="button" type="button" id="review-submit" ${reviewable ? '' : 'disabled title="Current state is not reviewable; review applies to reviewed/changes-requested Tasks or running/succeeded graphs"'}>${escapeHtml(t('review.record'))}</button>
    <span class="agent-muted">${escapeHtml(t('review.state', { state: detailState || 'unknown' }))}</span>
  </div>`);
  elements['review-controls'].innerHTML = controls.join('');
  const confirm = elements['review-controls'].querySelector('.review-confirm');
  const integrate = elements['review-controls'].querySelector('#review-integrate');
  const submit = elements['review-controls'].querySelector('#review-submit');
  const arm = () => {
    if (integrate) integrate.disabled = !confirm.checked;
    if (submit) submit.disabled = !confirm.checked || !reviewable;
  };
  confirm.addEventListener('change', arm);
  arm();
  integrate?.addEventListener('click', () => {
    integrate.disabled = true;
    integrateGraph(detail).finally(() => { if (confirm) confirm.checked = false; arm(); });
  });
  submit?.addEventListener('click', () => {
    submit.disabled = true;
    submitReview(detail).finally(() => { if (confirm) confirm.checked = false; arm(); });
  });
}

function renderGraphDetail(task) {
  const graph = Boolean(task?.graph);
  elements['graph-detail'].hidden = !graph;
  if (!graph) {
    for (const id of ['graph-topology', 'graph-frontier', 'graph-conflicts', 'graph-integration', 'graph-map', 'graph-node-detail']) elements[id].innerHTML = '';
    elements['graph-map-note'].textContent = '';
    elements['graph-map-region'].hidden = true;
    state.selectedSubtask = null;
    return;
  }
  elements['graph-map-region'].hidden = false;
  renderGraphLegend();
  renderGraphMap(task);
  const dependencies = task.dependencies || [];
  elements['graph-topology'].innerHTML = (task.subtasks || []).map(subtask => `
    <article class="graph-node">
      <div class="graph-node-heading">
        <div><span class="eyebrow">${escapeHtml(subtask.id)}</span><strong>${escapeHtml(subtask.title || subtask.id)}</strong></div>
        <span class="status-pill ${statusClass(subtask.state)}">${escapeHtml(statusText(subtask.state))}</span>
      </div>
      <div class="graph-dependencies">${escapeHtml(t('lb.Depends on'))}: ${subtask.dependsOn?.length ? subtask.dependsOn.map(item => `<code>${escapeHtml(item)}</code>`).join(' ') : `<span>${escapeHtml(t('empty.dependencies'))}</span>`}</div>
      <div class="graph-node-meta">
        <span>${escapeHtml(t('msg.agent'))} <strong>${escapeHtml(subtask.implementer)}</strong></span>
        <span>Adapter <strong>${escapeHtml(subtask.agent?.adapter || '—')}</strong></span>
        <span>${escapeHtml(t('msg.session'))} <code>${escapeHtml(shortId(subtask.sessionId) || '—')}</code></span>
      </div>
      ${factBlock('Executable', subtask.executable)}
      ${factBlock('Worktree / branch / commit', { ...subtask.worktree, implementationCommit: subtask.implementationCommit })}
      ${factBlock('Evidence', subtask.evidence)}
      ${factBlock('Scope audit', subtask.scopeAudit)}
      ${factBlock('Recovery', subtask.recovery)}
      ${factBlock('Last error', subtask.lastError)}
    </article>
  `).join('') || `<div class="empty-state">${escapeHtml(t('empty.subtasks'))}</div>`;
  const edgeList = dependencies.length
    ? dependencies.map(edge => `<code>${escapeHtml(edge.from)} → ${escapeHtml(edge.to)}</code>`).join(' ')
    : `<span>${escapeHtml(t('empty.dependencies'))}</span>`;
  elements['graph-topology'].insertAdjacentHTML('afterbegin', `<div class="graph-edge-list"><strong>${escapeHtml(t('lb.Dependency edges'))}</strong>${edgeList}</div>`);
  elements['graph-frontier'].innerHTML = [
    factBlock('Max concurrency', task.maxConcurrency),
    factBlock('Current frontier', task.frontier),
    factBlock('Selected preflight wave', task.wave),
  ].join('');
  elements['graph-conflicts'].innerHTML = [
    factBlock('Write-intent conflicts', task.conflicts),
    factBlock('Intent coverage', task.intentCoverage),
    factBlock('Recovery classifications', task.recovery),
  ].join('') || `<div class="empty-state">${escapeHtml(t('msg.graphNoConflict'))}</div>`;
  elements['graph-integration'].innerHTML = [
    factBlock('Integration', task.integration),
    factBlock('Integration facts', task.integrationFacts),
    factBlock('Review', task.review),
    factBlock('Review history', task.reviewHistory),
  ].join('') || `<div class="empty-state">${escapeHtml(t('msg.graphNoIntegration'))}</div>`;
}

function renderTaskDetail(task) {
  if (!task) {
    elements['task-detail'].hidden = true;
    renderExecution(null);
    renderReview(null);
    return;
  }
  elements['task-detail'].hidden = false;
  elements['detail-title'].textContent = task.title;
  elements['detail-summary'].innerHTML = `
    <span class="status-pill ${statusClass(task.status)}">${escapeHtml(statusText(task.status))}</span>
    <span>${task.graph ? escapeHtml(t('msg.graph')) : escapeHtml(t('msg.round', { round: task.round }))}</span>
    <span>${escapeHtml(task.id)}</span>
    <span>${escapeHtml(t('msg.updated', { time: formatDate(task.updatedAt) }))}</span>
  `;
  renderExecution(task);
  renderReview(task);
  renderGraphDetail(task);
  renderTimeline(task.timeline);
  elements['detail-agent-flow'].innerHTML = (task.agentFlow || []).map((item, index) => {
    const agent = agentFor(item.agent);
    return `
      <div class="detail-agent-row">
        <span class="flow-role">${escapeHtml(item.role)}</span>
        <strong>${escapeHtml(item.agent)}</strong>
        <span class="status-line"><span class="state-dot ${statusClass(agent.status)}"></span>${escapeHtml(statusText(agent.status))}</span>
      </div>
      ${index < (task.agentFlow || []).length - 1 ? '<div class="detail-agent-arrow">↓</div>' : ''}
    `;
  }).join('');
  const evidence = task.evidence || [];
  const reviews = task.reviewHistory || [];
  elements.evidence.innerHTML = `
    <div class="evidence-row"><span>${escapeHtml(labelText(task.graph ? 'Base commit' : 'Commit'))}</span><code>${escapeHtml(task.graph ? (task.baseCommit || '—') : (task.implementationCommit || '—'))}</code></div>
    <div class="evidence-row"><span>${escapeHtml(t('lb.Evidence records'))}</span><strong>${evidence.length}</strong></div>
    ${evidence.map(item => `<div class="evidence-block"><strong>${escapeHtml(item.type || 'Evidence')}</strong><p>${escapeHtml(item.details || item.relatedCommit || '—')}</p></div>`).join('')}
    ${reviews.map(item => `<div class="review-block"><span class="status-pill ${statusClass(item.decision)}">${escapeHtml(statusText(item.decision))}</span><p>${escapeHtml(item.feedback || t('msg.noFeedback'))}</p></div>`).join('')}
    ${task.lastError ? `<div class="error-block"><strong>${escapeHtml(task.lastError.code || 'ERROR')}</strong><p>${escapeHtml(task.lastError.message || task.lastError.details || '')}</p></div>` : ''}
  `;
  elements.spec.textContent = task.spec || t('empty.noSpec');
}

/* ------------------------------------------------------------------ */
/* Chat area                                                          */
/* ------------------------------------------------------------------ */
function renderChatWelcome() {
  const region = elements['chat-welcome'];
  if (!region) return;
  region.hidden = false;
  const name = state.repository?.name || state.repository?.root || '';
  region.innerHTML = `
    <div class="welcome-card">
      <p class="eyebrow">${escapeHtml(t('welcome.title'))}</p>
      <h2>${escapeHtml(name ? `${name}` : t('welcome.title'))}</h2>
      <p class="welcome-sub">${escapeHtml(t('welcome.subtitle'))}</p>
      <div class="welcome-columns">
        <div>
          <h3>${escapeHtml(t('welcome.whatYouCan'))}</h3>
          <ul>
            <li>${escapeHtml(t('welcome.w1'))}</li>
            <li>${escapeHtml(t('welcome.w2'))}</li>
            <li>${escapeHtml(t('welcome.w3'))}</li>
            <li>${escapeHtml(t('welcome.w4'))}</li>
          </ul>
        </div>
        <div class="welcome-actions">
          <button class="button primary-button" type="button" id="welcome-start">${escapeHtml(t('welcome.startTask'))}</button>
          <button class="button ghost" type="button" id="welcome-agents">${escapeHtml(t('welcome.configAgents'))}</button>
          <p class="welcome-hint">${escapeHtml(t('welcome.hint'))}</p>
        </div>
      </div>
    </div>`;
  region.querySelector('#welcome-start')?.addEventListener('click', () => {
    switchView('chat');
    elements['composer-input']?.focus();
  });
  region.querySelector('#welcome-agents')?.addEventListener('click', () => switchView('agents'));
}

function chatMessageCard(task, entry) {
  // entry: {kind: 'task'|'state'|'event'|'session'|'review'|'error'|'action'|'evidence',
  //          title, sub, body, raw, time, dot, pill}
  const dotClass = entry.dot ? ` dot-${statusClass(entry.dot)}` : '';
  const side = entry.kind === 'action' ? 'side-right' : '';
  return `
    <article class="chat-msg msg-${entry.kind}${side}" data-chat-kind="${entry.kind}">
      <div class="chat-msg-head">
        <span class="chat-dot${dotClass}" aria-hidden="true"></span>
        <strong>${escapeHtml(entry.title)}</strong>
        ${entry.pill ? `<span class="status-pill ${statusClass(entry.pill)}">${escapeHtml(statusText(entry.pill))}</span>` : ''}
        ${entry.time ? `<time>${escapeHtml(entry.time)}</time>` : ''}
      </div>
      ${entry.sub ? `<div class="chat-msg-sub">${escapeHtml(entry.sub)}</div>` : ''}
      ${entry.body !== undefined && entry.body !== null && entry.body !== '' ? `<div class="chat-msg-body">${typeof entry.body === 'string' ? escapeHtml(entry.body) : compactJson(entry.body)}</div>` : ''}
      ${entry.raw ? `<code class="chat-msg-code">${escapeHtml(entry.raw)}</code>` : ''}
    </article>`;
}

function renderChatFeed(task) {
  const feed = elements['chat-feed'];
  const welcome = elements['chat-welcome'];
  if (!task) {
    welcome.hidden = false;
    feed.innerHTML = '';
    renderChatWelcome();
    return;
  }
  welcome.hidden = true;
  const messages = [];
  // Header card: the authoritative Task record.
  messages.push(chatMessageCard(task, {
    kind: task.graph ? 'task' : 'task',
    title: task.title || task.id,
    sub: `${task.id} · ${task.graph ? t('msg.graph') : t('msg.round', { round: task.round })} · ${t('msg.updated', { time: formatDate(task.updatedAt) })}`,
    pill: task.status || (task.graph ? 'RUNNING' : ''),
    body: task.spec || null,
    dot: task.status || 'UNKNOWN',
  }));

  const timeline = Array.isArray(task.timeline) ? task.timeline : [];
  for (const event of timeline) {
    const title = event.status ? statusText(event.status) : eventText(event.event);
    const actor = event.agent || event.from || t('chat.runtime');
    const subParts = [actor];
    if (event.sessionId) subParts.push(`${t('msg.session')} ${shortId(event.sessionId)}`);
    const kind = isErrorEvent(event) ? 'error' : (event.status ? 'state' : 'event');
    messages.push(chatMessageCard(task, {
      kind,
      title,
      sub: subParts.join(' · '),
      time: formatDate(event.timestamp),
      body: event.details || null,
      raw: event.event && !event.status ? event.event : null,
      dot: event.status || (kind === 'error' ? 'ERROR' : null),
      pill: event.status || null,
    }));
  }

  if (task.graph) {
    const counts = (task.subtasks || []).reduce((acc, item) => {
      acc[item.state || 'UNKNOWN'] = (acc[item.state || 'UNKNOWN'] || 0) + 1;
      return acc;
    }, {});
    messages.push(chatMessageCard(task, {
      kind: 'event',
      title: t('msg.graphSubtask', { n: (task.subtasks || []).length }),
      sub: Object.entries(counts).map(([k, v]) => `${statusText(k)} ${v}`).join(' · '),
      body: null,
      dot: 'RUNNING',
    }));
  }

  for (const review of (task.reviewHistory || [])) {
    messages.push(chatMessageCard(task, {
      kind: 'review',
      title: t('msg.reviewDecision'),
      pill: review.decision,
      sub: review.actor ? String(review.actor) : null,
      time: review.timestamp ? formatDate(review.timestamp) : null,
      body: review.feedback || null,
      dot: review.decision,
    }));
  }

  const localList = localActions.get(task.id) || [];
  for (const item of localList) {
    messages.push(chatMessageCard(task, {
      kind: item.kind === 'error' ? 'error' : 'action',
      title: item.label,
      time: formatTime(item.at),
      body: null,
      dot: item.kind === 'error' ? 'ERROR' : 'OK',
    }));
  }

  if (task.lastError) {
    messages.push(chatMessageCard(task, {
      kind: 'error',
      title: `${task.lastError.code || 'ERROR'} · ${task.id}`,
      body: task.lastError.message || task.lastError.details || null,
      time: formatDate(task.updatedAt),
      dot: 'ERROR',
    }));
  }

  if (!messages.length) {
    feed.innerHTML = `<div class="empty-state">${escapeHtml(t('empty.detailTimeline'))}</div>`;
    return;
  }
  const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 180;
  feed.innerHTML = messages.join('');
  if (nearBottom) {
    feed.scrollTop = feed.scrollHeight;
  }
}

function isErrorEvent(event) {
  const text = `${event.event || ''} ${event.status || ''}`.toUpperCase();
  return /ERROR|FAIL|NONZERO|REJECTED|BLOCKED|STOPPED/.test(text) && !/STOPPED_OK/.test(text);
}

function recordLocalAction(taskId, label, kind = 'ok') {
  if (!taskId) return;
  if (!localActions.has(taskId)) localActions.set(taskId, []);
  localActions.get(taskId).push({ label, kind, at: new Date() });
}

/* ------------------------------------------------------------------ */
/* Context panel                                                      */
/* ------------------------------------------------------------------ */
function renderContextSelection() {
  const container = elements['context-selection'];
  if (!container) return;
  const taskId = state.selectedTask;
  if (!taskId) {
    const taskCount = (state.tasks || []).length;
    const sessionCount = (state.sessions || []).length;
    container.innerHTML = `
      <div class="context-intro">
        <p class="context-intro-text">${escapeHtml(t('context.selectionHint'))}</p>
        <div class="context-counts">
          <span class="count-badge">${escapeHtml(t('context.recentTasks', { n: taskCount }))}</span>
          <span class="count-badge">${escapeHtml(t('context.recentSessions', { n: sessionCount }))}</span>
        </div>
        <div class="context-quick">
          <button class="button" type="button" id="context-new-task">${escapeHtml(t('context.newTask'))}</button>
          <button class="button ghost" type="button" id="context-agents">${escapeHtml(t('context.browseAgents'))}</button>
        </div>
      </div>`;
    container.querySelector('#context-new-task')?.addEventListener('click', openAuthorDrawer);
    container.querySelector('#context-agents')?.addEventListener('click', () => switchView('agents'));
    return;
  }
  // Resolve the freshest summary from the list first.
  const summary = (state.tasks || []).find(item => item.id === taskId);
  const title = summary?.title || taskId;
  const graph = Boolean(summary?.graph);
  const status = summary?.status || (graph ? 'RUNNING' : 'CREATED');
  container.innerHTML = `
    <div class="context-task">
      <div class="context-task-title">
        <span class="state-dot ${statusClass(status)}"></span>
        <strong>${escapeHtml(title)}</strong>
      </div>
      <div class="context-task-meta">
        <span class="status-pill ${statusClass(status)}">${escapeHtml(statusText(status))}</span>
        <code>${escapeHtml(taskId)}</code>
      </div>
      ${graph ? `<div class="context-task-meta">${escapeHtml(t('msg.graphSubtask', { n: summary.subtaskCount }))} · ${escapeHtml(t('msg.concurrency', { n: summary.maxConcurrency }))}</div>` : ''}
      <div class="context-actions">
        <button class="button" type="button" data-context-action="details">${escapeHtml(t('context.openDetails'))}</button>
        <button class="button ghost" type="button" data-context-action="execution">${escapeHtml(t('context.execution'))}</button>
        <button class="button ghost" type="button" data-context-action="review">${escapeHtml(t('context.review'))}</button>
      </div>
    </div>`;
  container.querySelector('[data-context-action="details"]')?.addEventListener('click', () => openDetailDrawer(graph ? 'graph-detail' : 'timeline'));
  container.querySelector('[data-context-action="execution"]')?.addEventListener('click', () => openDetailDrawer('execution-panel'));
  container.querySelector('[data-context-action="review"]')?.addEventListener('click', () => openDetailDrawer('review-panel'));
}

function renderContext() {
  renderContextSelection();
  renderAgentFlow();
}

/* ------------------------------------------------------------------ */
/* Composer                                                           */
/* ------------------------------------------------------------------ */
function renderComposerAgents() {
  const select = elements['composer-agent'];
  if (!select) return;
  const ids = authorAgentIds();
  const previous = select.value;
  select.innerHTML = `<option value="">—</option>${ids.map(id => `<option value="${escapeHtml(id)}">${escapeHtml(id)}</option>`).join('')}`;
  if (previous && ids.includes(previous)) select.value = previous;
  const hint = elements['composer-hint'];
  if (hint) {
    const notice = ids.length === 0 ? `<span class="composer-warning">${escapeHtml(t('composer.noAgents'))}</span>` : '';
    hint.innerHTML = `${notice}<span>${escapeHtml(t('composer.enterHint'))}</span>`;
  }
}

function setComposerStatus(message, kind = 'info') {
  const status = elements['composer-status'];
  if (!status) return;
  if (!message) {
    status.hidden = true;
    status.textContent = '';
    status.className = 'composer-status';
    return;
  }
  status.hidden = false;
  status.textContent = message;
  status.className = `composer-status ${kind}`;
}

function updateSendLabel() {
  const mode = elements['composer-mode']?.value;
  const send = elements['composer-send'];
  if (!send || !mode) return;
  send.textContent = mode === 'graph' ? t('composer.openGraph') : t('composer.send');
}

async function composerSend() {
  const input = elements['composer-input'];
  const text = input.value.trim();
  const firstLine = text.split(/\r?\n/, 1)[0].trim();
  if (!firstLine) {
    setComposerStatus(t('composer.titleRequired'), 'error');
    toast(t('composer.titleRequired'), 'error', 3200);
    input.focus();
    return;
  }
  const mode = elements['composer-mode']?.value || 'task';
  const agentId = elements['composer-agent']?.value || '';
  if (mode === 'graph') {
    openAuthorDrawer();
    elements['author-graph-title'].value = firstLine;
    elements['author-graph-spec'].value = text;
    setComposerStatus(t('composer.graphHint'), 'info');
    window.setTimeout(() => elements['author-graph-title'].focus(), 60);
    return;
  }
  const params = { title: firstLine };
  if (text.length > firstLine.length) params.spec = text;
  if (agentId) params.implementer = agentId;
  const send = elements['composer-send'];
  send.disabled = true;
  setComposerStatus(t('composer.creating'), 'info');
  try {
    const { status, payload } = await postAction('taskCreate', params);
    if (status !== 200 || payload?.ok !== true) {
      const error = payload?.error || {};
      setComposerStatus(t('composer.failed', { message: `${error.code || `HTTP ${status}`} — ${error.message || ''}` }), 'error');
      toast(t('composer.failed', { message: error.message || error.code || `HTTP ${status}` }), 'error', 5000);
      return;
    }
    const taskId = payload.task?.id || payload.id;
    setComposerStatus('');
    toast(t('composer.sent'), 'ok', 3000);
    input.value = '';
    await refresh();
    if (taskId) {
      switchView('chat');
      selectTask(taskId);
    }
  } catch (error) {
    setComposerStatus(t('composer.failed', { message: error.message }), 'error');
    toast(t('composer.failed', { message: error.message }), 'error', 5000);
  } finally {
    send.disabled = false;
  }
}

function onComposerKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    composerSend();
  }
}

/* ------------------------------------------------------------------ */
/* Selection                                                          */
/* ------------------------------------------------------------------ */
async function selectTask(id) {
  try {
    state.selectedTask = id;
    state.selectedSubtask = null;
    state.graphDetail = null;
    window.location.hash = encodeURIComponent(id);
    switchView('chat');
    renderTasks();
    renderRecentList();
    const task = await fetchJson(`/api/tasks/${encodeURIComponent(id)}`);
    renderTaskDetail(task);
    renderChatFeed(task);
    renderContext();
    // Keep the details drawer populated if it is open.
    if (!state.detailOpen) {
      // Do not auto-open on desktop; the context panel offers the entry.
    }
  } catch (error) {
    renderChatWelcome();
    toast(error.message, 'error', 4000);
  }
}

function closeDetail() {
  closeTopDrawer();
}

/* ------------------------------------------------------------------ */
/* Refresh & init                                                     */
/* ------------------------------------------------------------------ */
async function refresh() {
  try {
    const [tasks, agents, sessions, events] = await Promise.all([
      fetchJson('/api/tasks'),
      fetchJson('/api/agents'),
      fetchJson('/api/sessions'),
      fetchJson('/api/events?limit=80'),
    ]);
    state.tasks = tasks;
    state.agents = agents;
    state.sessions = sessions;
    state.events = events;
    renderTasks();
    renderAgentFlow();
    renderConfiguredAgents(state.agents);
    refreshAgentSelects();
    renderSessions();
    bindSessionActions(elements.sessions);
    renderEvents();
    renderRecentList();
    renderComposerAgents();
    renderContext();
    if (state.selectedTask) {
      try {
        const task = await fetchJson(`/api/tasks/${encodeURIComponent(state.selectedTask)}`);
        renderTaskDetail(task);
        renderChatFeed(task);
      } catch { /* The list remains useful if a task is removed during refresh. */ }
    }
  } catch (error) {
    elements.tasks.innerHTML = `<div class="empty-state error-state">${escapeHtml(error.message)}</div>`;
  }
  try {
    state.repository = await fetchJson('/api/repository');
  } catch {
    state.repository = null;
  }
  renderRepository();
  if (state.currentView === 'chat' && !state.selectedTask) renderChatWelcome();
}

function renderAllDynamic() {
  if (!elements.tasks) return;
  renderTasks();
  renderAgentFlow();
  renderConfiguredAgents(state.agents);
  renderSessions();
  renderEvents();
  renderRecentList();
  renderComposerAgents();
  renderContext();
  if (state.selectedTask) {
    const task = state.tasks.find(item => item.id === state.selectedTask);
    renderChatWelcome();
  }
  renderChatArea();
}

function renderChatArea() {
  if (state.currentView !== 'chat') return;
  if (!state.selectedTask) {
    renderChatWelcome();
    elements['chat-feed'].innerHTML = '';
    return;
  }
  // The freshest timeline lives in the per-task detail; keep chat in sync lazily.
}

function bindEvents() {
  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.addEventListener('click', () => switchView(item.dataset.view));
  });
  elements['refresh-button']?.addEventListener('click', refresh);
  elements['sidebar-open']?.addEventListener('click', openSidebar);
  elements['sidebar-close']?.addEventListener('click', () => { closeSidebarIfMobile(); });
  elements['new-task-button']?.addEventListener('click', openAuthorDrawer);
  elements['close-detail']?.addEventListener('click', closeDetail);
  elements['drawer-close']?.addEventListener('click', closeTopDrawer);
  elements['author-drawer-close']?.addEventListener('click', closeTopDrawer);
  elements['drawer-scrim']?.addEventListener('click', closeTopDrawer);
  elements['context-toggle']?.addEventListener('click', toggleContext);
  elements['context-close']?.addEventListener('click', toggleContext);
  elements['repo-facts-toggle']?.addEventListener('click', toggleRepoFacts);
  elements['discover-agents']?.addEventListener('click', discoverAgents);
  elements['agent-configure']?.addEventListener('submit', applyAgentConfigure);
  elements['author-subtask-add']?.addEventListener('click', () => addSubtaskRow());
  elements['author-graph-validate']?.addEventListener('click', validateGraphNow);
  elements['author-graph-create']?.addEventListener('click', createGraphNow);
  elements['task-create-form']?.addEventListener('submit', createSingleTask);
  elements['author-graph-intent']?.addEventListener('change', event => {
    elements['author-graph-scope'].disabled = !event.target.checked;
  });
  elements['composer-send']?.addEventListener('click', composerSend);
  elements['composer-mode']?.addEventListener('change', updateSendLabel);
  elements['composer-input']?.addEventListener('keydown', onComposerKeydown);
  elements['lang-zh']?.addEventListener('click', () => persistLocale('zh-CN'));
  elements['lang-en']?.addEventListener('click', () => persistLocale('en-US'));

  document.querySelectorAll('#view-tasks [data-task-id]').forEach(() => { /* tasks grid handles its own */ });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (state.authorOpen || state.detailOpen) {
        closeTopDrawer();
      } else {
        closeGraphMap();
      }
    }
  });
  window.addEventListener('resize', () => {
    if (!isNarrowSidebar()) closeSidebarIfMobile();
    updateContextState();
  });
}

function init() {
  applyStaticI18n();
  bindEvents();
  if (window.matchMedia('(max-width: 1180px)').matches) state.contextOpen = false;
  updateContextState();
  updateSendLabel();
  renderLanguageControls();
  addSubtaskRow({ id: 'sub-a' });
  switchView('chat');
  const initialTask = decodeURIComponent(window.location.hash.slice(1));
  if (initialTask) {
    state.selectedTask = initialTask;
    switchView('chat');
  } else {
    renderChatWelcome();
  }
  refresh();
  setInterval(refresh, 5_000);
}

let refreshTimer = null;
function scheduleRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refresh();
  }, 150);
}

init();

if ('EventSource' in window) {
  const stream = new EventSource('/api/events/stream');
  stream.addEventListener('runtime-event', scheduleRefresh);
}
