import {
  isActiveTerminalSession,
  selectTerminalPanes,
  terminalSessionKey,
  terminalBackendKey,
  TERMINAL_MAX_BYTES,
  TERMINAL_MAX_LINES,
  TERMINAL_POLL_MS,
} from './terminal-model.mjs';

const ACTION_ENDPOINT = '/api/action';
const CAPABILITY_HEADER = 'x-coordinate-agents-capability';
const MAX_INPUT_BYTES = 16 * 1024;
const MAX_INPUT_QUEUE_BYTES = 128 * 1024;
const MAX_VISIBLE_ERROR = 2 * 1024;
const REFRESH_MS = 5_000;
const UTF8_ENCODER = new TextEncoder();
const WORKSPACE_SETTINGS_ENDPOINT = '/api/workspace-settings';
const DEFAULT_TERMINAL_COMMANDS = Object.freeze({ codex: 'codex', antigravity: 'agy' });
const HEALTH_SEEN_KEY = 'coordinate-agents-workspace-onboarding-seen';

const I18N = {
  en: {
    'health.open': 'Environment check',
    'health.title': 'Check your local environment',
    'health.loading': 'Checking local commands…',
    'health.ready': 'Environment ready',
    'health.warning': 'Environment ready with limitations',
    'health.missing': 'Environment needs configuration',
    'health.pending': 'Environment awaiting verification',
    'health.error': 'Could not check the environment. You can continue or recheck.',
    'health.ok': 'OK',
    'health.statusWarning': 'Limited',
    'health.statusMissing': 'Configure',
    'health.statusPending': 'Pending',
    'health.recheck': 'Recheck',
    'health.continue': 'Continue',
    'health.close': 'Close environment check',
    'health.notStarted': 'Not started',
    'health.codexMissing': 'Install Codex CLI, then recheck. You can also update its command in terminal settings.',
    'health.antigravityMissing': 'Install Antigravity CLI or update its command in terminal settings, then recheck.',
    'health.authUnknown': 'Sign-in status awaiting verification',
    'health.authHint': 'CLI installed. Complete sign-in in the Web terminal when starting a task.',
    'health.command': 'Current command',
    'health.copy': 'Copy install command',
    'health.copied': 'Install command copied.',
    'health.copyError': 'Could not copy. Select the command and copy it manually.',
    'health.versionUnknown': 'Version unavailable. Recheck or review the configured command.',
    'health.timeout': 'Check timed out. Review the command or recheck; the workspace remains available.',
    'health.nodeHint': 'Node.js 18 or later is required. Install a supported Node.js version and restart the Web server.',
    'health.gitHint': 'Install Git for your system and make it available to the Web server, then recheck.',
    'health.fallback': 'Terminal uses stdio fallback. Some native TUI features and terminal resizing may be limited.',
    'health.node18': 'Node.js 18 uses the expected stdio compatibility mode. The workspace can still be used.',
    'health.terminalPending': 'The terminal backend will be checked after you create a task.',
    'health.details': 'Details',
    'status.failed': 'Failed',
    'terminal.accountInitTimeout': 'Account initialization timed out. Check the network or proxy, then restart the terminal pair.',
    'status.awaiting_input': 'Awaiting confirmation',
    'status.idle': 'Idle',
    'status.busy': 'Busy',
    'startup.trust': 'Confirm folder trust and any sign-in prompts in the terminals below. Startup continues automatically afterwards.',
    'startup.auth': 'Complete sign-in in the terminals below. Startup continues automatically afterwards.',
    'startup.waiting': 'Preparing terminals. Complete any prompts shown below; startup continues automatically.',
    'startup.roleTrust': 'confirm folder trust',
    'startup.roleAuth': 'sign-in required',
    'startup.roleWaiting': 'preparing',
    'cooperation.SENT': 'Sent to Antigravity',
    'cooperation.WORKING': 'Antigravity implementing',
    'cooperation.DONE': 'Awaiting Codex review',
    'cooperation.REVIEWING': 'Codex reviewing',
    'cooperation.APPROVED': 'Review complete',
    'cooperation.CHANGES_REQUESTED': 'Changes requested',
    'cooperation.FAILED': 'Agent reported failure',
    'cooperation.reported': 'Agent-reported collaboration state',
    'cooperation.agentWorking': 'working',
    'cooperation.awaitingReview': 'awaiting review',
    'cooperation.agentReviewing': 'reviewing',
    'cooperation.agentDone': 'implementation complete',
    'cooperation.agentApproved': 'review complete',
    'cooperation.agentChanges': 'awaiting corrections',
    'archive.task': 'Archive conversation',
    'archive.project': 'Archive project and conversations',
    'archive.title': 'Archived conversations',
    'archive.hint': 'Permanently clear archived conversation records across all projects. Project source files are preserved.',
    'archive.clear': 'Clear archived conversations',
    'archive.summary': '{tasks} conversations · {projects} projects archived',
    'archive.unavailable': '{count} project directories unavailable',
    'archive.done': 'Archived.',
    'archive.cleared': 'Cleared {count} archived conversations.',
    'archive.partial': 'Some project directories could not be cleared.',
    'archive.failed': 'Archive operation failed.',
    'project.none': 'No active project',
    'empty.archivedTitle': 'All projects are archived',
    'empty.archivedBody': 'Add a project to continue, or open settings to clear archived conversations.',
    'zen.enter': 'Zen mode',
    'zen.exit': 'Exit Zen mode',
    'theme.toDark': 'Switch to dark mode',
    'theme.toLight': 'Switch to light mode',
    'repo.label': 'CURRENT PROJECT',
    'project.switch': 'Switch project',
    'project.new': 'New project',
    'repo.loading': 'Loading repository…',
    'repo.details': 'Show repository details',
    'repo.hideDetails': 'Hide repository details',
    'repo.branch': 'Branch',
    'repo.commit': 'Commit',
    'repo.root': 'Root',
    'workspace.eyebrow': 'DUAL-TERMINAL WORKSPACE',
    'workspace.title': 'Workspace',
    'task.new': 'New task',
    'task.list': 'Workspace tasks',
    'task.none': 'No workspace tasks yet.',
    'task.search': 'Search tasks or projects',
    'task.searchClear': 'Clear search',
    'task.searchNone': 'No matching tasks found',
    'task.searchUnloaded': 'Tasks in {count} projects are not loaded; only loaded/cached tasks are searched.',
    'task.notLoaded': 'Tasks not loaded',
    'task.restart': 'Restart pair',
    'task.closeAll': 'Close all terminals',
    'task.allClosed': 'All workspace terminals closed.',
    'settings.model': 'Codex model',
    'settings.effort': 'Reasoning effort',
    'settings.default': 'Use default',
    'settings.modelHint': 'Choose a model and reasoning effort. Applies to new tasks and restarts.',
    'task.close': 'Close task',
    'task.closed': 'Task closed',
    'task.created': 'New dual-terminal task created.',
    'task.restarted': 'The terminal pair was restarted.',
    'task.error': 'Task error',
    'settings.open': 'Terminal settings',
    'settings.eyebrow': 'TERMINAL SETTINGS',
    'settings.title': 'Terminal startup commands',
    'settings.body': 'New tasks and restarts use these saved commands.',
    'settings.codex': 'Codex',
    'settings.antigravity': 'Antigravity',
    'settings.hint': 'Enter an executable name or absolute path, such as agy-proxy. Do not include shell arguments.',
    'settings.cancel': 'Cancel',
    'settings.save': 'Save settings',
    'settings.saving': 'Saving…',
    'settings.saved': 'Terminal startup commands saved.',
    'settings.loadError': 'Could not load terminal settings.',
    'settings.saveError': 'Could not save terminal settings.',
    'settings.invalid': 'Both startup commands are required and must be single-line executable names or paths.',
    'empty.title': 'Start a dual-terminal task',
    'empty.body': 'Create a task to open fresh Codex and Antigravity terminals. Enter the requirement directly in the Codex terminal.',
    'empty.failed': 'This task did not start both terminals. Review the error, then restart the pair.',
    'status.live': 'localhost · live',
    'status.starting': 'Starting',
    'status.running': 'Running',
    'status.degraded': 'One terminal unavailable',
    'status.exited': 'Exited',
    'status.closed': 'Closed',
    'status.error': 'Failed',
    'terminal.codex': 'Codex',
    'terminal.antigravity': 'Antigravity',
    'terminal.planner': 'planner · reviewer',
    'terminal.implementer': 'implementer',
    'terminal.connecting': 'Connecting…',
    'terminal.unavailable': 'No Session is bound to this task.',
    'terminal.closed': 'Terminal is closed.',
    'terminal.inputError': 'Terminal input could not be sent.',
    'terminal.resizeError': 'Terminal resize could not be applied.',
    'terminal.split': 'Resize terminals (double-click to reset)',
    'terminal.focus': 'Focus terminal',
    'terminal.restore': 'Restore split view',
    'terminal.switchFocus': 'Focus {terminal}',
    'terminal.nativeBackend': 'Native PTY',
    'terminal.fallbackBackend': 'stdio fallback',
    'terminal.unknownBackend': 'Backend unknown',
    'action.refreshError': 'Workspace refresh failed.',
    'action.createError': 'Could not create the dual-terminal task.',
    'action.closeError': 'Could not close the task pair.',
    'action.restartError': 'Could not restart the task pair.',
    'action.retry': 'Retry',
  },
  zh: {
    'health.open': '环境自检',
    'health.title': '开始使用前，检查一下本地环境',
    'health.loading': '正在检测本地命令…',
    'health.ready': '环境已就绪',
    'health.warning': '环境可用，存在兼容性限制',
    'health.missing': '环境需配置',
    'health.pending': '环境待验证',
    'health.error': '暂时无法检测环境，可继续使用或重新检测。',
    'health.ok': '正常',
    'health.statusWarning': '有限制',
    'health.statusMissing': '需配置',
    'health.statusPending': '待检测',
    'health.recheck': '重新检测',
    'health.continue': '继续使用',
    'health.close': '关闭环境自检',
    'health.notStarted': '尚未启动',
    'health.codexMissing': '请先安装 Codex CLI，安装完成后重新检测；也可在终端设置中修改启动命令。',
    'health.antigravityMissing': '请安装 Antigravity CLI，或在终端设置中修改启动命令，然后重新检测。',
    'health.authUnknown': '登录状态待验证',
    'health.authHint': 'CLI 已安装。启动任务时可直接在 Web 终端中完成登录。',
    'health.command': '当前使用的命令',
    'health.copy': '复制安装命令',
    'health.copied': '安装命令已复制。',
    'health.copyError': '无法自动复制，请选中命令手动复制。',
    'health.versionUnknown': '版本信息暂不可用，请重新检测或检查启动命令。',
    'health.timeout': '检测超时，请检查启动命令或重新检测；工作台仍可使用。',
    'health.nodeHint': '需要 Node.js 18 或更高版本。请安装受支持的 Node.js 版本并重启 Web 服务。',
    'health.gitHint': '请安装适用于当前系统的 Git，并确保 Web 服务能执行 Git，然后重新检测。',
    'health.fallback': '当前终端使用 stdio 兼容模式，部分原生 TUI 和终端尺寸调整能力可能受限。',
    'health.node18': 'Node.js 18 使用预期的 stdio 兼容模式，仍可正常使用工作台。',
    'health.terminalPending': '新建任务后会复用实际终端信息检测运行后端。',
    'health.details': '详情',
    'status.failed': '失败',
    'terminal.accountInitTimeout': '账户初始化超时。请检查网络或代理，然后重启终端组。',
    'status.awaiting_input': '等待确认',
    'status.idle': '空闲',
    'status.busy': '忙碌',
    'startup.trust': '请在下方终端确认目录信任，并完成出现的登录提示。确认后会自动继续启动。',
    'startup.auth': '请直接在下方终端完成登录，完成后会自动继续启动。',
    'startup.waiting': '终端正在准备，请完成下方出现的提示，随后会自动继续启动。',
    'startup.roleTrust': '等待目录信任确认',
    'startup.roleAuth': '等待登录',
    'startup.roleWaiting': '准备中',
    'cooperation.SENT': '已派发给 Antigravity',
    'cooperation.WORKING': 'Antigravity 实现中',
    'cooperation.DONE': '等待 Codex 审查',
    'cooperation.REVIEWING': 'Codex 审查中',
    'cooperation.APPROVED': '已完成审查',
    'cooperation.CHANGES_REQUESTED': '需要修改',
    'cooperation.FAILED': 'Agent 报告失败',
    'cooperation.reported': 'Agent 主动报告的协作状态',
    'cooperation.agentWorking': '正在处理',
    'cooperation.awaitingReview': '等待审查',
    'cooperation.agentReviewing': '正在审查',
    'cooperation.agentDone': '实现完成',
    'cooperation.agentApproved': '审查完成',
    'cooperation.agentChanges': '等待修改指令',
    'archive.task': '归档对话',
    'archive.project': '归档项目及其对话',
    'archive.title': '已归档对话',
    'archive.hint': '永久清除所有项目的已归档对话记录。项目源码文件会保留。',
    'archive.clear': '一键清除归档对话',
    'archive.summary': '已归档 {tasks} 个对话 · {projects} 个项目',
    'archive.unavailable': '有 {count} 个项目目录不可用',
    'archive.done': '已归档。',
    'archive.cleared': '已清除 {count} 个归档对话。',
    'archive.partial': '部分项目目录无法访问，未完成全部清除。',
    'archive.failed': '归档操作失败。',
    'project.none': '暂无活动项目',
    'empty.archivedTitle': '所有项目均已归档',
    'empty.archivedBody': '新增项目继续工作，或进入设置清除已归档对话。',
    'zen.enter': '禅模式',
    'zen.exit': '退出禅模式',
    'theme.toDark': '切换为深色模式',
    'theme.toLight': '切换为浅色模式',
    'repo.label': '当前项目',
    'project.switch': '切换项目',
    'project.new': '新增项目',
    'repo.loading': '正在读取仓库…',
    'repo.details': '显示仓库详情',
    'repo.hideDetails': '隐藏仓库详情',
    'repo.branch': '分支',
    'repo.commit': '提交',
    'repo.root': '路径',
    'workspace.eyebrow': '双终端工作台',
    'workspace.title': '工作台',
    'task.new': '新建任务',
    'task.list': '工作台任务',
    'task.none': '还没有工作台任务。',
    'task.search': '搜索任务或项目',
    'task.searchClear': '清空搜索',
    'task.searchNone': '没有找到匹配的任务',
    'task.searchUnloaded': '有 {count} 个项目的任务尚未加载；仅搜索已加载或缓存的任务。',
    'task.notLoaded': '任务尚未加载',
    'task.restart': '重启终端组',
    'task.close': '关闭任务',
    'task.closed': '任务已关闭',
    'task.created': '新的双终端任务已创建。',
    'task.restarted': '终端组已重启。',
    'task.error': '任务错误',
    'settings.open': '终端设置',
    'settings.eyebrow': '终端设置',
    'task.closeAll': '关闭所有终端',
    'task.allClosed': '所有工作台终端已关闭。',
    'settings.model': 'Codex 模型',
    'settings.effort': '推理强度',
    'settings.default': '使用默认设置',
    'settings.modelHint': '选择模型和推理强度，新建任务或重启终端组后生效。',
    'settings.title': '两个终端的启动命令',
    'settings.body': '新建任务和重启终端组都会使用这里保存的命令。',
    'settings.codex': 'Codex',
    'settings.antigravity': 'Antigravity',
    'settings.hint': '填写可执行文件名或绝对路径，例如 agy-proxy；不要填写 shell 参数。',
    'settings.cancel': '取消',
    'settings.save': '保存设置',
    'settings.saving': '保存中…',
    'settings.saved': '两个终端的启动命令已保存。',
    'settings.loadError': '无法读取终端设置。',
    'settings.saveError': '无法保存终端设置。',
    'settings.invalid': '两个启动命令都不能为空，并且必须是单行的可执行文件名或路径。',
    'empty.title': '开始一个双终端任务',
    'empty.body': '新建任务会打开全新的 Codex 与 Antigravity 终端，请直接在 Codex 终端中输入需求。',
    'empty.failed': '这项任务没有成功启动两个终端，请检查错误后重启终端组。',
    'status.live': 'localhost · 已连接',
    'status.starting': '启动中',
    'status.running': '运行中',
    'status.degraded': '有一个终端不可用',
    'status.exited': '已退出',
    'status.closed': '已关闭',
    'status.error': '失败',
    'terminal.codex': 'Codex',
    'terminal.antigravity': 'Antigravity',
    'terminal.planner': '规划 · 审查',
    'terminal.implementer': '实现者',
    'terminal.connecting': '连接中…',
    'terminal.unavailable': '此任务没有绑定可用的 Session。',
    'terminal.closed': '终端已关闭。',
    'terminal.inputError': '终端输入发送失败。',
    'terminal.resizeError': '终端尺寸调整失败。',
    'terminal.split': '调整终端宽度（双击恢复均分）',
    'terminal.focus': '聚焦终端',
    'terminal.restore': '恢复分屏',
    'terminal.switchFocus': '聚焦 {terminal}',
    'terminal.nativeBackend': '原生 PTY',
    'terminal.fallbackBackend': '已降级到 stdio',
    'terminal.unknownBackend': '后端未知',
    'action.refreshError': '工作台刷新失败。',
    'action.createError': '无法创建双终端任务。',
    'action.closeError': '无法关闭终端组。',
    'action.restartError': '无法重启终端组。',
    'action.retry': '重试',
  },
};

const state = {
  projects: [],
  projectId: null,
  projectEpoch: 0,
  projectTasks: new Map(),
  projectSelections: new Map(),
  expandedProjects: new Set(),
  taskSearch: '',
  locale: loadLocale(),
  theme: loadTheme(),
  repository: null,
  tasks: [],
  selectedId: null,
  selectedTask: null,
  terminalViews: new Map(),
  terminalPairKey: '',
  terminalSplitRatio: loadTerminalSplitRatio(),
  focusedTerminal: null,
  layoutFrame: null,
  actionBusy: false,
  startupContinuing: new Set(),
  refreshTimer: null,
  taskTimer: null,
  pollTimer: null,
  repoFactsOpen: false,
  settings: { ...DEFAULT_TERMINAL_COMMANDS },
  settingsBusy: false,
  settingsOpen: false,
  health: null,
  healthBusy: false,
  healthError: false,
  healthRequest: 0,
  healthController: null,
  healthOpen: false,
  archives: { tasks: 0, projects: 0, unavailableProjects: 0 },
  contextTarget: null,
  contextTrigger: null,
};

const capability = document.querySelector('meta[name="coordinate-agents-capability"]')?.content || '';

function loadTerminalSplitRatio() {
  try {
    const stored = localStorage.getItem('coordinate-agents-terminal-split');
    const ratio = stored?.trim() ? Number(stored) : NaN;
    if (Number.isFinite(ratio)) return Math.max(0.25, Math.min(0.75, ratio));
  } catch { /* Browser storage is optional. */ }
  return 0.5;
}

function setTerminalSplitRatio(ratio, persist = true) {
  if (!Number.isFinite(ratio)) return;
  state.terminalSplitRatio = Math.max(0.25, Math.min(0.75, ratio));
  if (persist) {
    try { localStorage.setItem('coordinate-agents-terminal-split', String(state.terminalSplitRatio)); }
    catch { /* Browser storage is optional. */ }
  }
  updateTerminalLayout();
}

function loadTheme() {
  try {
    if (localStorage.getItem('coordinate-agents-workspace-theme') === 'dark') return 'dark';
  } catch { /* Browser storage is optional. */ }
  return 'light';
}

function terminalTheme(theme = state.theme) {
  if (theme === 'dark') return {
    background: '#080d18', foreground: '#e7efff', cursor: '#a7bcff', cursorAccent: '#080d18',
    selectionBackground: 'rgba(130, 158, 255, .35)',
    black: '#1e293b', red: '#f87171', green: '#4ade80', yellow: '#facc15',
    blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#cbd5e1',
    brightBlack: '#94a3b8', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde047',
    brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#f8fafc',
  };
  return {
    background: '#ffffff', foreground: '#172033', cursor: '#2563eb', cursorAccent: '#ffffff',
    selectionBackground: 'rgba(37, 99, 235, .18)',
    black: '#1f2937', red: '#b91c1c', green: '#15803d', yellow: '#a16207',
    blue: '#1d4ed8', magenta: '#7e22ce', cyan: '#0e7490', white: '#4b5563',
    brightBlack: '#64748b', brightRed: '#dc2626', brightGreen: '#166534', brightYellow: '#854d0e',
    brightBlue: '#2563eb', brightMagenta: '#9333ea', brightCyan: '#0891b2', brightWhite: '#111827',
  };
}

function renderTheme() {
  document.documentElement.dataset.theme = state.theme;
  const button = document.querySelector('#theme-button');
  const label = t(state.theme === 'dark' ? 'theme.toLight' : 'theme.toDark');
  if (button) {
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(state.theme === 'dark'));
  }
  for (const controller of state.terminalViews.values()) {
    if (controller.terminal) controller.terminal.options.theme = terminalTheme();
  }
}

function setTheme(theme) {
  if (!['light', 'dark'].includes(theme)) return;
  state.theme = theme;
  try { localStorage.setItem('coordinate-agents-workspace-theme', theme); } catch { /* Optional. */ }
  renderTheme();
}

function loadLocale() {
  try {
    const stored = localStorage.getItem('coordinate-agents-workspace-locale');
    if (stored === 'zh' || stored === 'en') return stored;
  } catch { /* Browser storage is optional. */ }
  return document.documentElement.lang?.startsWith('zh') ? 'zh' : 'en';
}

function t(key) {
  return I18N[state.locale]?.[key] || I18N.en[key] || key;
}

function localeCode() {
  return state.locale === 'zh' ? 'zh-CN' : 'en';
}

function escapeHtml(value) {
  return `${value ?? ''}`
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function bounded(value, limit = MAX_VISIBLE_ERROR) {
  return `${value ?? ''}`.slice(0, limit);
}

function formatTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(state.locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function statusKey(status) {
  return `${status || 'starting'}`.toLowerCase();
}

function statusLabel(status) {
  return t(`status.${statusKey(status)}`) || status || '—';
}

function sessionState(session) {
  return session?.state || session?.status || null;
}

function sessionIsActive(session) {
  return isActiveTerminalSession({ state: sessionState(session) });
}

async function fetchJson(path, options = {}) {
  const projectId = options.projectId === undefined ? state.projectId : options.projectId;
  const { projectId: ignoredProjectId, ...requestOptions } = options;
  const scoped = projectId && path.startsWith('/api/') && path !== '/api/projects';
  const endpoint = scoped ? `/api/projects/${encodeURIComponent(projectId)}${path}` : path;
  const response = await fetch(endpoint, { cache: 'no-store', ...requestOptions,
    headers: { ...requestOptions.headers, [CAPABILITY_HEADER]: capability } });
  let payload = null;
  try { payload = await response.json(); } catch { /* The error below is enough. */ }
  if (!response.ok) {
    const error = new Error(payload?.error?.message || payload?.error || `Request failed with status ${response.status}`);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function postAction(action, params = {}, projectId = state.projectId) {
  const payload = await fetchJson(ACTION_ENDPOINT, {
    projectId,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [CAPABILITY_HEADER]: capability,
      'x-correlation-id': `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    },
    body: JSON.stringify({ action, params }),
  });
  if (!payload?.ok) {
    const error = new Error(payload?.error?.message || `${action} failed.`);
    error.payload = payload;
    throw error;
  }
  return payload;
}

function showToast(message, kind = 'info') {
  const region = document.querySelector('#toast-region');
  if (!region) return;
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  region.append(toast);
  window.setTimeout(() => toast.remove(), 4_000);
}

function setBusy(busy) {
  state.actionBusy = busy;
  for (const id of ['new-task-button', 'empty-new-task', 'close-task-button', 'restart-task-button', 'close-all-terminals-button', 'refresh-button', 'terminal-settings-button', 'archive-clear-button', 'project-switcher']) {
    const element = document.querySelector(`#${id}`);
    if (element) element.disabled = busy;
  }
}

function settingsError(message = '') {
  const element = document.querySelector('#terminal-settings-error');
  if (!element) return;
  element.hidden = !message;
  element.textContent = message;
}

function renderModelChoices() {
  const select = document.querySelector('#codex-model');
  const models = [...(state.settings.models || [])];
  const saved = state.settings.model || '';
  if (saved && !models.some(model => model.id === saved)) models.push({ id: saved, name: saved, efforts: [] });
  select.innerHTML = `<option value="">${escapeHtml(t('settings.default'))}</option>` + models.map(model => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.name)}</option>`).join('');
  select.value = saved;
  renderEffortChoices(state.settings.effort || '');
}

function renderEffortChoices(saved = '') {
  const model = (state.settings.models || []).find(item => item.id === document.querySelector('#codex-model').value);
  const efforts = [...(model?.efforts || [])];
  if (saved && !efforts.includes(saved)) efforts.push(saved);
  const labels = state.locale === 'zh' ? { none: '无', minimal: '极低', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大', ultra: '极高' } : {};
  const select = document.querySelector('#codex-effort');
  select.innerHTML = `<option value="">${escapeHtml(t('settings.default'))}</option>` + efforts.map(effort => `<option value="${escapeHtml(effort)}">${escapeHtml(labels[effort] || effort)}</option>`).join('');
  select.value = saved;
}

function renderSettingsForm() {
  const codex = document.querySelector('#codex-command');
  const antigravity = document.querySelector('#antigravity-command');
  renderModelChoices();
  if (codex) codex.value = state.settings.codex || DEFAULT_TERMINAL_COMMANDS.codex;
  if (antigravity) antigravity.value = state.settings.antigravity || DEFAULT_TERMINAL_COMMANDS.antigravity;
}

function canEditProjectSettings() { return Boolean(state.projectId) && state.projects.find(project => project.id === state.projectId)?.available !== false; }

function setSettingsBusy(busy) {
  state.settingsBusy = busy;
  for (const id of ['terminal-settings-close', 'terminal-settings-cancel', 'terminal-settings-save', 'codex-command', 'codex-model', 'codex-effort', 'antigravity-command']) {
    const element = document.querySelector(`#${id}`);
    if (element) element.disabled = busy;
  }
  const save = document.querySelector('#terminal-settings-save');
  if (save) { save.textContent = busy ? t('settings.saving') : t('settings.save'); save.disabled = busy || !canEditProjectSettings(); }
  for (const id of ['codex-command', 'codex-model', 'codex-effort', 'antigravity-command']) {
    const field = document.querySelector(`#${id}`); if (field) field.disabled = busy || !canEditProjectSettings();
  }
  renderArchiveSummary();
}

function closeSettings({ force = false } = {}) {
  if (state.settingsBusy && !force) return;
  const dialog = document.querySelector('#terminal-settings-dialog');
  if (dialog) dialog.hidden = true;
  state.settingsOpen = false;
  settingsError();
  document.querySelector('#terminal-settings-button')?.focus();
}

async function openSettings() {
  const projectId = state.projectId;
  const epoch = state.projectEpoch;
  if (state.actionBusy || state.settingsBusy) return;
  closeContextMenu();
  const dialog = document.querySelector('#terminal-settings-dialog');
  if (!dialog) return;
  state.settingsOpen = true;
  settingsError();
  renderSettingsForm();
  dialog.hidden = false;
  setSettingsBusy(true);
  dialog.setAttribute('aria-busy', 'true');
  try {
    const [settingsResult, archiveResult] = await Promise.allSettled([fetchJson(WORKSPACE_SETTINGS_ENDPOINT), postAction('workspaceArchivesStatus', {}, null)]);
    if (projectId !== state.projectId || epoch !== state.projectEpoch) return;
    if (archiveResult.status === 'fulfilled') { state.archives = archiveResult.value; renderArchiveSummary(); }
    else settingsError(archiveResult.reason?.message || t('settings.loadError'));
    if (settingsResult.status !== 'fulfilled') { settingsError(settingsResult.reason?.message || t('settings.loadError')); return; }
    const payload = settingsResult.value;
    state.settings = {
      models: payload?.codex?.models || [],
      effort: readCodexEffort(payload?.codex?.args || []),
      args: payload?.codex?.args || [],
      argsSource: payload?.codex?.argsSource,
      model: readCodexModel(payload?.codex?.args || []),
      codex: payload?.codex?.command || DEFAULT_TERMINAL_COMMANDS.codex,
      antigravity: payload?.antigravity?.command || DEFAULT_TERMINAL_COMMANDS.antigravity,
    };
    if (state.settingsOpen) renderSettingsForm();
  } catch (error) {
    if (projectId === state.projectId && epoch === state.projectEpoch) settingsError(error.message || t('settings.loadError'));
  } finally {
    if (projectId === state.projectId && epoch === state.projectEpoch) {
      dialog.removeAttribute('aria-busy');
      setSettingsBusy(false);
      if (state.settingsOpen) document.querySelector('#codex-command')?.focus();
    }
  }
}

function readCodexModel(args) {
  let model = '';
  args.forEach((arg, index) => {
    if (arg === '--model' || arg === '-m') model = args[index + 1] || '';
    else if (arg.startsWith('--model=')) model = arg.slice(8);
  });
  return model;
}

function replaceCodexModel(args, model) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--model' || arg === '-m') { index += 1; continue; }
    if (arg.startsWith('--model=')) continue;
    result.push(arg);
  }
  if (model) result.push('--model', model);
  return result;
}

function readCodexEffort(args) {
  let effort = '';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = arg === '-c' || arg === '--config' ? args[++index] : arg.startsWith('--config=') ? arg.slice(9) : '';
    const match = value?.match(/^model_reasoning_effort\s*=\s*["']?([a-z]+)["']?$/);
    if (match) effort = match[1];
  }
  return effort;
}

function replaceCodexEffort(args, effort) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if ((arg === '-c' || arg === '--config') && /^model_reasoning_effort\s*=/.test(args[index + 1] || '')) { index += 1; continue; }
    if (/^--config=model_reasoning_effort\s*=/.test(arg)) continue;
    result.push(arg);
  }
  if (effort) result.push('-c', `model_reasoning_effort="${effort}"`);
  return result;
}

async function saveSettings(event) {
  event?.preventDefault();
  if (state.actionBusy || state.settingsBusy || !canEditProjectSettings()) return;
  const commands = {
    codex: `${document.querySelector('#codex-command')?.value || ''}`.trim(),
    antigravity: `${document.querySelector('#antigravity-command')?.value || ''}`.trim(),
  };
  if (!commands.codex || !commands.antigravity || /[\u0000-\r\n\u007F]/.test(commands.codex) || /[\u0000-\r\n\u007F]/.test(commands.antigravity)) {
    settingsError(t('settings.invalid'));
    return;
  }
  const model = document.querySelector('#codex-model').value.trim();
  const effort = document.querySelector('#codex-effort').value;
  if (model && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)) {
    settingsError(state.locale === 'zh' ? '请输入有效的模型 ID。' : 'Enter a valid model ID.');
    return;
  }
  const args = replaceCodexEffort(replaceCodexModel(state.settings.args || [], model), effort);
  setBusy(true);
  setSettingsBusy(true);
  settingsError();
  try {
    await postAction('workspaceSettingsSave', { ...commands, args });
    state.settings = { ...state.settings, ...commands, model, effort, args };
    closeSettings({ force: true });
    showToast(t('settings.saved'), 'success');
    void checkWorkspaceHealth();
  } catch (error) {
    settingsError(error.payload?.error?.message || error.message || t('settings.saveError'));
  } finally {
    setSettingsBusy(false);
    setBusy(false);
  }
}

function healthTerminal() {
  const tasks = state.tasks.map(task => task.id === state.selectedTask?.id ? state.selectedTask : task);
  const sessions = tasks.flatMap(task => Object.values(task.sessions || {}));
  if (sessions.some(session => session.backend === 'stdio-fallback')) return { status: 'warning', backend: 'stdio-fallback', reason: 'STDIO_FALLBACK' };
  if (sessions.some(session => session.backend === 'node-pty')) return { status: 'ok', backend: 'node-pty' };
  return { status: 'pending', backend: null,
    ...(state.health?.checks?.node?.version?.startsWith('v18.') ? { reason: 'NODE18_STDIO_COMPATIBILITY' } : {}) };
}

function healthSummaryStatus() {
  if (state.healthBusy || state.healthError || !state.health) return 'pending';
  const checks = { ...state.health.checks, terminal: healthTerminal() };
  if (Object.values(checks).some(check => check.status === 'missing')) return 'missing';
  if (['node', 'git', 'codex', 'antigravity'].some(id => checks[id]?.status === 'pending')) return 'pending';
  return Object.values(checks).some(check => check.status === 'warning') ? 'warning' : 'ok';
}

function renderWorkspaceHealth() {
  const button = document.querySelector('#workspace-health-button');
  const panel = document.querySelector('#workspace-health-panel');
  if (!button || !panel) return;
  const status = healthSummaryStatus();
  const symbols = { ok: '✓', warning: '!', missing: '×', pending: '○' };
  const labels = { ok: 'health.ready', warning: 'health.warning', missing: 'health.missing', pending: 'health.pending' };
  const summary = state.healthBusy ? t('health.loading') : state.healthError ? t('health.error') : t(labels[status]);
  button.dataset.healthStatus = status;
  button.setAttribute('aria-expanded', String(state.healthOpen));
  button.title = t('health.open');
  document.querySelector('#workspace-health-label').textContent = state.healthBusy ? t('health.loading') : t(labels[status]);
  document.querySelector('#workspace-health-indicator').textContent = symbols[status];
  panel.hidden = !state.healthOpen;
  panel.setAttribute('aria-busy', String(state.healthBusy));
  document.querySelector('#workspace-health-summary').textContent = summary;
  document.querySelector('#workspace-health-close').setAttribute('aria-label', t('health.close'));
  document.querySelector('#workspace-health-recheck').disabled = state.healthBusy || !state.projectId;
  const rows = document.querySelector('#workspace-health-checks');
  if (state.healthBusy || !state.health) { rows.innerHTML = ''; return; }
  const expanded = new Set([...rows.querySelectorAll('details[open]')].map(detail => detail.dataset.healthDetail));
  const names = { node: 'Node.js', git: 'Git', codex: 'Codex CLI', antigravity: 'Antigravity CLI', terminal: 'Terminal / PTY' };
  const statusLabels = { ok: 'health.ok', warning: 'health.statusWarning', missing: 'health.statusMissing', pending: 'health.statusPending' };
  rows.innerHTML = Object.entries({ ...state.health.checks, terminal: healthTerminal() }).map(([id, check]) => {
    let hint = t('health.details');
    if (check.status === 'missing') hint = t(id === 'node' ? 'health.nodeHint' : id === 'git' ? 'health.gitHint' : id === 'codex' ? 'health.codexMissing' : 'health.antigravityMissing');
    else if (check.reason?.includes('TIMEOUT') || check.reason === 'DETECTION_FAILED') hint = t('health.timeout');
    else if (check.reason === 'STDIO_FALLBACK') hint = t('health.fallback');
    else if (check.reason === 'NODE18_STDIO_COMPATIBILITY') hint = t('health.node18');
    else if (id === 'terminal' && check.status === 'pending') hint = t('health.terminalPending');
    else if (check.status === 'warning') hint = t('health.versionUnknown');
    else if (check.authenticated === 'unknown') hint = t('health.authUnknown');
    const cliInstalled = check.authenticated === 'unknown' && ['ok', 'warning'].includes(check.status);
    const value = check.command || (check.backend === 'stdio-fallback' ? 'stdio fallback' : check.backend) || check.version || t('health.notStarted');
    return `<div class="health-row"><div class="health-row-heading"><span data-health-status="${check.status}" aria-hidden="true">${symbols[check.status]}</span><strong>${names[id]}</strong><span class="health-value">${escapeHtml(value)}${check.command && check.version ? ` · ${escapeHtml(check.version)}` : ''}</span><span class="health-status" data-health-status="${check.status}">${t(statusLabels[check.status])}</span></div>
      <details data-health-detail="${id}"${expanded.has(id) ? ' open' : ''}><summary>${escapeHtml(hint)}</summary>
      ${check.command ? `<p>${t('health.command')}: <code>${escapeHtml(check.command)}</code></p>` : ''}
      ${check.reason ? `<p><code>${escapeHtml(check.reason)}</code></p>` : ''}
      ${cliInstalled ? `<p>${t('health.authUnknown')}</p><p>${t('health.authHint')}</p>` : ''}
      ${id === 'codex' && check.status === 'missing' ? `<code>npm install -g @openai/codex</code><br><button class="secondary-button health-copy" type="button" data-health-copy>${t('health.copy')}</button>` : ''}</details></div>`;
  }).join('');
}

async function checkWorkspaceHealth() {
  state.healthController?.abort();
  const request = ++state.healthRequest;
  const epoch = state.projectEpoch;
  const projectId = state.projectId;
  state.health = null;
  state.healthError = false;
  state.healthBusy = Boolean(projectId);
  renderWorkspaceHealth();
  if (!projectId) return;
  const controller = new AbortController();
  state.healthController = controller;
  const timer = window.setTimeout(() => controller.abort(), 10000);
  try {
    const health = await fetchJson('/api/workspace-health', { projectId, signal: controller.signal });
    if (request !== state.healthRequest || epoch !== state.projectEpoch || projectId !== state.projectId) return;
    state.health = health;
  } catch {
    if (request === state.healthRequest && epoch === state.projectEpoch && projectId === state.projectId) state.healthError = true;
  } finally {
    window.clearTimeout(timer);
    if (request === state.healthRequest && epoch === state.projectEpoch && projectId === state.projectId) {
      state.healthBusy = false;
      renderWorkspaceHealth();
    }
  }
}

function setHealthOpen(open, { focus = false } = {}) {
  state.healthOpen = open;
  if (!open) {
    try { localStorage.setItem(HEALTH_SEEN_KEY, 'true'); } catch { /* Optional storage. */ }
  }
  renderWorkspaceHealth();
  if (focus) document.querySelector(open ? '#workspace-health-recheck' : '#workspace-health-button')?.focus();
}

function showHealthOnboarding() {
  try { if (localStorage.getItem(HEALTH_SEEN_KEY) === 'true') return; } catch { /* Optional storage. */ }
  if (!state.projectTasks.has(state.projectId)) return;
  const active = [...state.projectTasks.values()].flat().some(task =>
    ['STARTING', 'AWAITING_INPUT', 'RUNNING', 'DEGRADED'].includes(task.status)
    || Object.values(task.sessions || {}).some(isActiveTerminalSession));
  if (!active) setHealthOpen(true);
}

function renderLocale() {
  renderTheme();
  document.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : 'en';
  document.body.dataset.locale = state.locale === 'zh' ? 'zh-CN' : 'en';
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  document.querySelector('#lang-zh')?.classList.toggle('active', state.locale === 'zh');
  document.querySelector('#lang-en')?.classList.toggle('active', state.locale === 'en');
  document.querySelector('#lang-zh')?.setAttribute('aria-pressed', `${state.locale === 'zh'}`);
  document.querySelector('#lang-en')?.setAttribute('aria-pressed', `${state.locale === 'en'}`);
  renderRepository();
  renderTaskList();
  renderSelectedTask();
  updateTerminalLayout();
  renderArchiveSummary();
  renderWorkspaceHealth();
}

function setZenMode(enabled) {
  const active = Boolean(enabled && state.selectedTask);
  document.body.classList.toggle('zen-mode', active);
  document.querySelector('#zen-button')?.setAttribute('aria-pressed', String(active));
  const exit = document.querySelector('#zen-exit');
  if (exit) exit.hidden = !active;
  // Keep the same PTYs and xterm instances; only recompute their visible size.
  window.requestAnimationFrame(() => {
    for (const controller of state.terminalViews.values()) resizeTerminal(controller);
    (active ? exit : document.querySelector('#zen-button'))?.focus();
  });
}

function updateTerminalLayout() {
  const grid = document.querySelector('#agent-terminal-grid');
  if (!grid) return;
  grid.style.setProperty('--codex-width', `${state.terminalSplitRatio}fr`);
  grid.style.setProperty('--antigravity-width', `${1 - state.terminalSplitRatio}fr`);
  grid.dataset.focusedTerminal = state.focusedTerminal || '';
  for (const [slotId, controller] of state.terminalViews) {
    const hidden = Boolean(state.focusedTerminal && state.focusedTerminal !== slotId);
    if (hidden && !controller.card.hidden && controller.terminal) {
      controller.hiddenViewportAnchor = captureTerminalViewport(controller.terminal);
    }
    controller.card.hidden = hidden;
    const focusButton = controller.card.querySelector('[data-terminal-focus]');
    const focused = state.focusedTerminal === slotId;
    if (focusButton) {
      focusButton.title = t(focused ? 'terminal.restore' : 'terminal.focus');
      focusButton.setAttribute('aria-label', focusButton.title);
      focusButton.setAttribute('aria-pressed', String(focused));
      focusButton.querySelector('[data-focus-expand]').hidden = focused;
      focusButton.querySelector('[data-focus-restore]').hidden = !focused;
    }
    const switchButton = controller.card.querySelector('[data-terminal-focus-other]');
    if (switchButton) {
      switchButton.hidden = !focused;
      switchButton.title = t('terminal.switchFocus').replace('{terminal}', slotId === 'codex' ? 'Antigravity' : 'Codex');
      switchButton.setAttribute('aria-label', switchButton.title);
    }
  }
  const splitter = grid.querySelector('[data-terminal-splitter]');
  if (splitter) splitter.hidden = Boolean(state.focusedTerminal);
  splitter?.setAttribute('aria-valuenow', String(Math.round(state.terminalSplitRatio * 100)));
  splitter?.setAttribute('aria-label', t('terminal.split'));
  if (splitter) splitter.title = t('terminal.split');
  if (state.layoutFrame !== null) return;
  state.layoutFrame = window.requestAnimationFrame(() => {
    state.layoutFrame = null;
    for (const controller of state.terminalViews.values()) {
      resizeTerminal(controller);
      if (!controller.card.hidden && controller.hiddenViewportAnchor !== undefined) {
        restoreTerminalViewport(controller.terminal, controller.hiddenViewportAnchor);
        delete controller.hiddenViewportAnchor;
      }
    }
  });
}

function setTerminalFocus(slotId) {
  if (!state.terminalViews.has(slotId)) return;
  state.focusedTerminal = state.focusedTerminal === slotId ? null : slotId;
  updateTerminalLayout();
}

function bindTerminalLayout() {
  const grid = document.querySelector('#agent-terminal-grid');
  const splitter = grid?.querySelector('[data-terminal-splitter]');
  if (!splitter) return;
  let pointerId = null;
  const finish = event => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    document.body.classList.remove('terminal-split-dragging');
    if (splitter.hasPointerCapture(event.pointerId)) splitter.releasePointerCapture(event.pointerId);
    setTerminalSplitRatio(state.terminalSplitRatio);
  };
  splitter.addEventListener('pointerdown', event => {
    if (event.button !== 0 || window.matchMedia('(max-width: 900px)').matches) return;
    event.preventDefault();
    pointerId = event.pointerId;
    splitter.setPointerCapture(pointerId);
    document.body.classList.add('terminal-split-dragging');
  });
  splitter.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId) return;
    const rect = grid.getBoundingClientRect();
    const dividerWidth = splitter.getBoundingClientRect().width;
    const available = rect.width - dividerWidth;
    if (available > 0) setTerminalSplitRatio((event.clientX - rect.left - dividerWidth / 2) / available, false);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) splitter.addEventListener(name, finish);
  splitter.addEventListener('dblclick', () => setTerminalSplitRatio(0.5));
  splitter.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault();
    setTerminalSplitRatio(event.key === 'Home' ? 0.5 : state.terminalSplitRatio + (event.key === 'ArrowLeft' ? -0.05 : 0.05));
  });
}

function renderRepository() {
  const repository = state.repository;
  const name = document.querySelector('#repo-name');
  const branch = document.querySelector('#repo-branch');
  renderProjectSwitcher();
  const repoToggle = document.querySelector('#repo-facts-toggle');
  if (repoToggle) {
    repoToggle.title = t(state.repoFactsOpen ? 'repo.hideDetails' : 'repo.details');
    repoToggle.setAttribute('aria-label', repoToggle.title);
    repoToggle.setAttribute('aria-expanded', `${state.repoFactsOpen}`);
  }
  if (!repository) {
    if (name) name.textContent = t('repo.loading');
    if (branch) branch.textContent = '—';
    return;
  }
  if (name) name.textContent = repository.name || repository.root || '—';
  if (branch) branch.textContent = repository.branch || (repository.detached ? 'detached' : '—');
  if (branch) branch.title = branch.textContent;
  if (name) name.title = repository.root || repository.name || '';
  const facts = document.querySelector('#repo-facts');
  if (!facts) return;
  facts.hidden = !state.repoFactsOpen;
  facts.innerHTML = [
    `<div><span>${escapeHtml(t('repo.root'))}</span><code>${escapeHtml(repository.root || '—')}</code></div>`,
    `<div><span>${escapeHtml(t('repo.branch'))}</span><code>${escapeHtml(repository.branch || '—')}</code></div>`,
    `<div><span>${escapeHtml(t('repo.commit'))}</span><code>${escapeHtml(repository.head?.short || '—')}</code></div>`,
  ].join('');
}

function projectText(zh, en) { return state.locale === 'zh' ? zh : en; }

function renderProjectSwitcher() {
  const select = document.querySelector('#project-switcher');
  if (!select) return;
  const key = JSON.stringify([state.locale, state.projects]);
  if (select.dataset.renderKey !== key) {
    select.dataset.renderKey = key;
    select.innerHTML = state.projects.length ? state.projects.map(project => `<option value="${escapeHtml(project.id)}" ${project.available === false ? 'disabled' : ''}>${escapeHtml(project.name)}${project.available === false ? ` · ${projectText('不可用', 'Unavailable')}` : ''}</option>`).join('') : `<option value="">${escapeHtml(t('project.none'))}</option>`;
  }
  select.value = state.projectId || '';
  select.disabled = state.actionBusy || state.settingsBusy || state.projects.length === 0;
  select.title = t('project.switch');
  select.setAttribute('aria-label', t('project.switch'));
  const add = document.querySelector('[data-project-add-label]');
  if (add) add.textContent = t('project.new');
}

function rememberSelection() {
  if (!state.projectId) return;
  state.projectSelections.set(state.projectId, state.selectedId);
  try {
    localStorage.setItem(`workspace-selection-${state.projectId}`, state.selectedId || '');
    window.history.replaceState(null, '', `#${state.projectId}${state.selectedId ? `/${encodeURIComponent(state.selectedId)}` : ''}`);
  } catch { /* Optional browser persistence. */ }
}

function searchTaskGroups() {
  const query = state.taskSearch.trim().toLowerCase();
  let unloaded = 0;
  const groups = [];
  for (const project of state.projects) {
    const loaded = state.projectTasks.has(project.id);
    if (!loaded) unloaded++;
    const cached = project.id === state.projectId ? state.tasks : state.projectTasks.get(project.id) || [];
    const projectMatches = project.name.toLowerCase().includes(query);
    const tasks = !query || projectMatches ? cached : cached.filter(task => `${task.title || ''}`.toLowerCase().includes(query));
    if (!query || projectMatches || tasks.length) groups.push({ project, tasks, loaded });
  }
  return { groups, unloaded };
}

function renderProjects() {
  renderProjectSwitcher();
  const host = document.querySelector('#project-list');
  const list = document.querySelector('#workspace-task-list');
  if (!host || !list) return;
  const searching = Boolean(state.taskSearch.trim());
  const { groups, unloaded } = searchTaskGroups();
  const renderKey = JSON.stringify([state.locale, state.projectId, state.selectedId, state.taskSearch, groups, [...state.expandedProjects]]);
  if (host.dataset.renderKey === renderKey) return;
  host.dataset.renderKey = renderKey;
  list.remove();
  list.hidden = false;
  host.innerHTML = groups.map(({ project }) => `<section class="project-group">
    <button type="button" class="project-heading${project.id === state.projectId ? ' selected' : ''}" data-project="${escapeHtml(project.id)}" aria-current="${project.id === state.projectId}" aria-expanded="${searching || state.expandedProjects.has(project.id)}" title="${escapeHtml(project.root)}">
      <svg class="project-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>
      <svg class="project-folder-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5.5a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/></svg>
      <strong>${escapeHtml(project.name)}</strong>
      ${project.available ? '' : `<small class="project-unavailable">${projectText('不可用', 'Unavailable')}</small>`}
    </button><div class="project-tasks" data-project-tasks="${escapeHtml(project.id)}" ${searching || state.expandedProjects.has(project.id) ? '' : 'hidden'}></div></section>`).join('');
  for (const { project, tasks, loaded } of groups) {
    const container = host.querySelector(`[data-project-tasks="${project.id}"]`);
    if (searching && !loaded) {
      const notice = document.createElement('p');
      notice.className = 'task-list-empty';
      notice.textContent = t('task.notLoaded');
      container.append(notice);
    }
    if (project.id === state.projectId) container.append(list);
    else {
      container.insertAdjacentHTML('beforeend', tasks.map(task => taskItemMarkup(task, project.id)).join(''));
      container.querySelectorAll('[data-workspace-task-id]').forEach(button => {
        button.onclick = () => void selectProject(project.id, button.dataset.workspaceTaskId);
      });
    }
  }
  if (!list.isConnected) { list.hidden = searching; host.append(list); }
  if (searching) {
    const messages = [];
    if (!groups.some(group => group.tasks.length)) messages.push(t('task.searchNone'));
    if (unloaded) messages.push(t('task.searchUnloaded').replace('{count}', unloaded));
    for (const message of messages) {
      const notice = document.createElement('p');
      notice.className = 'task-search-notice';
      notice.setAttribute('role', 'status');
      notice.textContent = message;
      host.append(notice);
    }
  }
  host.querySelectorAll('[data-project]').forEach(button => {
    button.onclick = async () => {
      const id = button.dataset.project;
      if (searching) {
        if (id !== state.projectId) await selectProject(id);
        return;
      }
      if (id === state.projectId) {
        if (state.expandedProjects.has(id)) state.expandedProjects.delete(id); else state.expandedProjects.add(id);
        renderProjects();
      } else await selectProject(id);
    };
  });
}

async function selectProject(id, taskId) {
  if (state.actionBusy || state.settingsBusy) return;
  const project = state.projects.find(item => item.id === id);
  if (!project) return;
  if (state.projectId) state.projectSelections.set(state.projectId, state.selectedId);
  closeSettings();
  closeContextMenu();
  disposeTerminalViews();
  state.projectEpoch++;
  state.projectId = id;
  if (!state.taskSearch.trim()) state.expandedProjects.add(id);
  let stored = null;
  try { stored = localStorage.getItem(`workspace-selection-${id}`); } catch { /* Optional. */ }
  state.selectedId = taskId === undefined ? state.projectSelections.get(id) || stored || null : taskId;
  state.selectedTask = null;
  state.tasks = [];
  state.repository = { name: project.name, root: project.root };
  void checkWorkspaceHealth();
  renderRepository(); renderTaskList(); renderSelectedTask(); rememberSelection();
  if (!project.available) { showToast(projectText('项目目录不可用', 'Project directory unavailable'), 'error'); return; }
  await refresh({ showError: true });
}

let folderPage = null;
let folderRequest = 0;
async function browseProjectFolder(path, offset = 0) {
  const request = ++folderRequest;
  const errorBox = document.querySelector('#project-error');
  const confirm = document.querySelector('#project-add');
  confirm.disabled = true;
  errorBox.textContent = '';
  try {
    const params = { offset, hidden: document.querySelector('#project-hidden').checked };
    if (path) params.path = path;
    const payload = await postAction('projectBrowse', params, null);
    if (request !== folderRequest) return;
    folderPage = payload.directory;
    document.querySelector('#project-path').value = folderPage.path;
    const entries = document.querySelector('#project-folders');
    entries.innerHTML = '';
    for (const folder of folderPage.entries) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = `▣ ${folder.name}`;
      button.onclick = () => void browseProjectFolder(folder.path);
      entries.append(button);
    }
    confirm.textContent = folderPage.needsInitialization
      ? projectText('添加并初始化', 'Add and initialize') : projectText('添加项目', 'Add project');
    document.querySelector('#project-init-note').textContent = folderPage.needsInitialization
      ? projectText('此文件夹将初始化 Git 和 Agent Bus，不创建提交。', 'This folder will initialize Git and Agent Bus without creating a commit.')
      : projectText('将使用 Git 仓库根目录并准备 Agent Bus。', 'Use the Git repository root and prepare Agent Bus.');
    document.querySelector('#project-next').disabled = folderPage.nextOffset === null;
    document.querySelector('#project-prev').disabled = offset === 0;
    folderPage.offset = offset;
    confirm.disabled = false;
  } catch (error) { if (request === folderRequest) { folderPage = null; errorBox.textContent = error.message; } }
}
async function openProjectDialog() {
  const button = document.querySelector('#new-project-button');
  if (button.disabled) return;
  button.disabled = true;
  let selection;
  try {
    ({ selection } = await postAction('projectPick', {}, null));
  } catch (error) {
    showToast(projectText('无法打开系统选择器，已切换到手动选择。', 'System chooser unavailable; use the manual browser.'), 'error');
    openManualProjectDialog();
    return;
  } finally { button.disabled = false; }
  if (!selection || selection.cancelled) return;
  if (selection.needsInitialization && !window.confirm(projectText(
    `将为以下文件夹初始化 Git 和 Agent Bus，不创建提交：\n${selection.path}\n\n添加并初始化？`,
    `Initialize Git and Agent Bus without a commit in:\n${selection.path}\n\nAdd and initialize?`))) return;
  button.disabled = true;
  try {
    const result = await postAction('projectAdd', { path: selection.path, initialize: selection.needsInitialization }, null);
    const payload = await fetchJson('/api/projects', { projectId: null });
    state.projects = payload.projects;
    await selectProject(result.project.id, null);
  } catch (error) { showToast(error.message, 'error'); }
  finally { button.disabled = false; }
}

function openManualProjectDialog() {
  const dialog = document.querySelector('#project-dialog');
  dialog.querySelector('h2').textContent = projectText('新增项目', 'New project');
  document.querySelector('#project-browse').textContent = projectText('打开路径', 'Open path');
  document.querySelector('#project-hidden-label').textContent = projectText('显示隐藏目录', 'Show hidden folders');
  document.querySelector('#project-up').textContent = projectText('上级目录', 'Parent folder');
  document.querySelector('#project-prev').textContent = projectText('上一页', 'Previous');
  document.querySelector('#project-next').textContent = projectText('下一页', 'Next');
  dialog.showModal();
  void browseProjectFolder();
}
function bindProjectDialog() {
  document.querySelector('#project-cancel').onclick = () => { folderRequest++; document.querySelector('#project-dialog').close(); };
  document.querySelector('#project-browse').onclick = () => void browseProjectFolder(document.querySelector('#project-path').value);
  document.querySelector('#project-path').oninput = () => { folderRequest++; folderPage = null; document.querySelector('#project-add').disabled = true; };
  document.querySelector('#project-path').onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); void browseProjectFolder(event.target.value); } };
  document.querySelector('#project-up').onclick = () => folderPage && void browseProjectFolder(folderPage.parent);
  document.querySelector('#project-hidden').onchange = () => void browseProjectFolder(document.querySelector('#project-path').value);
  document.querySelector('#project-next').onclick = () => folderPage && void browseProjectFolder(folderPage.path, folderPage.nextOffset);
  document.querySelector('#project-prev').onclick = () => folderPage && void browseProjectFolder(folderPage.path, Math.max(0, folderPage.offset - 100));
  document.querySelector('#project-add').onclick = async () => {
    if (!folderPage) return;
    const button = document.querySelector('#project-add'); button.disabled = true;
    try {
      const result = await postAction('projectAdd', { path: folderPage.path, initialize: folderPage.needsInitialization }, null);
      const payload = await fetchJson('/api/projects', { projectId: null });
      state.projects = payload.projects;
      document.querySelector('#project-dialog').close();
      await selectProject(result.project.id, null);
    } catch (error) { document.querySelector('#project-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
}

function renderTaskList() {
  for (const id of ['new-task-button', 'empty-new-task']) { const button = document.querySelector(`#${id}`); if (button) button.disabled = state.actionBusy || !state.projectId; }
  renderProjects();
  const list = document.querySelector('#workspace-task-list');
  const count = document.querySelector('#task-count');
  const input = document.querySelector('#task-search-input');
  if (input) { input.placeholder = t('task.search'); input.setAttribute('aria-label', t('task.search')); }
  const clear = document.querySelector('#task-search-clear');
  if (clear) { clear.hidden = !state.taskSearch; clear.title = t('task.searchClear'); clear.setAttribute('aria-label', clear.title); }
  if (!list) return;
  const searching = Boolean(state.taskSearch.trim());
  const groups = searchTaskGroups().groups;
  const tasks = searching ? groups.find(group => group.project.id === state.projectId)?.tasks || [] : state.tasks;
  if (count) count.textContent = `${searching ? groups.reduce((sum, group) => sum + group.tasks.length, 0) : state.tasks.length}`;
  const renderKey = JSON.stringify([state.locale, state.projectId, state.selectedId, state.taskSearch, tasks]);
  if (list.dataset.renderKey === renderKey) return;
  list.dataset.renderKey = renderKey;
  if (tasks.length === 0) {
    list.innerHTML = searching ? '' : `<p class="task-list-empty">${escapeHtml(t('task.none'))}</p>`;
    return;
  }
  list.innerHTML = tasks.map(task => taskItemMarkup(task, state.projectId)).join('');
  for (const item of list.querySelectorAll('[data-workspace-task-id]')) {
    item.addEventListener('click', () => selectTask(item.dataset.workspaceTaskId));
  }
}

function taskItemMarkup(task, projectId) {
  const selected = projectId === state.projectId && task.id === state.selectedId ? ' selected' : '';
  const codexState = statusKey(sessionState(task.sessions?.codex));
  const agyState = statusKey(sessionState(task.sessions?.antigravity));
  return `<button class="workspace-task-item${selected}" type="button" aria-current="${Boolean(selected)}" title="${escapeHtml(task.title)}" data-workspace-task-id="${escapeHtml(task.id)}" data-project-id="${escapeHtml(projectId || '')}">
      <span class="task-item-top"><strong>${escapeHtml(task.title)}</strong><span class="status-dot ${escapeHtml(statusKey(task.status))}" aria-hidden="true"></span></span>
      <span class="task-item-meta"><span class="task-item-status" title="${escapeHtml(statusLabel(task.status))}">${escapeHtml(statusLabel(task.status))}</span><span class="task-item-agents"><span class="mini-agent ${escapeHtml(codexState)}">Codex</span><span class="mini-agent ${escapeHtml(agyState)}">Antigravity</span></span><time>${escapeHtml(formatTime(task.updatedAt))}</time></span>
    </button>`;
}

function renderSelectedTask() {
  const workspaceHeading = document.querySelector('#workspace-heading');
  const taskHeading = document.querySelector('#task-heading');
  const taskActions = document.querySelector('#task-toolbar-actions');
  if (workspaceHeading) workspaceHeading.hidden = Boolean(state.selectedTask);
  if (taskHeading) taskHeading.hidden = !state.selectedTask;
  if (taskActions) taskActions.hidden = !state.selectedTask;
  const zenButton = document.querySelector('#zen-button');
  if (zenButton) zenButton.disabled = !state.selectedTask;
  if (!state.selectedTask && document.body.classList.contains('zen-mode')) setZenMode(false);
  const empty = document.querySelector('#empty-state');
  const panel = document.querySelector('#workspace-panel');
  if (!state.selectedTask) {
    if (empty) {
      empty.hidden = false;
      const title = empty.querySelector('h2'), body = empty.querySelector('p');
      if (title) title.textContent = t(state.projectId ? 'empty.title' : 'empty.archivedTitle');
      if (body) body.textContent = t(state.projectId ? 'empty.body' : 'empty.archivedBody');
    }
    if (panel) panel.hidden = true;
    return;
  }
  if (empty) empty.hidden = true;
  if (panel) panel.hidden = false;
  const task = state.selectedTask;
  const title = document.querySelector('#selected-task-title');
  const status = document.querySelector('#selected-task-status');
  const collaboration = document.querySelector('#selected-task-cooperation');
  if (collaboration) {
    const label = cooperationLabel(task.cooperation);
    collaboration.hidden = !label;
    collaboration.textContent = label;
    collaboration.className = `status-pill cooperation-pill ${statusKey(task.cooperation?.status || 'IDLE')}`;
    collaboration.title = [t('cooperation.reported'), task.cooperation?.summary, task.cooperation?.roundId].filter(Boolean).join('\n');
  }
  const id = document.querySelector('#selected-task-id');
  const version = document.querySelector('#selected-task-prompt-version');
  if (title) {
    title.textContent = task.title || '—';
    title.title = `${task.title || '—'}\n${task.id || ''}\nv${task.promptVersion || '2.3.0'}`;
  }
  if (status) {
    status.textContent = statusLabel(task.status);
    status.className = `status-pill ${statusKey(task.status)}`;
  }
  if (id) id.textContent = task.id || '—';
  if (version) version.textContent = `v${task.promptVersion || '2.3.0'}`;
  const startupNotice = document.querySelector('#task-startup');
  if (startupNotice) {
    const hint = ['STARTING', 'AWAITING_INPUT'].includes(task.status) ? startupHint(task.startup) : '';
    startupNotice.hidden = !hint;
    startupNotice.textContent = hint;
  }
  const error = document.querySelector('#task-error');
  if (error) {
    const message = taskErrorMessage(task);
    error.hidden = !message;
    error.textContent = message ? `${t('task.error')}: ${bounded(message)}` : '';
  }
  const close = document.querySelector('#close-task-button');
  const restart = document.querySelector('#restart-task-button');
  if (close) close.disabled = state.actionBusy || statusKey(task.status) === 'closed';
  if (restart) restart.disabled = state.actionBusy;

  const panes = selectTerminalPanes({ workspaceTask: task });
  const pairKey = panes.map(terminalSessionKey).join('|');
  if (pairKey !== state.terminalPairKey) {
    disposeTerminalViews();
    state.terminalPairKey = pairKey;
    renderTerminalViews(panes);
  } else {
    for (const pane of panes) {
      const controller = state.terminalViews.get(pane.slotId);
      if (controller && pane.session) controller.session = pane.session;
      updateTerminalHeader(pane);
    }
  }
}

function cooperationLabel(cooperation) {
  const status = cooperation?.status;
  return ['SENT', 'WORKING', 'DONE', 'REVIEWING', 'APPROVED', 'CHANGES_REQUESTED', 'FAILED'].includes(status)
    ? t(`cooperation.${status}`) : '';
}

function terminalRoleLabel(slot, cooperation, startup) {
  const startupState = startup?.slots?.[slot];
  if (startupState === 'TRUST_REQUIRED') return t('startup.roleTrust');
  if (startupState === 'AUTH_REQUIRED') return t('startup.roleAuth');
  if (['WAITING', 'INJECTING'].includes(startupState)) return t('startup.roleWaiting');
  const status = cooperation?.status;
  if (slot === 'codex') {
    if (status === 'DONE') return t('cooperation.awaitingReview');
    if (status === 'REVIEWING') return t('cooperation.agentReviewing');
    if (status === 'APPROVED') return t('cooperation.agentApproved');
  } else {
    if (status === 'WORKING') return t('cooperation.agentWorking');
    if (['DONE', 'REVIEWING', 'APPROVED'].includes(status)) return t('cooperation.agentDone');
    if (status === 'CHANGES_REQUESTED') return t('cooperation.agentChanges');
  }
  return t(slot === 'codex' ? 'terminal.planner' : 'terminal.implementer');
}

function startupHint(startup) {
  const states = Object.values(startup?.slots || {});
  if (states.includes('TRUST_REQUIRED')) return t('startup.trust');
  if (states.includes('AUTH_REQUIRED')) return t('startup.auth');
  if (states.some(value => value !== 'READY')) return t('startup.waiting');
  return '';
}

function taskErrorMessage(task) {
  if (task.error?.message || task.error?.details) return task.error.message || task.error.details;
  for (const [slot, session] of Object.entries(task.sessions || {})) {
    const agent = slot === 'codex' ? 'Codex' : 'Antigravity';
    if (session.startupFailure === 'account-init-timeout') return `${agent}: ${t('terminal.accountInitTimeout')}`;
    if (session.error) return `${agent}: ${session.error}`;
  }
  return '';
}

function terminalCardMarkup(pane) {
  return `<article class="terminal-card" data-terminal-slot="${escapeHtml(pane.slotId)}">
    <header class="terminal-card-header">
      <div class="terminal-card-title"><span class="terminal-agent-mark ${escapeHtml(pane.slotId)}">${pane.slotId === 'codex' ? 'C' : 'A'}</span><div><strong>${escapeHtml(t(`terminal.${pane.slotId}`))}</strong><span data-terminal-role>${escapeHtml(terminalRoleLabel(pane.slotId, state.selectedTask?.cooperation, state.selectedTask?.startup))}</span></div></div>
      <div class="terminal-card-actions">
        <span class="terminal-status" data-terminal-status>${escapeHtml(pane.sessionId ? t('terminal.connecting') : t('terminal.unavailable'))}</span>
        <button class="icon-button terminal-focus-button" type="button" data-terminal-focus-other="${pane.slotId === 'codex' ? 'antigravity' : 'codex'}" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7h13m-3-3 3 3-3 3M17 13H4m3-3-3 3 3 3"/></svg></button>
        <button class="icon-button terminal-focus-button" type="button" data-terminal-focus="${escapeHtml(pane.slotId)}" aria-pressed="false" title="${escapeHtml(t('terminal.focus'))}" aria-label="${escapeHtml(t('terminal.focus'))}">
          <svg data-focus-expand viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4"/></svg>
          <svg data-focus-restore viewBox="0 0 20 20" aria-hidden="true" hidden><path d="M7 3v4H3m14 0h-4V3M3 13h4v4m6 0v-4h4"/></svg>
        </button>
      </div>
    </header>
    <div class="terminal-screen" data-terminal-screen tabindex="0" aria-label="${escapeHtml(t(`terminal.${pane.slotId}`))}"></div>
    <footer class="terminal-card-footer"><code data-terminal-session>${escapeHtml(pane.sessionId || '—')}</code><span data-terminal-backend></span><span data-terminal-updated>—</span></footer>
  </article>`;
}

function renderTerminalViews(panes) {
  const grid = document.querySelector('#agent-terminal-grid');
  if (!grid) return;
  const splitter = '<div class="terminal-splitter" data-terminal-splitter role="separator" tabindex="0" aria-orientation="vertical" aria-valuemin="25" aria-valuemax="75" aria-controls="agent-terminal-grid"></div>';
  grid.innerHTML = panes.map(terminalCardMarkup).join(splitter);
  bindTerminalLayout();
  for (const pane of panes) {
    const card = grid.querySelector(`[data-terminal-slot="${CSS.escape(pane.slotId)}"]`);
    if (!card) continue;
    const controller = {
      projectId: state.projectId,
      pane,
      card,
      terminal: null,
      cursor: null,
      session: pane.session || null,
      inputQueue: Promise.resolve(),
      queuedInputBytes: 0,
      resizeTimer: null,
      resizeSending: false,
      pendingResize: null,
      lastSize: null,
      polling: false,
      pollTimer: null,
      readAgain: false,
      activeUntil: 0,
      disposed: false,
      finished: false,
      resizeObserver: null,
    };
    state.terminalViews.set(pane.slotId, controller);
    updateTerminalHeader(pane);
    if (!pane.sessionId || typeof window.Terminal !== 'function') {
      continue;
    }
    const screen = card.querySelector('[data-terminal-screen]');
    controller.terminal = new window.Terminal({
      cursorBlink: true,
      disableStdin: false,
      convertEol: false,
      scrollback: 2_000,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      minimumContrastRatio: 4.5,
      theme: terminalTheme(),
    });
    controller.terminal.open(screen);
    controller.terminal.onData(data => enqueueRawInput(controller, data));
    controller.terminal.onBinary(data => enqueueRawInput(controller, data));
    controller.resizeObserver = new ResizeObserver(() => resizeTerminal(controller));
    controller.resizeObserver.observe(screen);
    const renderedScreen = screen.querySelector('.xterm-screen');
    if (renderedScreen) controller.resizeObserver.observe(renderedScreen);
    screen.addEventListener('click', () => controller.terminal?.focus());
    window.requestAnimationFrame(() => resizeTerminal(controller));
  }
  updateTerminalLayout();
  void pollTerminalViews();
}

function updateTerminalHeader(pane) {
  const controller = state.terminalViews.get(pane.slotId);
  const card = controller?.card || document.querySelector(`[data-terminal-slot="${CSS.escape(pane.slotId)}"]`);
  if (!card) return;
  const role = card.querySelector('[data-terminal-role]');
  if (role) role.textContent = terminalRoleLabel(pane.slotId, state.selectedTask?.cooperation, state.selectedTask?.startup);
  const taskSession = state.selectedTask?.sessions?.[pane.slotId] || null;
  const session = controller?.session || pane.session || taskSession;
  const status = sessionState(session);
  const statusElement = card.querySelector('[data-terminal-status]');
  if (statusElement) statusElement.textContent = pane.sessionId
    ? (status ? statusLabel(status) : t('terminal.connecting'))
    : t('terminal.unavailable');
  statusElement?.classList.toggle('active', sessionIsActive(session));
  statusElement?.classList.toggle('failed', ['failed', 'exited'].includes(statusKey(status)));
  if (controller?.terminal && status) controller.terminal.options.disableStdin = !sessionIsActive(session);
  const sessionElement = card.querySelector('[data-terminal-session]');
  if (sessionElement) sessionElement.textContent = pane.sessionId || '—';
  const backendElement = card.querySelector('[data-terminal-backend]');
  if (backendElement) {
    backendElement.textContent = t(terminalBackendKey(session));
    const diagnostic = session?.diagnostics;
    backendElement.title = diagnostic ? [diagnostic.platform, `Node ${diagnostic.nodeVersion || '?'}`, diagnostic.nativeStatus,
      diagnostic.failure?.stage, diagnostic.failure?.code].filter(Boolean).join(' · ') : '';
  }
  const updated = card.querySelector('[data-terminal-updated]');
  if (updated) updated.textContent = formatTime(session?.lastActivityAt || session?.createdAt);
}

function disposeTerminalViews() {
  window.clearTimeout(state.pollTimer);
  state.pollTimer = null;
  for (const controller of state.terminalViews.values()) {
    controller.disposed = true;
    window.clearTimeout(controller.pollTimer);
    window.clearTimeout(controller.resizeTimer);
    controller.resizeObserver?.disconnect();
    controller.hiddenViewportAnchor?.marker?.dispose();
    controller.terminal?.dispose();
  }
  state.terminalViews.clear();
  state.terminalPairKey = '';
  const grid = document.querySelector('#agent-terminal-grid');
  if (grid) grid.innerHTML = '';
  document.body.classList.remove('terminal-split-dragging');
}

function enqueueRawInput(controller, input) {
  if (controller.disposed) return;
  controller.activeUntil = Date.now() + 1500;
  if (!controller.pane.sessionId || typeof input !== 'string' || input.length === 0) return;
  const knownSession = controller.session || state.selectedTask?.sessions?.[controller.pane.slotId];
  if (sessionState(knownSession) && !sessionIsActive(knownSession)) return;
  const chunks = [];
  let chunk = '';
  let chunkBytes = 0;
  let bytes = 0;
  for (const character of input) {
    const characterBytes = UTF8_ENCODER.encode(character).byteLength;
    if (chunk && chunkBytes + characterBytes > MAX_INPUT_BYTES) {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
    bytes += characterBytes;
  }
  if (chunk) chunks.push(chunk);
  if (controller.queuedInputBytes + bytes > MAX_INPUT_QUEUE_BYTES) {
    showToast(t('terminal.inputError'), 'error');
    return;
  }
  controller.queuedInputBytes += bytes;
  controller.inputQueue = controller.inputQueue.then(async () => {
    for (const chunk of chunks) {
      if (controller.disposed) return;
      await postAction('sessionWrite', {
        sessionId: controller.pane.sessionId,
        input: chunk,
        submit: false,
      }, controller.projectId);
      scheduleTerminalRead(controller, 0);
    }
  }).catch(error => {
    showToast(error.payload?.error?.message || t('terminal.inputError'), 'error');
  }).finally(() => {
    controller.queuedInputBytes = Math.max(0, controller.queuedInputBytes - bytes);
  });
}

function terminalSize(controller) {
  const screen = controller.card.querySelector('[data-terminal-screen]');
  const terminal = controller.terminal;
  const rendered = screen?.querySelector('.xterm-screen');
  if (!screen || !rendered || !terminal) return null;
  const cellWidth = rendered.getBoundingClientRect().width / terminal.cols;
  const cellHeight = rendered.getBoundingClientRect().height / terminal.rows;
  if (!(cellWidth > 0) || !(cellHeight > 0)) return null;
  const style = window.getComputedStyle(screen);
  const viewport = screen.querySelector('.xterm-viewport');
  const scrollbar = viewport ? viewport.offsetWidth - viewport.clientWidth : 0;
  const width = screen.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - scrollbar;
  const height = screen.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (width <= 0 || height <= 0) return null;
  return {
    cols: Math.max(1, Math.min(1000, Math.floor(width / cellWidth))),
    rows: Math.max(1, Math.min(500, Math.floor(height / cellHeight))),
  };
}

function resizeTerminal(controller) {
  if (controller.disposed || !controller.terminal || !controller.pane.sessionId) return;
  const size = terminalSize(controller);
  if (!size || size.cols < 1 || size.rows < 1) return;
  const key = `${size.cols}x${size.rows}`;
  if (controller.lastSize === key && !controller.pendingResize && !controller.resizeSending) return;
  if (controller.pendingResize && `${controller.pendingResize.cols}x${controller.pendingResize.rows}` === key) return;
  const viewport = captureTerminalViewport(controller.terminal);
  try {
    controller.terminal.resize(size.cols, size.rows);
    restoreTerminalViewport(controller.terminal, viewport);
  } catch { viewport?.marker?.dispose(); return; }
  controller.pendingResize = size;
  // Fit xterm immediately, but send only the latest PTY size at a bounded rate.
  if (!controller.resizeTimer && !controller.resizeSending) {
    controller.resizeTimer = window.setTimeout(() => void flushTerminalResize(controller), 100);
  }
}

function captureTerminalViewport(terminal) {
  const buffer = terminal.buffer.active;
  if (buffer.viewportY >= buffer.baseY) return null;
  // Markers follow the original output when a width change reflows wrapped lines.
  return { line: buffer.viewportY, marker: terminal.registerMarker?.(buffer.viewportY - buffer.baseY - buffer.cursorY) };
}

function restoreTerminalViewport(terminal, anchor) {
  try {
    if (anchor === null) terminal.scrollToBottom();
    else terminal.scrollToLine(anchor.marker && !anchor.marker.isDisposed ? anchor.marker.line : anchor.line);
  } finally { anchor?.marker?.dispose(); }
}

async function flushTerminalResize(controller) {
  controller.resizeTimer = null;
  if (controller.disposed || controller.resizeSending || !controller.pendingResize) return;
  const size = controller.pendingResize;
  controller.pendingResize = null;
  controller.resizeSending = true;
  try {
    await postAction('sessionResize', { sessionId: controller.pane.sessionId, ...size }, controller.projectId);
    controller.lastSize = `${size.cols}x${size.rows}`;
  } catch (error) {
    if (!controller.disposed) showToast(error.payload?.error?.message || t('terminal.resizeError'), 'error');
  } finally {
    controller.resizeSending = false;
    if (!controller.disposed && controller.pendingResize) {
      controller.resizeTimer = window.setTimeout(() => void flushTerminalResize(controller), 100);
    }
  }
}

async function pollTerminalViews() {
  const controllers = [...state.terminalViews.values()].filter(controller => controller.pane.sessionId && !controller.polling && !controller.finished);
  for (const controller of controllers) scheduleTerminalRead(controller, 0);
}

function scheduleTerminalRead(controller, delay) {
  if (controller.disposed || controller.finished) return;
  window.clearTimeout(controller.pollTimer);
  if (controller.polling) {
    controller.readAgain = true;
    return;
  }
  controller.pollTimer = window.setTimeout(() => void readTerminal(controller), delay);
}

async function readTerminal(controller) {
  if (controller.disposed || controller.polling || controller.finished) return;
  controller.polling = true;
  try {
    const params = new URLSearchParams({
      maxLines: `${TERMINAL_MAX_LINES}`,
      maxBytes: `${TERMINAL_MAX_BYTES}`,
    });
    if (Number.isInteger(controller.cursor)) params.set('cursor', `${controller.cursor}`);
    const payload = await fetchJson(`/api/sessions/${encodeURIComponent(controller.pane.sessionId)}/read?${params}`, { projectId: controller.projectId });
    if (controller.disposed) return;
    controller.session = payload.session || controller.session;
    const output = payload.output?.output || '';
    if (output) controller.activeUntil = Date.now() + 1500;
    if (controller.terminal && output) controller.terminal.write(output);
    controller.cursor = Number.isInteger(payload.output?.nextCursor) ? payload.output.nextCursor : null;
    if (payload.session && !sessionIsActive(payload.session)) controller.finished = true;
    updateTerminalHeader(controller.pane);
    if (state.selectedTask?.sessions?.[controller.pane.slotId]) {
      state.selectedTask.sessions[controller.pane.slotId] = {
        ...state.selectedTask.sessions[controller.pane.slotId],
        ...payload.session,
        state: payload.session?.state || state.selectedTask.sessions[controller.pane.slotId].state,
        status: payload.session?.status || payload.session?.state || state.selectedTask.sessions[controller.pane.slotId].status,
      };
    }
  } catch (error) {
    if (controller.disposed) return;
    controller.activeUntil = 0;
    if (error.status === 404) controller.finished = true;
    else updateTerminalHeader({ ...controller.pane, session: { state: 'failed' } });
  } finally {
    controller.polling = false;
    const delay = controller.readAgain ? 0 : Date.now() < controller.activeUntil ? 50 : TERMINAL_POLL_MS;
    controller.readAgain = false;
    scheduleTerminalRead(controller, delay);
  }
}

async function loadRepository() {
  const projectId = state.projectId;
  const epoch = state.projectEpoch;
  const repository = await fetchJson('/api/repository');
  if (projectId !== state.projectId || epoch !== state.projectEpoch) return;
  state.repository = repository;
  renderRepository();
}

async function loadTaskList({ selectFirst = true } = {}) {
  const projectId = state.projectId;
  const epoch = state.projectEpoch;
  const tasks = await fetchJson('/api/workspace-tasks');
  if (projectId !== state.projectId || epoch !== state.projectEpoch) return;
  state.tasks = Array.isArray(tasks) ? tasks : [];
  state.projectTasks.set(projectId, state.tasks);
  if (state.selectedId && !state.tasks.some(task => task.id === state.selectedId)) state.selectedId = null;
  if (selectFirst && !state.selectedId && state.tasks.length > 0) state.selectedId = state.tasks[0].id;
  renderTaskList();
}

async function loadSelectedTask() {
  if (!state.selectedId) {
    state.selectedTask = null;
    disposeTerminalViews();
    renderSelectedTask();
    return;
  }
  const projectId = state.projectId;
  const selectedId = state.selectedId;
  const epoch = state.projectEpoch;
  const task = await fetchJson(`/api/workspace-tasks/${encodeURIComponent(selectedId)}`);
  if (projectId !== state.projectId || epoch !== state.projectEpoch || selectedId !== state.selectedId) return;
  state.selectedTask = task;
  rememberSelection();
  renderSelectedTask();
  void continueTaskStartup(task, projectId, epoch);
}

async function continueTaskStartup(task, projectId, epoch) {
  if (state.actionBusy || !task.startup || !['STARTING', 'AWAITING_INPUT'].includes(task.status)) return;
  const key = `${projectId}:${task.id}`;
  if (state.startupContinuing.has(key)) return;
  state.startupContinuing.add(key);
  try {
    const payload = await postAction('workspaceTaskContinue', { workspaceTaskId: task.id }, projectId);
    if (projectId !== state.projectId || epoch !== state.projectEpoch || task.id !== state.selectedId) return;
    state.selectedTask = payload.workspaceTask;
    state.tasks = state.tasks.map(item => item.id === task.id ? payload.workspaceTask : item);
    state.projectTasks.set(projectId, state.tasks);
    renderTaskList();
    renderSelectedTask();
  } catch { /* Retry through the existing refresh; terminal input stays usable. */ }
  finally { state.startupContinuing.delete(key); }
}

async function refresh({ showError = false } = {}) {
  if (!state.projectId) {
    if (showError) await reloadProjectsAfterArchive(); else renderNoProject();
    return;
  }
  const projectId = state.projectId;
  const epoch = state.projectEpoch;
  try {
    if (showError) {
      const payload = await fetchJson('/api/projects', { projectId: null });
      if (projectId !== state.projectId || epoch !== state.projectEpoch) return;
      state.projects = payload.projects;
      renderProjects();
    }
    if (state.projects.find(project => project.id === projectId)?.available === false) return;
    await Promise.all([loadRepository(), loadTaskList({ selectFirst: !state.selectedId })]);
    if (projectId !== state.projectId || epoch !== state.projectEpoch) return;
    await loadSelectedTask();
    renderWorkspaceHealth();
  } catch (error) {
    if (showError && projectId === state.projectId && epoch === state.projectEpoch) showToast(error.message || t('action.refreshError'), 'error');
  }
}

async function selectTask(id) {
  if (!id || state.actionBusy) return;
  state.selectedId = id;
  rememberSelection();
  renderTaskList();
  await loadSelectedTask();
}

async function createTask() {
  if (state.actionBusy) return;
  if (!state.projectId || state.projects.find(project => project.id === state.projectId)?.available === false) return;
  setBusy(true);
  try {
    const payload = await postAction('workspaceTaskCreate', { language: localeCode() });
    state.selectedId = payload.workspaceTask?.id || null;
    showToast(t('task.created'), 'success');
    await refresh();
  } catch (error) {
    showToast(error.payload?.error?.message || t('action.createError'), 'error');
    await refresh();
  } finally {
    setBusy(false);
    renderTaskList();
    renderSelectedTask();
  }
}

async function closeTask() {
  if (!state.selectedId || state.actionBusy) return;
  setBusy(true);
  try {
    await postAction('workspaceTaskClose', { workspaceTaskId: state.selectedId });
    showToast(t('task.closed'), 'success');
    await refresh();
  } catch (error) {
    showToast(error.payload?.error?.message || t('action.closeError'), 'error');
    await refresh();
  } finally {
    setBusy(false);
    renderTaskList();
    renderSelectedTask();
  }
}

async function closeAllTerminals() {
  if (state.actionBusy) return;
  setBusy(true);
  try {
    const tasks = await fetchJson('/api/workspace-tasks');
    const failures = [];
    for (const task of tasks) {
      if (task.status === 'closed') continue;
      try { await postAction('workspaceTaskClose', { workspaceTaskId: task.id }); }
      catch (error) { failures.push(`${task.id}: ${error.payload?.error?.message || error.message}`); }
    }
    if (failures.length) showToast(failures.join('\n'), 'error');
    else showToast(t('task.allClosed'), 'success');
  } catch (error) {
    showToast(error.message || t('action.closeError'), 'error');
  } finally {
    await refresh();
    setBusy(false);
    renderSelectedTask();
  }
}

async function restartTask() {
  if (!state.selectedId || state.actionBusy) return;
  disposeTerminalViews();
  setBusy(true);
  try {
    const payload = await postAction('workspaceTaskRestart', {
      workspaceTaskId: state.selectedId,
      language: localeCode(),
    });
    state.selectedTask = payload.workspaceTask || null;
    showToast(t('task.restarted'), 'success');
    await refresh();
  } catch (error) {
    showToast(error.payload?.error?.message || t('action.restartError'), 'error');
    await refresh();
  } finally {
    setBusy(false);
    renderTaskList();
    renderSelectedTask();
  }
}

function setLocale(locale) {
  state.locale = locale === 'zh' ? 'zh' : 'en';
  try { localStorage.setItem('coordinate-agents-workspace-locale', state.locale); } catch { /* Optional. */ }
  renderLocale();
}

function renderNoProject() {
  disposeTerminalViews(); state.repository = { name: t('project.none'), root: '', branch: null }; state.tasks = []; state.selectedId = null; state.selectedTask = null;
  renderRepository(); renderTaskList(); renderSelectedTask();
  for (const id of ['new-task-button', 'empty-new-task']) { const button = document.querySelector(`#${id}`); if (button) button.disabled = true; }
}

function renderArchiveSummary() {
  const summary = document.querySelector('#archive-summary'), button = document.querySelector('#archive-clear-button');
  if (summary) summary.textContent = t('archive.summary').replace('{tasks}', state.archives.tasks).replace('{projects}', state.archives.projects)
    + (state.archives.unavailableProjects ? ` · ${t('archive.unavailable').replace('{count}', state.archives.unavailableProjects)}` : '');
  if (button) button.disabled = state.actionBusy || state.settingsBusy || (!state.archives.tasks && !state.archives.unavailableProjects);
}

function closeContextMenu({ restoreFocus = false } = {}) {
  const trigger = state.contextTrigger, target = state.contextTarget;
  const menu = document.querySelector('#workspace-context-menu'); if (menu) menu.hidden = true;
  state.contextTarget = null; state.contextTrigger = null;
  if (restoreFocus && target) {
    const selector = target.kind === 'task' ? `[data-workspace-task-id="${CSS.escape(target.taskId)}"][data-project-id="${CSS.escape(target.projectId)}"]` : `.project-heading[data-project="${CSS.escape(target.projectId)}"]`;
    (trigger?.isConnected ? trigger : document.querySelector(selector))?.focus();
  }
}
function showArchiveMenu(event, target) {
  if (state.actionBusy || state.settingsBusy || state.settingsOpen) return;
  const row = target?.closest?.('[data-workspace-task-id], .project-heading');
  if (!row) return;
  event.preventDefault();
  const menu = document.querySelector('#workspace-context-menu');
  const taskId = row.dataset.workspaceTaskId;
  state.contextTrigger = row;
  state.contextTarget = taskId ? { kind: 'task', taskId, projectId: row.dataset.projectId || state.projectId }
    : { kind: 'project', projectId: row.dataset.project };
  document.querySelector('#archive-context-label').textContent = row.title || row.textContent.trim();
  document.querySelector('#archive-context-action').textContent = t(taskId ? 'archive.task' : 'archive.project');
  menu.setAttribute('aria-label', t(taskId ? 'archive.task' : 'archive.project'));
  menu.hidden = false;
  const rect = row.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(event.clientX || rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY || rect.bottom, window.innerHeight - menu.offsetHeight - 8))}px`;
  document.querySelector('#archive-context-action').focus();
}

async function reloadProjectsAfterArchive(target) {
  const payload = await fetchJson('/api/projects', { projectId: null });
  state.projects = payload.projects;
  if (target) {
    state.projectTasks.delete(target.projectId);
    if (target.kind === 'project') { state.projectSelections.delete(target.projectId); state.expandedProjects.delete(target.projectId); }
    else if (state.projects.some(project => project.id === target.projectId)) {
      const tasks = await fetchJson('/api/workspace-tasks', { projectId: target.projectId });
      state.projectTasks.set(target.projectId, tasks);
    }
  }
  if (!state.projects.some(project => project.id === state.projectId)) {
    disposeTerminalViews(); state.projectEpoch++;
    state.projectId = payload.defaultProjectId || state.projects[0]?.id || null;
    state.selectedId = null; state.selectedTask = null; state.tasks = [];
    if (state.projectId) state.expandedProjects.add(state.projectId);
    try { window.history.replaceState(null, '', state.projectId ? `#${state.projectId}` : window.location.pathname); } catch { /* Optional. */ }
    void checkWorkspaceHealth();
  }
  renderProjects();
  if (state.projectId) await refresh(); else renderNoProject();
}

async function archiveContextTarget() {
  const target = state.contextTarget; closeContextMenu();
  if (!target || state.actionBusy || state.settingsBusy) return;
  setBusy(true); state.projectEpoch++;
  try {
    if (target.kind === 'project') await postAction('projectArchive', { projectId: target.projectId }, null);
    else await postAction('workspaceTaskArchive', { workspaceTaskId: target.taskId }, target.projectId);
    await reloadProjectsAfterArchive(target); showToast(t('archive.done'), 'success');
  } catch (error) { showToast(error.message || t('archive.failed'), 'error'); }
  finally { setBusy(false); if (!state.projectId) renderNoProject(); }
}

async function clearArchivedConversations() {
  if (state.actionBusy || state.settingsBusy) return;
  setBusy(true); setSettingsBusy(true); settingsError();
  try {
    const result = await postAction('workspaceArchivesClear', {}, null);
    state.archives = await postAction('workspaceArchivesStatus', {}, null);
    renderArchiveSummary();
    if (result.failedProjects?.length) settingsError(t('archive.partial'));
    else showToast(t('archive.cleared').replace('{count}', result.deletedTasks), 'success');
  } catch (error) { settingsError(error.message || t('archive.failed')); }
  finally { setBusy(false); setSettingsBusy(false); if (!state.projectId) renderNoProject(); }
}

function bindEvents() {
  document.querySelector('#project-switcher')?.addEventListener('change', event => {
    const id = event.target.value;
    if (id && id !== state.projectId) void selectProject(id);
    renderProjectSwitcher();
  });
  const searchInput = document.querySelector('#task-search-input');
  const clearSearch = () => {
    state.taskSearch = '';
    if (searchInput) searchInput.value = '';
    renderTaskList();
  };
  searchInput?.addEventListener('input', () => {
    state.taskSearch = searchInput.value;
    closeContextMenu();
    renderTaskList();
  });
  searchInput?.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    clearSearch();
    searchInput.blur();
  });
  document.querySelector('#task-search-clear')?.addEventListener('click', () => { clearSearch(); searchInput?.focus(); });
  document.querySelector('#agent-terminal-grid')?.addEventListener('click', event => {
    const button = event.target.closest('[data-terminal-focus], [data-terminal-focus-other]');
    if (button) setTerminalFocus(button.dataset.terminalFocus || button.dataset.terminalFocusOther);
  });
  document.querySelector('#project-list')?.addEventListener('contextmenu', event => showArchiveMenu(event, event.target));
  document.querySelector('#project-list')?.addEventListener('keydown', event => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) showArchiveMenu(event, event.target);
  });
  document.querySelector('#archive-context-action')?.addEventListener('click', () => void archiveContextTarget());
  document.querySelector('#archive-clear-button')?.addEventListener('click', () => void clearArchivedConversations());
  document.addEventListener('pointerdown', event => { if (!document.querySelector('#workspace-context-menu')?.contains(event.target)) closeContextMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeContextMenu({ restoreFocus: true }); });
  window.addEventListener('resize', closeContextMenu);
  document.querySelector('#project-list')?.addEventListener('scroll', closeContextMenu);
  document.querySelector('#zen-button')?.addEventListener('click', () => setZenMode(true));
  document.querySelector('#zen-exit')?.addEventListener('click', () => setZenMode(false));
  document.querySelector('#new-task-button')?.addEventListener('click', createTask);
  document.querySelector('#empty-new-task')?.addEventListener('click', createTask);
  document.querySelector('#codex-model')?.addEventListener('change', () => renderEffortChoices());
  document.querySelector('#terminal-settings-button')?.addEventListener('click', () => void openSettings());
  document.querySelector('#terminal-settings-close')?.addEventListener('click', closeSettings);
  document.querySelector('#terminal-settings-cancel')?.addEventListener('click', closeSettings);
  document.querySelector('#terminal-settings-form')?.addEventListener('submit', event => void saveSettings(event));
  document.querySelector('#terminal-settings-dialog')?.addEventListener('click', event => {
    if (event.target?.id === 'terminal-settings-dialog') closeSettings();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.settingsOpen) closeSettings();
    else if (event.key === 'Escape' && state.healthOpen) setHealthOpen(false, { focus: true });
  });
  document.querySelector('#workspace-health-button')?.addEventListener('click', () => {
    setHealthOpen(!state.healthOpen, { focus: true });
    if (state.healthOpen) void checkWorkspaceHealth();
  });
  for (const id of ['workspace-health-close', 'workspace-health-continue']) document.querySelector(`#${id}`)?.addEventListener('click', () => setHealthOpen(false, { focus: true }));
  document.querySelector('#workspace-health-recheck')?.addEventListener('click', () => void checkWorkspaceHealth());
  document.querySelector('#workspace-health-settings')?.addEventListener('click', () => { setHealthOpen(false); void openSettings(); });
  document.querySelector('#workspace-health-checks')?.addEventListener('click', async event => {
    if (!event.target.closest('[data-health-copy]')) return;
    try { await navigator.clipboard.writeText('npm install -g @openai/codex'); showToast(t('health.copied'), 'success'); }
    catch { showToast(t('health.copyError'), 'error'); }
  });
  document.querySelector('#close-task-button')?.addEventListener('click', closeTask);
  document.querySelector('#close-all-terminals-button')?.addEventListener('click', closeAllTerminals);
  document.querySelector('#restart-task-button')?.addEventListener('click', restartTask);
  document.querySelector('#refresh-button')?.addEventListener('click', () => refresh({ showError: true }));
  document.querySelector('#lang-zh')?.addEventListener('click', () => setLocale('zh'));
  document.querySelector('#lang-en')?.addEventListener('click', () => setLocale('en'));
  document.querySelector('#theme-button')?.addEventListener('click', () => setTheme(state.theme === 'light' ? 'dark' : 'light'));
  document.querySelector('#repo-facts-toggle')?.addEventListener('click', () => {
    state.repoFactsOpen = !state.repoFactsOpen;
    renderRepository();
  });
  document.querySelector('#sidebar-open')?.addEventListener('click', () => document.querySelector('#sidebar')?.classList.add('open'));
  document.querySelector('#sidebar-close')?.addEventListener('click', () => document.querySelector('#sidebar')?.classList.remove('open'));
  window.addEventListener('hashchange', () => {
    const [projectId, taskId] = window.location.hash.slice(1).split('/').map(decodeURIComponent);
    if (projectId.startsWith('project-')) void selectProject(projectId, taskId || null);
    else if (projectId) void selectTask(projectId);
  });
}

function initialSelection() {
  const id = decodeURIComponent(window.location.hash.replace(/^#/, ''));
  if (/^workspace-[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(id)) state.selectedId = id;
}

async function boot() {
  bindEvents();
  initialSelection();
  renderLocale();
  try {
    const payload = await fetchJson('/api/projects', { projectId: null });
    state.projects = payload.projects;
    const [projectId, taskId] = window.location.hash.slice(1).split('/').map(decodeURIComponent);
    state.projectId = state.projects.some(project => project.id === projectId) ? projectId : payload.defaultProjectId || state.projects[0]?.id || null;
    if (projectId.startsWith('project-')) state.selectedId = taskId || null;
    if (!state.selectedId) {
      try { state.selectedId = localStorage.getItem(`workspace-selection-${state.projectId}`) || null; } catch { /* Optional. */ }
    }
    state.expandedProjects.add(state.projectId);
    document.querySelector('#new-project-button')?.addEventListener('click', openProjectDialog);
    bindProjectDialog();
  } catch (error) { showToast(error.message, 'error'); }
  await refresh({ showError: true });
  void checkWorkspaceHealth();
  showHealthOnboarding();
  state.refreshTimer = window.setInterval(() => void refresh(), REFRESH_MS);
}

void boot();
