import {
  isActiveTerminalSession,
  selectTerminalPanes,
  terminalSessionKey,
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

const I18N = {
  en: {
    'repo.label': 'BOUND REPOSITORY',
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
    'task.restart': 'Restart pair',
    'task.close': 'Close task',
    'task.closed': 'Task closed',
    'task.created': 'New dual-terminal task created.',
    'task.restarted': 'The terminal pair was restarted.',
    'task.error': 'Task error',
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
    'action.refreshError': 'Workspace refresh failed.',
    'action.createError': 'Could not create the dual-terminal task.',
    'action.closeError': 'Could not close the task pair.',
    'action.restartError': 'Could not restart the task pair.',
    'action.retry': 'Retry',
  },
  zh: {
    'repo.label': '当前仓库',
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
    'task.restart': '重启终端组',
    'task.close': '关闭任务',
    'task.closed': '任务已关闭',
    'task.created': '新的双终端任务已创建。',
    'task.restarted': '终端组已重启。',
    'task.error': '任务错误',
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
    'action.refreshError': '工作台刷新失败。',
    'action.createError': '无法创建双终端任务。',
    'action.closeError': '无法关闭终端组。',
    'action.restartError': '无法重启终端组。',
    'action.retry': '重试',
  },
};

const state = {
  locale: loadLocale(),
  repository: null,
  tasks: [],
  selectedId: null,
  selectedTask: null,
  terminalViews: new Map(),
  terminalPairKey: '',
  actionBusy: false,
  refreshTimer: null,
  taskTimer: null,
  pollTimer: null,
  repoFactsOpen: false,
};

const capability = document.querySelector('meta[name="coordinate-agents-capability"]')?.content || '';

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
  const response = await fetch(path, { cache: 'no-store', ...options });
  let payload = null;
  try { payload = await response.json(); } catch { /* The error below is enough. */ }
  if (!response.ok) {
    const error = new Error(payload?.error || `Request failed with status ${response.status}`);
    error.payload = payload;
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function postAction(action, params = {}) {
  const payload = await fetchJson(ACTION_ENDPOINT, {
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
  for (const id of ['new-task-button', 'empty-new-task', 'close-task-button', 'restart-task-button', 'refresh-button']) {
    const element = document.querySelector(`#${id}`);
    if (element) element.disabled = busy;
  }
}

function renderLocale() {
  document.documentElement.lang = state.locale === 'zh' ? 'zh-CN' : 'en';
  document.body.dataset.locale = state.locale === 'zh' ? 'zh-CN' : 'en';
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  const repoToggle = document.querySelector('#repo-facts-toggle');
  if (repoToggle) repoToggle.textContent = state.repoFactsOpen ? t('repo.hideDetails') : t('repo.details');
  document.querySelector('#lang-zh')?.classList.toggle('active', state.locale === 'zh');
  document.querySelector('#lang-en')?.classList.toggle('active', state.locale === 'en');
  document.querySelector('#lang-zh')?.setAttribute('aria-pressed', `${state.locale === 'zh'}`);
  document.querySelector('#lang-en')?.setAttribute('aria-pressed', `${state.locale === 'en'}`);
  renderRepository();
  renderTaskList();
  renderSelectedTask();
}

function renderRepository() {
  const repository = state.repository;
  const name = document.querySelector('#repo-name');
  const branch = document.querySelector('#repo-branch');
  if (!repository) {
    if (name) name.textContent = t('repo.loading');
    if (branch) branch.textContent = '—';
    return;
  }
  if (name) name.textContent = repository.name || repository.root || '—';
  if (branch) branch.textContent = repository.branch || (repository.detached ? 'detached' : '—');
  const repoToggle = document.querySelector('#repo-facts-toggle');
  const facts = document.querySelector('#repo-facts');
  repoToggle?.setAttribute('aria-expanded', `${state.repoFactsOpen}`);
  if (!facts) return;
  facts.hidden = !state.repoFactsOpen;
  facts.innerHTML = [
    `<div><span>${escapeHtml(t('repo.root'))}</span><code>${escapeHtml(repository.root || '—')}</code></div>`,
    `<div><span>${escapeHtml(t('repo.branch'))}</span><code>${escapeHtml(repository.branch || '—')}</code></div>`,
    `<div><span>${escapeHtml(t('repo.commit'))}</span><code>${escapeHtml(repository.head?.short || '—')}</code></div>`,
  ].join('');
}

function renderTaskList() {
  const list = document.querySelector('#workspace-task-list');
  const count = document.querySelector('#task-count');
  if (!list) return;
  if (count) count.textContent = `${state.tasks.length}`;
  if (state.tasks.length === 0) {
    list.innerHTML = `<p class="task-list-empty">${escapeHtml(t('task.none'))}</p>`;
    return;
  }
  list.innerHTML = state.tasks.map(task => {
    const selected = task.id === state.selectedId ? ' selected' : '';
    const codexState = statusKey(sessionState(task.sessions?.codex));
    const agyState = statusKey(sessionState(task.sessions?.antigravity));
    return `<button class="workspace-task-item${selected}" type="button" data-workspace-task-id="${escapeHtml(task.id)}">
      <span class="task-item-top"><strong>${escapeHtml(task.title)}</strong><span class="status-dot ${escapeHtml(statusKey(task.status))}" aria-label="${escapeHtml(statusLabel(task.status))}"></span></span>
      <span class="task-item-meta"><span>${escapeHtml(statusLabel(task.status))}</span><time>${escapeHtml(formatTime(task.updatedAt))}</time></span>
      <span class="task-item-agents"><span class="mini-agent ${escapeHtml(codexState)}">Codex</span><span class="mini-agent ${escapeHtml(agyState)}">Antigravity</span></span>
    </button>`;
  }).join('');
  for (const item of list.querySelectorAll('[data-workspace-task-id]')) {
    item.addEventListener('click', () => selectTask(item.dataset.workspaceTaskId));
  }
}

function renderSelectedTask() {
  const empty = document.querySelector('#empty-state');
  const panel = document.querySelector('#workspace-panel');
  if (!state.selectedTask) {
    if (empty) empty.hidden = false;
    if (panel) panel.hidden = true;
    return;
  }
  if (empty) empty.hidden = true;
  if (panel) panel.hidden = false;
  const task = state.selectedTask;
  const title = document.querySelector('#selected-task-title');
  const status = document.querySelector('#selected-task-status');
  const id = document.querySelector('#selected-task-id');
  const version = document.querySelector('#selected-task-prompt-version');
  if (title) title.textContent = task.title || '—';
  if (status) {
    status.textContent = statusLabel(task.status);
    status.className = `status-pill ${statusKey(task.status)}`;
  }
  if (id) id.textContent = task.id || '—';
  if (version) version.textContent = `v${task.promptVersion || '2.3.0'}`;
  const error = document.querySelector('#task-error');
  if (error) {
    const message = task.error?.message || task.error?.details || '';
    error.hidden = !message;
    error.textContent = message ? `${t('task.error')}: ${bounded(message)}` : '';
  }
  const close = document.querySelector('#close-task-button');
  const restart = document.querySelector('#restart-task-button');
  if (close) close.disabled = state.actionBusy || statusKey(task.status) === 'closed';
  if (restart) restart.disabled = state.actionBusy || statusKey(task.status) === 'starting';

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

function terminalCardMarkup(pane) {
  const roleKey = pane.slotId === 'codex' ? 'terminal.planner' : 'terminal.implementer';
  return `<article class="terminal-card" data-terminal-slot="${escapeHtml(pane.slotId)}">
    <header class="terminal-card-header">
      <div class="terminal-card-title"><span class="terminal-agent-mark ${escapeHtml(pane.slotId)}">${pane.slotId === 'codex' ? 'C' : 'A'}</span><div><strong>${escapeHtml(t(`terminal.${pane.slotId}`))}</strong><span>${escapeHtml(t(roleKey))}</span></div></div>
      <span class="terminal-status" data-terminal-status>${escapeHtml(pane.sessionId ? t('terminal.connecting') : t('terminal.unavailable'))}</span>
    </header>
    <div class="terminal-screen" data-terminal-screen tabindex="0" aria-label="${escapeHtml(t(`terminal.${pane.slotId}`))}"></div>
    <footer class="terminal-card-footer"><code data-terminal-session>${escapeHtml(pane.sessionId || '—')}</code><span data-terminal-updated>—</span></footer>
  </article>`;
}

function renderTerminalViews(panes) {
  const grid = document.querySelector('#agent-terminal-grid');
  if (!grid) return;
  grid.innerHTML = panes.map(terminalCardMarkup).join('');
  for (const pane of panes) {
    const card = grid.querySelector(`[data-terminal-slot="${CSS.escape(pane.slotId)}"]`);
    if (!card) continue;
    const controller = {
      pane,
      card,
      terminal: null,
      cursor: null,
      session: pane.session || null,
      inputQueue: Promise.resolve(),
      queuedInputBytes: 0,
      resizePromise: Promise.resolve(),
      lastSize: null,
      polling: false,
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
      theme: {
        background: '#080d18',
        foreground: '#e7efff',
        cursor: '#a7bcff',
        selectionBackground: 'rgba(130, 158, 255, .35)',
      },
    });
    controller.terminal.open(screen);
    controller.terminal.onData(data => enqueueRawInput(controller, data));
    controller.terminal.onBinary(data => enqueueRawInput(controller, data));
    controller.resizeObserver = new ResizeObserver(() => resizeTerminal(controller));
    controller.resizeObserver.observe(screen);
    screen.addEventListener('click', () => controller.terminal?.focus());
    window.requestAnimationFrame(() => resizeTerminal(controller));
  }
  void pollTerminalViews();
}

function updateTerminalHeader(pane) {
  const controller = state.terminalViews.get(pane.slotId);
  const card = controller?.card || document.querySelector(`[data-terminal-slot="${CSS.escape(pane.slotId)}"]`);
  if (!card) return;
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
  const updated = card.querySelector('[data-terminal-updated]');
  if (updated) updated.textContent = formatTime(session?.lastActivityAt || session?.createdAt);
}

function disposeTerminalViews() {
  window.clearTimeout(state.pollTimer);
  state.pollTimer = null;
  for (const controller of state.terminalViews.values()) {
    controller.resizeObserver?.disconnect();
    controller.terminal?.dispose();
  }
  state.terminalViews.clear();
  state.terminalPairKey = '';
  const grid = document.querySelector('#agent-terminal-grid');
  if (grid) grid.innerHTML = '';
}

function enqueueRawInput(controller, input) {
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
      await postAction('sessionWrite', {
        sessionId: controller.pane.sessionId,
        input: chunk,
        submit: false,
      });
    }
  }).catch(error => {
    showToast(error.payload?.error?.message || t('terminal.inputError'), 'error');
  }).finally(() => {
    controller.queuedInputBytes = Math.max(0, controller.queuedInputBytes - bytes);
  });
}

function terminalSize(controller) {
  const screen = controller.card.querySelector('[data-terminal-screen]');
  if (!screen) return null;
  return {
    cols: Math.max(20, Math.min(240, Math.floor(screen.clientWidth / 8.2))),
    rows: Math.max(10, Math.min(80, Math.floor(screen.clientHeight / 17))),
  };
}

function resizeTerminal(controller) {
  if (!controller.terminal || !controller.pane.sessionId) return;
  const size = terminalSize(controller);
  if (!size || size.cols < 1 || size.rows < 1) return;
  const key = `${size.cols}x${size.rows}`;
  if (controller.lastSize === key) return;
  controller.lastSize = key;
  try { controller.terminal.resize(size.cols, size.rows); } catch { return; }
  controller.resizePromise = controller.resizePromise.then(async () => {
    try {
      await postAction('sessionResize', { sessionId: controller.pane.sessionId, ...size });
    } catch (error) {
      showToast(error.payload?.error?.message || t('terminal.resizeError'), 'error');
    }
  });
}

async function pollTerminalViews() {
  const controllers = [...state.terminalViews.values()].filter(controller => controller.pane.sessionId && !controller.polling && !controller.finished);
  for (const controller of controllers) void readTerminal(controller);
  window.clearTimeout(state.pollTimer);
  state.pollTimer = window.setTimeout(() => void pollTerminalViews(), TERMINAL_POLL_MS);
}

async function readTerminal(controller) {
  controller.polling = true;
  try {
    const params = new URLSearchParams({
      maxLines: `${TERMINAL_MAX_LINES}`,
      maxBytes: `${TERMINAL_MAX_BYTES}`,
    });
    if (Number.isInteger(controller.cursor)) params.set('cursor', `${controller.cursor}`);
    const payload = await fetchJson(`/api/sessions/${encodeURIComponent(controller.pane.sessionId)}/read?${params}`);
    controller.session = payload.session || controller.session;
    const output = payload.output?.output || '';
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
    if (error.status === 404) controller.finished = true;
    else updateTerminalHeader({ ...controller.pane, session: { state: 'failed' } });
  } finally {
    controller.polling = false;
  }
}

async function loadRepository() {
  state.repository = await fetchJson('/api/repository');
  renderRepository();
}

async function loadTaskList({ selectFirst = true } = {}) {
  const tasks = await fetchJson('/api/workspace-tasks');
  state.tasks = Array.isArray(tasks) ? tasks : [];
  if (state.selectedId && !state.tasks.some(task => task.id === state.selectedId)) state.selectedId = null;
  if (!state.selectedId && state.tasks.length > 0) state.selectedId = state.tasks[0].id;
  renderTaskList();
}

async function loadSelectedTask() {
  if (!state.selectedId) {
    state.selectedTask = null;
    disposeTerminalViews();
    renderSelectedTask();
    return;
  }
  state.selectedTask = await fetchJson(`/api/workspace-tasks/${encodeURIComponent(state.selectedId)}`);
  renderSelectedTask();
}

async function refresh({ showError = false } = {}) {
  try {
    await Promise.all([loadRepository(), loadTaskList({ selectFirst: !state.selectedId })]);
    await loadSelectedTask();
  } catch (error) {
    if (showError) showToast(error.message || t('action.refreshError'), 'error');
  }
}

async function selectTask(id) {
  if (!id || state.actionBusy) return;
  state.selectedId = id;
  try { window.history.replaceState(null, '', `#${encodeURIComponent(id)}`); } catch { /* Selection still works without a hash. */ }
  renderTaskList();
  await loadSelectedTask();
}

async function createTask() {
  if (state.actionBusy) return;
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

function bindEvents() {
  document.querySelector('#new-task-button')?.addEventListener('click', createTask);
  document.querySelector('#empty-new-task')?.addEventListener('click', createTask);
  document.querySelector('#close-task-button')?.addEventListener('click', closeTask);
  document.querySelector('#restart-task-button')?.addEventListener('click', restartTask);
  document.querySelector('#refresh-button')?.addEventListener('click', () => refresh({ showError: true }));
  document.querySelector('#lang-zh')?.addEventListener('click', () => setLocale('zh'));
  document.querySelector('#lang-en')?.addEventListener('click', () => setLocale('en'));
  document.querySelector('#repo-facts-toggle')?.addEventListener('click', () => {
    state.repoFactsOpen = !state.repoFactsOpen;
    renderRepository();
  });
  document.querySelector('#sidebar-open')?.addEventListener('click', () => document.querySelector('#sidebar')?.classList.add('open'));
  document.querySelector('#sidebar-close')?.addEventListener('click', () => document.querySelector('#sidebar')?.classList.remove('open'));
  window.addEventListener('hashchange', () => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id && id !== state.selectedId && state.tasks.some(task => task.id === id)) void selectTask(id);
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
  await refresh({ showError: true });
  state.refreshTimer = window.setInterval(() => void refresh(), REFRESH_MS);
}

void boot();
