import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isActiveTerminalSession } from '../inspector/web-workspace/terminal-model.mjs';
import { listDocument } from './support/list-dom.mjs';
import { collaborationHealth } from '../inspector/web-workspace/collaboration-health.mjs';

const app = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
function runFunctions(start, end, globals) {
  const context = vm.createContext(globals);
  const from = app.indexOf(`function ${start}(`);
  assert.notEqual(from, -1, `${start} must exist`);
  vm.runInContext(app.slice(from, app.indexOf(`function ${end}(`, from)), context);
  return context;
}

function healthContext(globals = {}) {
  return runFunctions('healthTerminal', 'renderLocale', { isActiveTerminalSession, ...globals });
}

test('health treats unknown sign-in and unstarted PTY as neutral, but notices live fallback', () => {
  const state = { health: { checks: Object.fromEntries(['node', 'git', 'codex', 'antigravity'].map(id => [id, { status: 'ok', authenticated: 'unknown' }])) }, tasks: [] };
  const context = healthContext({ state });
  assert.equal(context.healthSummaryStatus(), 'ok');
  state.selectedId = 't1';
  state.tasks = [{ id: 't1', sessions: { codex: { sessionId: 'native', state: 'running', backend: 'node-pty' } } }];
  state.selectedTask = { id: 't1', sessions: { codex: { sessionId: 'fallback', state: 'idle', backend: 'stdio-fallback' } } };
  assert.equal(context.healthSummaryStatus(), 'warning');
  state.health.checks.antigravity.status = 'missing';
  assert.equal(context.healthSummaryStatus(), 'missing');
});

test('terminal health follows selection and ignores fallback from other or inactive tasks', () => {
  const historical = { id: 'old', sessions: { codex: { sessionId: 'old-session', state: 'exited', backend: 'stdio-fallback' } } };
  const other = { id: 'other', sessions: { codex: { sessionId: 'other-session', state: 'running', backend: 'stdio-fallback' } } };
  const selectedTask = { id: 'new', sessions: { codex: { sessionId: 'new-session', state: 'running', backend: 'node-pty' } } };
  const state = { selectedId: 'new', selectedTask, tasks: [historical, other, selectedTask] };
  const context = healthContext({ state });
  assert.equal(context.healthTerminal().status, 'ok');
  assert.equal(context.healthTerminal().backend, 'node-pty');
  selectedTask.status = 'CLOSED';
  assert.equal(context.healthTerminal().status, 'pending');
  selectedTask.status = 'RUNNING';
  state.selectedId = 'old'; state.selectedTask = historical;
  assert.equal(context.healthTerminal().status, 'pending');
  state.selectedId = 'other'; state.selectedTask = other;
  assert.equal(context.healthTerminal().status, 'warning');
  state.selectedId = null; state.selectedTask = null;
  assert.equal(context.healthTerminal().status, 'pending');
  state.selectedId = 'new'; state.selectedTask = selectedTask;
  selectedTask.sessions.codex.state = 'failed';
  assert.equal(context.healthTerminal().status, 'pending');
  state.selectedId = 'other'; // An old selectedTask object must not leak during a switch.
  assert.equal(context.healthTerminal().status, 'pending');
});

test('onboarding remembers dismissal only and never opens over an existing active task', () => {
  let stored = null;
  const state = { projectId: 'p1', projectTasks: new Map([['p1', [{ status: 'RUNNING' }]]]) };
  const context = healthContext({ state, HEALTH_SEEN_KEY: 'seen',
    localStorage: { getItem: () => stored, setItem: (key, value) => { assert.equal(key, 'seen'); stored = value; } },
    isActiveTerminalSession: session => session.state === 'running',
  });
  context.renderWorkspaceHealth = () => {};
  context.showHealthOnboarding();
  assert.equal(state.healthOpen, undefined);
  state.projectTasks.set('p1', []);
  context.showHealthOnboarding();
  assert.equal(state.healthOpen, true);
  context.setHealthOpen(false);
  assert.equal(stored, 'true');
  context.showHealthOnboarding();
  assert.equal(state.healthOpen, false);
});

test('project changes discard stale health responses and detect the current command without reload', async () => {
  const requests = [];
  const state = { projectId: 'p1', projectEpoch: 0, healthRequest: 0, health: null };
  const context = healthContext({ state, AbortController, window: { setTimeout, clearTimeout },
    fetchJson: (path, options) => new Promise(resolve => requests.push({ path, options, resolve })),
  });
  context.renderWorkspaceHealth = () => {};
  const first = context.checkWorkspaceHealth();
  state.projectId = 'p2'; state.projectEpoch++; state.selectedId = 'workspace-current-task';
  const second = context.checkWorkspaceHealth();
  assert.equal(requests[0].options.signal.aborted, true);
  requests[1].resolve({ checks: { codex: { command: 'second-cli' } } });
  await second;
  requests[0].resolve({ checks: { codex: { command: 'first-cli' } } });
  await first;
  assert.equal(state.health.checks.codex.command, 'second-cli');
  assert.equal(state.healthBusy, false);
  assert.equal(requests[0].path, '/api/workspace-health');
  assert.equal(requests[1].path, '/api/workspace-health?workspaceTaskId=workspace-current-task');
  assert.equal(requests[1].options.projectId, 'p2');
});

test('Custom health summary follows its two slots and ignores unrelated default CLI checks', () => {
  const task = { id: 'workspace-custom', mode: 'custom', sessions: {} };
  const state = { selectedId: task.id, selectedTask: task, health: { workspaceTaskId: task.id, requiredChecks: ['node', 'git', 'terminal1', 'terminal2'], checks: {
    node: { status: 'ok' }, git: { status: 'ok' }, terminal1: { status: 'ok' }, terminal2: { status: 'pending' } } } };
  const context = healthContext({ state });
  assert.equal(context.healthSummaryStatus(), 'pending');
  state.health.checks.terminal2.status = 'ok';
  assert.equal(context.healthSummaryStatus(), 'ok');
  state.health.checks.terminal2.status = 'missing';
  assert.equal(context.healthSummaryStatus(), 'missing');
  state.selectedId = 'workspace-another';
  assert.equal(context.healthSummaryStatus(), 'pending');
});

test('Custom health rendering names its slots and uses generic missing-executable guidance', () => {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, { dataset: {}, setAttribute() {}, querySelectorAll: () => [], innerHTML: '' }); return nodes.get(id); };
  const state = { selectedId: 'workspace-custom', selectedTask: { id: 'workspace-custom', mode: 'custom', sessions: {} }, health: { workspaceTaskId: 'workspace-custom', requiredChecks: ['node', 'git', 'terminal1', 'terminal2'], checks: {
    node: { status: 'ok' }, git: { status: 'ok' }, terminal1: { status: 'ok', command: 'claude' }, terminal2: { status: 'missing', command: 'my-cli' } } } };
  const context = healthContext({ state, document: { querySelector: node }, escapeHtml: value => value,
    t: key => ({ 'custom.terminal1': 'Terminal 1', 'custom.terminal2': 'Terminal 2' })[key] || key });
  context.renderWorkspaceHealth();
  const rows = node('#workspace-health-checks').innerHTML;
  assert.match(rows, /Terminal 1/); assert.match(rows, /Terminal 2/);
  assert.match(rows, /health.customMissing/);
  assert.doesNotMatch(rows, /Codex CLI|Antigravity CLI|health.antigravityMissing|npm install/);
});

test('loading a newly selected task refreshes health while regular same-task refresh does not reprobe', async () => {
  const state = { projectId: 'p1', projectEpoch: 0, selectedId: 'workspace-custom', healthTaskId: 'workspace-default' };
  let checks = 0;
  const context = vm.createContext({ state, fetchJson: async () => ({ id: state.selectedId, mode: 'custom' }),
    checkWorkspaceHealth: () => { checks++; state.healthTaskId = state.selectedId; },
    rememberSelection() {}, renderSelectedTask() {}, renderWorkspaceHealth() {}, continueTaskStartup() {}, disposeTerminalViews() {} });
  vm.runInContext(app.slice(app.indexOf('async function loadSelectedTask('), app.indexOf('async function continueTaskStartup(')), context);
  await context.loadSelectedTask(); assert.equal(checks, 1);
  await context.loadSelectedTask(); assert.equal(checks, 1);
  state.selectedId = null; await context.loadSelectedTask(); assert.equal(checks, 2);
});

test('task selection changes discard a stale health response within the same project', async () => {
  const requests = [];
  const state = { projectId: 'p1', projectEpoch: 0, healthRequest: 0, selectedId: 'workspace-first', health: null };
  const context = healthContext({ state, AbortController, window: { setTimeout, clearTimeout },
    fetchJson: (path, options) => new Promise(resolve => requests.push({ path, options, resolve })) });
  context.renderWorkspaceHealth = () => {};
  const first = context.checkWorkspaceHealth();
  state.selectedId = 'workspace-second';
  requests[0].resolve({ workspaceTaskId: 'workspace-first', checks: {} });
  await first;
  assert.equal(state.health, null);
  assert.equal(state.healthBusy, false);
  const second = context.checkWorkspaceHealth();
  requests[1].resolve({ workspaceTaskId: 'workspace-second', checks: {} }); await second;
  assert.equal(state.health.workspaceTaskId, state.selectedId);
});

test('theme defaults to light and restores only valid saved choices', () => {
  let saved = null;
  const context = runFunctions('loadTheme', 'loadLocale', { localStorage: { getItem: () => saved } });
  for (const value of [null, '', 'system', 'invalid']) {
    saved = value;
    assert.equal(context.loadTheme(), 'light');
  }
  saved = 'dark';
  assert.equal(context.loadTheme(), 'dark');
  saved = 'light';
  assert.equal(context.loadTheme(), 'light');
  const blocked = runFunctions('loadTheme', 'loadLocale', { localStorage: { getItem() { throw new Error('Storage blocked'); } } });
  assert.equal(blocked.loadTheme(), 'light');
});

test('theme switching persists the choice and recolors existing terminals without changing sessions', () => {
  const terminal = { options: {} };
  const controller = { terminal, pane: { sessionId: 'existing-session' } };
  const state = { theme: 'light', terminalViews: new Map([['codex', controller]]) };
  const attributes = {};
  const button = { setAttribute: (key, value) => { attributes[key] = value; } };
  const root = { dataset: {} };
  let saved;
  const context = runFunctions('loadTheme', 'loadLocale', { state,
    localStorage: { setItem: (key, value) => { saved = [key, value]; } },
    document: { documentElement: root, querySelector: () => button }, t: key => key,
  });
  context.setTheme('dark');
  assert.equal(root.dataset.theme, 'dark');
  assert.deepEqual(saved, ['coordinate-agents-workspace-theme', 'dark']);
  assert.equal(attributes['aria-pressed'], 'true');
  assert.equal(terminal.options.theme.background, '#080d18');
  context.setTheme('light');
  assert.equal(root.dataset.theme, 'light');
  assert.equal(attributes['aria-pressed'], 'false');
  assert.equal(terminal.options.theme.background, '#ffffff');
  assert.equal(state.terminalViews.get('codex'), controller);
  assert.equal(controller.pane.sessionId, 'existing-session');
});

test('split ratio restores storage, defaults safely and clamps both panes to 25%', () => {
  let stored = '0.7';
  const state = {};
  const context = runFunctions('loadTerminalSplitRatio', 'loadLocale', {
    state, localStorage: { getItem: () => stored, setItem: (key, value) => { stored = value; } },
    updateTerminalLayout() {},
  });
  assert.equal(context.loadTerminalSplitRatio(), 0.7);
  context.setTerminalSplitRatio(0.9);
  assert.equal(state.terminalSplitRatio, 0.75);
  assert.equal(stored, '0.75');
  context.setTerminalSplitRatio(0.1);
  assert.equal(state.terminalSplitRatio, 0.25);
  context.setTerminalSplitRatio(0.5);
  assert.equal(context.loadTerminalSplitRatio(), 0.5);
  for (const value of [null, '', 'not-a-number', 'Infinity']) {
    stored = value;
    assert.equal(context.loadTerminalSplitRatio(), 0.5);
  }
});

test('focus toggles and switches without changing session controllers or split ratio', () => {
  const controllers = new Map([['codex', {}], ['antigravity', {}]]);
  const state = { terminalViews: controllers, terminalSplitRatio: 0.7, focusedTerminal: null };
  const context = runFunctions('setTerminalFocus', 'bindTerminalLayout', { state, updateTerminalLayout() {} });
  context.setTerminalFocus('codex');
  assert.equal(state.focusedTerminal, 'codex');
  context.setTerminalFocus('antigravity');
  assert.equal(state.focusedTerminal, 'antigravity');
  context.setTerminalFocus('antigravity');
  assert.equal(state.focusedTerminal, null);
  assert.equal(state.terminalViews, controllers);
  assert.equal(state.terminalSplitRatio, 0.7);
});

test('search matches cached Chinese titles and case-insensitive project names without changing expansion', () => {
  const state = { taskSearch: '功能', projectId: 'p1', tasks: [{ id: 't1', title: '新增功能' }, { id: 't2', title: 'Fix' }],
    projects: [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }, { id: 'p3', name: 'Unknown' }],
    projectTasks: new Map([['p1', []], ['p2', [{ id: 't3', title: '功能验证' }]]]), expandedProjects: new Set(['p1']) };
  const context = runFunctions('searchTaskGroups', 'renderProjects', { state });
  let result = context.searchTaskGroups();
  assert.deepEqual(Array.from(result.groups, group => [group.project.id, Array.from(group.tasks, task => task.id)]), [['p1', ['t1']], ['p2', ['t3']]]);
  assert.equal(result.unloaded, 1);
  state.taskSearch = 'bETA';
  result = context.searchTaskGroups();
  assert.deepEqual(Array.from(result.groups, group => group.project.id), ['p2']);
  assert.deepEqual([...state.expandedProjects], ['p1']);
  state.taskSearch = 'absent';
  assert.equal(context.searchTaskGroups().groups.length, 0);
});

function listContext() {
  const document = listDocument();
  const task = (id, title) => ({ id, title, status: 'WORKING', updatedAt: '2026-10-14T01:00:00Z', sessions: { codex: { state: 'running' }, antigravity: { state: 'idle' } } });
  const state = { locale: 'en', projectId: 'p1', selectedId: 't1', taskSearch: '', actionBusy: false,
    projects: [{ id: 'p1', name: 'Alpha', root: '/alpha', available: true }, { id: 'p2', name: 'Beta', root: '/beta', available: true }, { id: 'p3', name: 'Unloaded', root: '/unloaded', available: false }],
    tasks: [task('t1', 'First'), task('t2', 'Second')], projectTasks: new Map(), expandedProjects: new Set(['p1', 'p2']) };
  state.projectTasks.set('p1', state.tasks); state.projectTasks.set('p2', [task('t1', 'Other project')]);
  const calls = [];
  const context = vm.createContext({ state, document, collaborationHealth, collaborationHealthView: { getMinutes: () => 30, update: () => {} }, t: key => `${state.locale}:${key}`,
    selectTask: id => calls.push(['task', id]), selectProject: (...args) => calls.push(['project', ...args]),
    disposeTerminalViews: () => assert.fail('list refresh disposed terminals'),
  });
  for (const [start, end] of [['function escapeHtml(', 'function bounded('], ['function formatTime(', 'function sessionIsActive('],
    ['function projectText(', 'async function selectProject('], ['function renderTaskList(', 'function renderSelectedTask(']]) {
    vm.runInContext(app.slice(app.indexOf(start), app.indexOf(end)), context);
  }
  context.renderTaskList();
  return { context, state, document, calls, task };
}

test('list status and project updates retain buttons, singleton, focus and scroll', () => {
  const { context, state, document } = listContext();
  const host = document.querySelector('#project-list'), list = document.querySelector('#workspace-task-list');
  const heading = host.querySelector('[data-project="p1"]'), group = heading.parentElement;
  const button = list.querySelector('[data-workspace-task-id="t1"]');
  button.focus(); host.scrollTop = 130; list.scrollTop = 40;
  const moves = document.moves, writes = document.writes;
  context.renderTaskList();
  assert.equal(document.moves, moves); assert.equal(document.writes, writes);
  state.tasks[0] = { ...state.tasks[0], title: '<img onerror=alert(1)>', status: 'DONE', updatedAt: '2026-10-14T02:00:00Z', sessions: { codex: { state: 'exited' }, antigravity: { state: 'running' } } };
  state.projects[0] = { ...state.projects[0], name: 'Renamed <project>', available: false };
  context.renderTaskList();
  assert.equal(host.querySelector('[data-project="p1"]'), heading); assert.equal(heading.parentElement, group);
  assert.equal(list.querySelector('[data-workspace-task-id="t1"]'), button); assert.equal(document.activeElement, button);
  assert.equal(document.moves, moves); assert.equal(host.scrollTop, 130); assert.equal(list.scrollTop, 40);
  assert.equal(button.querySelector('strong').textContent, '<img onerror=alert(1)>');
  assert.equal(button.querySelector('.task-item-status').textContent, 'en:status.done');
  assert.equal(button.querySelector('.status-dot').className, 'status-dot done');
  assert.equal(button.querySelectorAll('.mini-agent')[0].className, 'mini-agent exited');
  assert.equal(button.querySelectorAll('.mini-agent')[1].className, 'mini-agent running');
  assert.equal(heading.querySelector('strong').textContent, 'Renamed <project>');
  assert.equal(heading.querySelector('.project-unavailable').hidden, false);
  heading.focus(); state.selectedId = 't2'; context.renderTaskList();
  assert.equal(document.activeElement, heading); assert.equal(button.getAttribute('aria-current'), 'false');
  assert.equal(document.querySelectorAll('#workspace-task-list').length, 1);
});

test('task insertion, removal and reorder reuse survivors and bind one click per button', () => {
  const { context, state, document, calls, task } = listContext();
  const list = document.querySelector('#workspace-task-list');
  const first = list.children[0], second = list.children[1];
  first.focus(); state.tasks = [state.tasks[1], task('t3', 'New'), state.tasks[0]]; context.renderTaskList();
  assert.deepEqual(list.children.map(node => node.dataset.workspaceTaskId), ['t2', 't3', 't1']);
  assert.equal(list.children[0], second); assert.equal(list.children[2], first); assert.equal(document.activeElement, first);
  state.tasks = state.tasks.slice(0, 2); context.renderTaskList();
  assert.equal(first.isConnected, false); assert.equal(document.activeElement, list.children[1]);
  context.renderTaskList(); second.click();
  assert.deepEqual(calls, [['task', 't2']]);
});

test('search, expansion and project switching preserve the singleton and project boundaries', () => {
  const { context, state, document, calls } = listContext();
  const list = document.querySelector('#workspace-task-list'), search = document.querySelector('#task-search-input');
  const heading = document.querySelector('[data-project="p1"]');
  heading.click(); assert.equal(state.expandedProjects.has('p1'), false);
  assert.equal(list.parentElement.hidden, true); heading.click(); assert.equal(list.parentElement.hidden, false);
  search.focus(); state.taskSearch = 'Other'; context.renderTaskList();
  assert.equal(document.activeElement, search); assert.equal(list.hidden, true); assert.equal(list.isConnected, true);
  const other = document.querySelector('[data-workspace-task-id="t1"]'); other.click();
  assert.deepEqual(calls, [['project', 'p2', 't1']]);
  state.projectId = 'p2'; state.tasks = state.projectTasks.get('p2'); context.renderTaskList();
  assert.equal(list.parentElement.dataset.projectTasks, 'p2'); assert.equal(list.children[0], other);
  state.taskSearch = 'absent'; search.focus(); context.renderTaskList();
  assert.equal(list.isConnected, true); assert.equal(list.hidden, true); assert.equal(document.activeElement, search);
  assert.equal(document.querySelectorAll('.task-search-notice').length, 2);
  state.taskSearch = 'Unloaded'; context.renderTaskList();
  assert.equal(document.querySelector('[data-project-tasks="p3"]').querySelector('.task-list-empty').textContent, 'en:task.notLoaded');
  state.taskSearch = ''; context.renderTaskList();
  assert.equal(list.parentElement.dataset.projectTasks, 'p2'); assert.equal(list.hidden, false);
  assert.deepEqual([...state.expandedProjects], ['p2', 'p1']);
  state.projects = []; state.projectId = null; state.selectedId = null; state.tasks = []; state.projectTasks.clear(); context.renderTaskList();
  assert.equal(document.querySelectorAll('.project-group').length, 0); assert.equal(list.parentElement, document.querySelector('#project-list'));
  assert.equal(list.querySelectorAll('[data-workspace-task-id]').length, 0); assert.equal(list.querySelector('.task-list-empty').textContent, 'en:task.none');
});

test('cached tasks update in place, locale changes relabel them and unusual IDs remain safe', () => {
  const { context, state, document } = listContext();
  const group = document.querySelector('[data-project-tasks="p2"]'), button = group.children[0];
  state.projectTasks.get('p2')[0].status = 'DONE'; context.renderTaskList();
  assert.equal(group.children[0], button); assert.equal(button.querySelector('.task-item-status').textContent, 'en:status.done');
  state.locale = 'zh'; context.renderTaskList();
  assert.equal(group.children[0], button); assert.equal(button.querySelector('.task-item-status').textContent, 'zh:status.done');
  state.projects[1].id = 'p"[\\]'; state.projectTasks.set('p"[\\]', [{ id: 't"[\\]', title: '<b>safe</b>', status: 'DONE' }]);
  context.renderTaskList();
  const unusual = document.querySelectorAll('[data-workspace-task-id]').find(item => item.dataset.projectId === 'p"[\\]');
  assert.equal(unusual.dataset.workspaceTaskId, 't"[\\]'); assert.equal(unusual.querySelector('strong').textContent, '<b>safe</b>');
  assert.equal(unusual.querySelector('b'), null);
});

test('real project selection reuses cached task buttons through the loading render', async () => {
  const { context, state, document } = listContext();
  const list = document.querySelector('#workspace-task-list');
  const old = list.children[0], other = document.querySelector('[data-project-tasks="p2"]').children[0];
  const heading = document.querySelector('[data-project="p2"]');
  let disposals = 0;
  Object.assign(context, { closeSettings() {}, closeCreateTask() {}, closeCustomPrompt() {}, closeContextMenu() {}, changesDrawer: { reset() {} },
    disposeTerminalViews: () => disposals++, checkWorkspaceHealth() {}, renderRepository() {}, renderSelectedTask() {},
    rememberSelection() {}, localStorage: { getItem: () => null }, refresh: async () => {},
  });
  state.projectSelections = new Map(); state.projectEpoch = 0;
  vm.runInContext(app.slice(app.indexOf('async function selectProject('), app.indexOf('let folderPage =')), context);
  await context.selectProject('p2', 't1');
  assert.equal(disposals, 1, 'user selection keeps the existing terminal disposal lifecycle');
  assert.equal(list.parentElement.dataset.projectTasks, 'p2'); assert.equal(list.children[0], other);
  assert.equal(document.querySelector('[data-project-tasks="p1"]').children[0], old);
  assert.equal(document.querySelector('[data-project="p2"]'), heading); assert.equal(heading.getAttribute('aria-current'), 'true');
});

test('project reorder preserves focus and removing its focused task chooses a surviving project', () => {
  const { context, state, document } = listContext();
  const host = document.querySelector('#project-list'), list = document.querySelector('#workspace-task-list');
  const firstHeading = document.querySelector('[data-project="p1"]'), otherHeading = document.querySelector('[data-project="p2"]');
  firstHeading.focus(); state.projects = [state.projects[1], state.projects[0], state.projects[2]]; context.renderTaskList();
  assert.equal(host.children[0], otherHeading.parentElement); assert.equal(document.activeElement, firstHeading);
  list.children[0].focus(); state.projects = state.projects.filter(project => project.id !== 'p1');
  state.projectId = 'p2'; state.tasks = state.projectTasks.get('p2'); context.renderTaskList();
  assert.equal(document.activeElement, otherHeading);
  assert.equal(document.querySelectorAll('#workspace-task-list').length, 1);
});

test('the standalone dictionary retains both locales and relabels existing list nodes', async () => {
  const { I18N } = await import('../inspector/web-workspace/i18n.mjs');
  assert.deepEqual(Object.keys(I18N.en).sort(), Object.keys(I18N.zh).sort());
  for (const key of ['health.title', 'task.searchUnloaded', 'status.closed', 'terminal.live', 'terminal.polling', 'terminal.outputGap']) {
    assert.equal(typeof I18N.en[key], 'string', key); assert.equal(typeof I18N.zh[key], 'string', key);
  }
  const { context, state, document } = listContext();
  const button = document.querySelector('[data-workspace-task-id="t1"]');
  context.I18N = I18N;
  vm.runInContext(app.slice(app.indexOf('function t('), app.indexOf('function localeCode(')), context);
  state.tasks[0].status = 'CLOSED'; context.renderTaskList();
  assert.equal(button.querySelector('.task-item-status').textContent, 'Closed');
  state.locale = 'zh'; context.renderTaskList();
  assert.equal(document.querySelector('[data-workspace-task-id="t1"]'), button);
  assert.equal(button.querySelector('.task-item-status').textContent, '已关闭');
});

test('resize fits xterm immediately but sends only the latest size and never overlaps HTTP', async () => {
  let size = { cols: 80, rows: 24 };
  const timers = [];
  const requests = [];
  const resized = [];
  const completions = [];
  const context = runFunctions('resizeTerminal', 'scheduleTerminalRead', {
    terminalSize: () => size,
    window: { setTimeout: callback => { timers.push(callback); return timers.length; } },
    postAction: (action, params, projectId) => { requests.push({ action, params, projectId }); return new Promise(resolve => completions.push(resolve)); },
    showToast: () => assert.fail('unexpected resize error'), t: x => x,
  });
  const controller = { projectId: 'p1', pane: { sessionId: 'existing-session' }, terminal: {
    buffer: { active: { viewportY: 12, baseY: 100 } }, resize: (cols, rows) => resized.push([cols, rows]), scrollToLine: line => assert.equal(line, 12),
  } };
  context.resizeTerminal(controller);
  size = { cols: 100, rows: 24 };
  context.resizeTerminal(controller);
  assert.deepEqual(resized, [[80, 24], [100, 24]]);
  assert.equal(timers.length, 1);
  assert.equal(requests.length, 0);
  timers.shift()();
  assert.equal(requests[0].action, 'sessionResize');
  assert.equal(requests[0].params.sessionId, 'existing-session');
  assert.equal(requests[0].params.cols, 100);
  size = { cols: 120, rows: 24 };
  context.resizeTerminal(controller);
  size = { cols: 140, rows: 24 };
  context.resizeTerminal(controller);
  assert.equal(requests.length, 1);
  completions.shift()();
  await new Promise(setImmediate);
  assert.equal(timers.length, 1);
  timers.shift()();
  assert.equal(requests[1].params.cols, 140);
  completions.shift()();
  await new Promise(setImmediate);
  assert.equal(timers.length, 0);
  controller.disposed = true;
  size = { cols: 160, rows: 24 };
  context.resizeTerminal(controller);
  assert.equal(requests.length, 2);
  assert.equal(resized.length, 4);
});

test('resizing the bundled xterm preserves the same output line across scrollback reflow', async () => {
  const vendor = vm.createContext({ setTimeout, clearTimeout, queueMicrotask, performance, console, document: {},
    navigator: { userAgent: 'Mozilla/5.0', appVersion: '5.0', platform: 'Win32', language: 'en-US' } });
  vendor.window = vendor;
  vm.runInContext(readFileSync(new URL('../inspector/web-workspace/vendor/xterm.js', import.meta.url), 'utf8'), vendor);
  const terminal = new vendor.Terminal({ cols: 80, rows: 5, scrollback: 2000 });
  try {
    await new Promise(resolve => terminal.write(Array.from({ length: 30 }, (_, i) => `${String(i).padStart(2, '0')}:` + 'x'.repeat(60)).join('\r\n'), resolve));
    terminal.scrollToLine(10);
    let cols = 40;
    const context = runFunctions('resizeTerminal', 'scheduleTerminalRead', {
      terminalSize: () => ({ cols, rows: 5 }), window: { setTimeout: () => 1 },
    });
    const controller = { terminal, pane: { sessionId: 'existing-session' } };
    context.resizeTerminal(controller);
    assert.match(terminal.buffer.active.getLine(terminal.buffer.active.viewportY).translateToString(true), /^10:/);
    cols = 80;
    context.resizeTerminal(controller);
    assert.match(terminal.buffer.active.getLine(terminal.buffer.active.viewportY).translateToString(true), /^10:/);
  } finally { terminal.dispose(); }
});

test('cooperation labels hide idle and distinguish implementation from review', () => {
  const context = runFunctions('cooperationLabel', 'terminalCardMarkup', { t: key => key });
  assert.equal(context.cooperationLabel(), '');
  assert.equal(context.cooperationLabel({ status: 'IDLE' }), '');
  assert.equal(context.cooperationLabel({ status: 'RUNNING' }), '');
  assert.equal(context.cooperationLabel({ status: 'WORKING' }), 'cooperation.WORKING');
  assert.equal(context.cooperationLabel({ status: 'DONE' }), 'cooperation.DONE');
  assert.equal(context.cooperationLabel({ status: 'APPROVED' }), 'cooperation.APPROVED');
  assert.equal(context.terminalRoleLabel('antigravity', { status: 'WORKING' }), 'cooperation.agentWorking');
  assert.equal(context.terminalRoleLabel('codex', { status: 'DONE' }), 'cooperation.awaitingReview');
  assert.equal(context.terminalRoleLabel('codex', { status: 'REVIEWING' }), 'cooperation.agentReviewing');
  assert.equal(context.terminalRoleLabel('codex', { status: 'IDLE' }), 'terminal.planner');
});

test('startup guidance asks for confirmation inside the selected Web terminal', () => {
  const context = runFunctions('startupHint', 'terminalCardMarkup', { t: key => key });
  assert.equal(context.startupHint(), '');
  assert.equal(context.startupHint({ slots: { codex: 'READY', antigravity: 'READY' } }), '');
  assert.equal(context.startupHint({ slots: { codex: 'TRUST_REQUIRED', antigravity: 'READY' } }), 'startup.trust');
  assert.equal(context.startupHint({ slots: { codex: 'READY', antigravity: 'AUTH_REQUIRED' } }), 'startup.auth');
});

test('task errors explain a failed CLI account bootstrap even without a task-level error', () => {
  const context = runFunctions('taskErrorMessage', 'terminalCardMarkup', { t: key => key });
  assert.equal(context.taskErrorMessage({ sessions: { codex: { startupFailure: 'account-init-timeout', error: 'raw timeout' } } }), 'Codex: terminal.accountInitTimeout');
  assert.equal(context.taskErrorMessage({ error: { message: 'Could not open terminal' } }), 'Could not open terminal');
  assert.equal(context.taskErrorMessage({ sessions: {} }), '');
});

// Review handoff runs through the same controller as raw xterm input.
async function reviewContext(overrides = {}) {
  const review = await import('../inspector/web-workspace/review-feedback.mjs');
  const task = { id: 't', status: 'RUNNING', startup: { slots: { codex: 'READY' } }, sessions: { codex: { sessionId: 'c', state: 'idle' } } };
  const controller = { projectId: 'p', pane: { sessionId: 'c' }, inputQueue: Promise.resolve(), queuedInputBytes: 0, session: task.sessions.codex };
  const state = { projectId: 'p', projectEpoch: 1, reviewTaskEpoch: 2, selectedId: 't', selectedTask: task, terminalViews: new Map([['codex', controller]]), locale: 'en' };
  const writes = [];
  const globals = { ...review, state, MAX_INPUT_BYTES: 16 * 1024, UTF8_ENCODER: new TextEncoder(),
    fetchJson: async () => task, postAction: async (...args) => { writes.push(args); return { ok: true }; },
    scheduleTerminalRead() {}, showToast() {}, ...overrides };
  const context = runFunctions('getReviewTaskContext', 'terminalSize', globals);
  return { context, state, controller, writes, target: review.reviewTarget(context.getReviewTaskContext()) };
}

test('review handoff rechecks binding, submits once, and blocks concurrent raw terminal input', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const checks = [];
  const env = await reviewContext({ fetchJson: async () => { await gate; checks.push('task'); return env.state.selectedTask; } });
  const request = { target: env.target, prompt: 'review\n中文', validateSelection: async () => { checks.push('diff'); },
    assertSelection: () => { assert.equal(env.writes.length, 0); checks.push('selection'); } };
  const send = env.context.sendReviewToCodex(request);
  assert.equal(env.controller.reviewWriting, true);
  await assert.rejects(env.context.sendReviewToCodex(request), { code: 'reviewInputBusy' });
  // Raw input is explicitly refused during the review transaction.
  env.context.enqueueRawInput(env.controller, 'x');
  assert.equal(env.controller.queuedInputBytes, 0);
  release(); await send;
  assert.deepEqual(checks, ['diff', 'task', 'selection']);
  assert.equal(env.writes.length, 1);
  assert.equal(env.writes[0][0], 'sessionWrite');
  assert.equal(env.writes[0][1].sessionId, 'c');
  assert.equal(env.writes[0][1].submit, true);
  assert.equal(env.writes[0][2], 'p');
  assert.equal(env.controller.reviewWriting, false);
});

test('review handoff cancels on project/task/session changes during preflight', async () => {
  for (const mutation of [env => { env.state.projectEpoch++; }, env => { env.state.reviewTaskEpoch++; }, env => { env.state.selectedTask.sessions.codex.sessionId = 'replacement'; }, env => { env.controller.disposed = true; }]) {
    const env = await reviewContext();
    await assert.rejects(env.context.sendReviewToCodex({ target: env.target, prompt: 'review', validateSelection: async () => mutation(env), assertSelection() {} }), { code: 'reviewTargetChanged' });
    assert.equal(env.writes.length, 0);
  }
});

test('review handoff rejects a freshly closed task and never retries an uncertain write', async () => {
  const closed = await reviewContext({ fetchJson: async () => ({ id: 't', status: 'CLOSED', sessions: { codex: { sessionId: 'c', state: 'idle' } } }) });
  await assert.rejects(closed.context.sendReviewToCodex({ target: closed.target, prompt: 'review', validateSelection: async () => {}, assertSelection() {} }), { code: 'reviewTaskUnavailable' });
  assert.equal(closed.writes.length, 0);
  let calls = 0;
  const uncertain = await reviewContext({ postAction: async () => { calls++; throw new Error('lost response'); } });
  await assert.rejects(uncertain.context.sendReviewToCodex({ target: uncertain.target, prompt: 'review', validateSelection: async () => {}, assertSelection() {} }), { code: 'reviewUncertain' });
  assert.equal(calls, 1);
  assert.equal(uncertain.controller.reviewWriting, false);
});

test('review handoff rechecks selection after task lookup and cancels before writing', async () => {
  let release, started, selectionValid = true;
  const gate = new Promise(resolve => { release = resolve; });
  const taskReadStarted = new Promise(resolve => { started = resolve; });
  const env = await reviewContext({ fetchJson: async () => { started(); await gate; return env.state.selectedTask; } });
  let validations = 0, assertions = 0;
  const send = env.context.sendReviewToCodex({ target: env.target, prompt: 'review',
    validateSelection: async () => { validations++; },
    assertSelection: () => { assertions++; if (!selectionValid) throw Object.assign(new Error('selection abandoned'), { code: 'reviewTargetChanged' }); },
  });
  await taskReadStarted;
  assert.equal(validations, 1);
  selectionValid = false;
  const rejection = assert.rejects(send, { code: 'reviewTargetChanged' });
  release(); await rejection;
  assert.equal(assertions, 1);
  assert.equal(validations, 1);
  assert.equal(env.writes.length, 0);
  assert.equal(env.controller.reviewWriting, false);
  assert.equal(env.state.reviewWriteTarget, null);
  await env.controller.inputQueue;
});

function settingsTabContext() {
  const document = listDocument();
  document.body.innerHTML = '<div id="settings-tabs"><button id="settings-tab-default" data-settings-tab="default"></button><button id="settings-tab-custom" data-settings-tab="custom"></button><button id="settings-tab-notifications" data-settings-tab="notifications"></button></div><div class="settings-panels"><section data-settings-panel="default"><input id="codex-command"/></section><section data-settings-panel="custom"><textarea id="custom-project-prompt"></textarea></section><section data-settings-panel="notifications"><input id="notifications-enabled"/></section></div><footer><button id="terminal-settings-save" data-settings-action="default"></button><button id="custom-settings-save" data-settings-action="custom"></button><button id="notifications-save" data-settings-action="notifications"></button></footer>';
  const state = { settingsTab: 'default', settingsBusy: false, actionBusy: false };
  const context = runFunctions('selectSettingsTab', 'renderModelChoices', { state, document, settingsError() {} });
  context.bindSettingsTabs();
  context.selectSettingsTab('default');
  return { context, state, document };
}

test('settings tabs show only their own panel and keep unsaved fields across switches', () => {
  const { state, document } = settingsTabContext();
  document.querySelector('#codex-command').value = 'unsaved-codex';
  document.querySelector('#custom-project-prompt').value = 'unsaved prompt';
  document.querySelector('#notifications-enabled').checked = true;
  document.querySelector('#settings-tab-notifications').click();
  assert.equal(state.settingsTab, 'notifications');
  const panels = document.querySelectorAll('[data-settings-panel]');
  assert.deepEqual(panels.filter(panel => !panel.hidden).map(panel => panel.dataset.settingsPanel), ['notifications']);
  assert.equal(document.querySelector('#settings-tab-notifications').getAttribute('aria-selected'), 'true');
  assert.equal(document.querySelector('#settings-tab-default').tabIndex, -1);
  document.querySelector('#settings-tab-custom').click();
  assert.equal(document.querySelector('#custom-project-prompt').value, 'unsaved prompt');
  document.querySelector('#settings-tab-default').click();
  assert.equal(document.querySelector('#codex-command').value, 'unsaved-codex');
  assert.equal(document.querySelector('#notifications-enabled').checked, true);
});

test('settings tab keyboard navigation wraps, supports Home/End and blocks switching during a save', () => {
  const { context, state, document } = settingsTabContext();
  const press = (tab, key) => {
    let prevented = false;
    context.settingsTabKeydown({ currentTarget: document.querySelector(`#settings-tab-${tab}`), key, preventDefault() { prevented = true; } });
    return prevented;
  };
  assert.equal(press('default', 'ArrowLeft'), true);
  assert.equal(state.settingsTab, 'notifications');
  assert.equal(document.activeElement, document.querySelector('#settings-tab-notifications'));
  press('notifications', 'ArrowRight'); assert.equal(state.settingsTab, 'default');
  press('default', 'End'); assert.equal(state.settingsTab, 'notifications');
  press('notifications', 'Home'); assert.equal(state.settingsTab, 'default');
  state.settingsBusy = true;
  document.querySelector('#settings-tab-custom').click();
  assert.equal(state.settingsTab, 'default');
  press('default', 'End'); assert.equal(state.settingsTab, 'default');
  state.settingsBusy = false;
  context.selectSettingsTab('unknown'); assert.equal(state.settingsTab, 'default');
});

test('saving the default settings keeps empty archive cleanup disabled in the open dialog', async () => {
  const document = listDocument();
  document.body.innerHTML = '<button id="archive-clear-button"></button><button id="terminal-settings-save"></button><input id="codex-command"/><input id="antigravity-command"/><select id="codex-model"></select><select id="codex-effort"></select>';
  for (const id of ['codex-command', 'antigravity-command', 'codex-model', 'codex-effort']) document.querySelector(`#${id}`).value = 'codex';
  const state = { projectId: 'p1', projectEpoch: 0, projects: [{ id: 'p1', available: true }], settings: {}, archives: { tasks: 0, projects: 0, unavailableProjects: 0 } };
  const context = runFunctions('setBusy', 'settingsError', { state, document, t: key => key, settingsError() {}, setNotificationControlsBusy() {},
    replaceCodexModel: () => [], replaceCodexEffort: () => [], postAction: async () => ({ ok: true }), showToast() {}, checkWorkspaceHealth() {} });
  for (const [start, end] of [['function canEditProjectSettings(', 'function closeSettings('], ['function renderArchiveSummary(', 'function closeContextMenu('], ['async function saveSettings(', 'function renderNotificationSettings(']]) {
    vm.runInContext(app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start))), context);
  }
  context.renderArchiveSummary();
  assert.equal(document.querySelector('#archive-clear-button').disabled, true);
  await context.saveSettings();
  assert.equal(document.querySelector('#archive-clear-button').disabled, true);
});


test('the fixed settings footer exposes only the active tab save action', () => {
  const { document } = settingsTabContext();
  const visible = () => document.querySelectorAll('[data-settings-action]').filter(button => !button.hidden).map(button => button.attributes.id);
  assert.deepEqual(visible(), ['terminal-settings-save']);
  document.querySelector('#settings-tab-custom').click();
  assert.deepEqual(visible(), ['custom-settings-save']);
  document.querySelector('#settings-tab-notifications').click();
  assert.deepEqual(visible(), ['notifications-save']);
  document.querySelector('#settings-tab-default').click();
  assert.deepEqual(visible(), ['terminal-settings-save']);
});
