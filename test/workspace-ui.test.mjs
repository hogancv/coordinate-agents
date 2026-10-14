import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
function runFunctions(start, end, globals) {
  const context = vm.createContext(globals);
  const from = app.indexOf(`function ${start}(`);
  assert.notEqual(from, -1, `${start} must exist`);
  vm.runInContext(app.slice(from, app.indexOf(`function ${end}(`, from)), context);
  return context;
}

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
