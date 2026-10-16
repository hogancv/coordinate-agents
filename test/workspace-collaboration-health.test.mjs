import test from 'node:test';
import assert from 'node:assert/strict';
import { collaborationHealth, attentionMinutes } from '../inspector/web-workspace/collaboration-health.mjs';

const now = Date.parse('2026-10-16T03:00:00Z');
const task = (status, age = 31) => ({ id: 'task1', mode: 'default', status: 'RUNNING',
  cooperation: { status, roundId: 'round-one', revision: 2, updatedAt: new Date(now - age * 60000).toISOString() },
  sessions: { codex: { sessionId: 'c1', state: 'idle' }, antigravity: { sessionId: 'a1', state: 'busy' } } });
const health = value => collaborationHealth(value, { now });

test('dispatch, execution and review silence are distinct observations, never failures', () => {
  for (const [status, kind, agent] of [['SENT', 'awaiting-start', 'antigravity'], ['WORKING', 'quiet', 'antigravity'], ['DONE', 'awaiting-review', 'codex'], ['REVIEWING', 'quiet', 'codex'], ['CHANGES_REQUESTED', 'awaiting-dispatch', 'codex']]) {
    const value = task(status); const before = structuredClone(value);
    const result = health(value);
    assert.equal(result.state, 'attention');
    assert.deepEqual(result.signals.map(s => [s.kind, s.agent]), [[kind, agent]]);
    assert.deepEqual(value, before, 'derivation must not mutate cooperation or sessions');
  }
  assert.equal(health(task('SENT', 1)).state, 'waiting');
  assert.equal(health(task('DONE', 1)).state, 'waiting');
  assert.equal(health(task('WORKING', 1)).state, 'normal');
  assert.equal(health(task('FAILED')).state, 'reported-failure');
});

test('fresh repeated receipts clear attention even without a new timeline transition', () => {
  const value = task('WORKING');
  value.collaborationEvents = [{ taskId: 'task1', roundId: 'round-old', status: 'FAILED', timestamp: '2020-01-01' }];
  assert.equal(health(value).state, 'attention');
  value.cooperation.updatedAt = new Date(now).toISOString();
  assert.equal(health(value).state, 'normal');
  assert.equal(health(value).lastReceipt.status, 'WORKING');
  value.cooperation.status = 'APPROVED';
  assert.equal(health(value).signals.length, 0);
  for (const timestamp of [null, 'invalid', '2099-01-01T00:00:00Z']) {
    value.cooperation = { ...value.cooperation, status: 'WORKING', updatedAt: timestamp };
    assert.equal(health(value).state, 'normal');
  }
});

test('only current linked sessions produce independent lifecycle evidence in both modes', () => {
  for (const mode of ['default', 'custom']) {
    for (const state of ['failed', 'exited', null]) {
      const value = { ...task('WORKING', 1), mode };
      value.sessions.antigravity.state = state;
      const result = health(value);
      assert.equal(result.state, 'session');
      assert.equal(result.signals[0].sessionId, 'a1');
      assert.equal(result.signals[0].sessionState, state || 'unavailable');
      assert.equal(value.cooperation.status, 'WORKING');
      if (mode === 'custom') assert.equal(result.lastReceipt, null);
      for (const status of ['STARTING', 'AWAITING_INPUT', 'CLOSED']) assert.equal(health({ ...value, status }).signals.length, 0);
      assert.equal(health({ ...value, archivedAt: '2026-10-16' }).signals.length, 0);
    }
  }
  const value = task('WORKING'); value.sessions.antigravity = { sessionId: null, state: 'failed' };
  assert.equal(health(value).signals.some(s => s.kind === 'session'), false);
  for (const status of ['IDLE', 'APPROVED']) {
    const value = task(status); value.sessions.antigravity.state = 'exited';
    assert.equal(health(value).signals.length, 0);
  }
});

test('attention thresholds are bounded, configurable and evaluated at the exact boundary', () => {
  for (const input of [null, '', 'bad', 0, -1, Infinity, 10081]) assert.equal(attentionMinutes(input), 30);
  assert.equal(attentionMinutes('90'), 90);
  assert.equal(collaborationHealth(task('WORKING', 30), { now, minutes: 90 }).state, 'normal');
  assert.equal(collaborationHealth(task('WORKING', 30), { now, minutes: 30 }).state, 'attention');
});

test('health view clears stale selections, preserves controls and safely renders current evidence', async () => {
  const { mountCollaborationHealth } = await import('../inspector/web-workspace/collaboration-health.mjs');
  const { listDocument } = await import('./support/list-dom.mjs');
  const { I18N } = await import('../inspector/web-workspace/i18n.mjs');
  const document = listDocument();
  document.body.innerHTML = '<section id="collaboration-health"><strong id="collaboration-health-heading"></strong><ul id="collaboration-health-signals"></ul><p id="collaboration-health-receipt"></p><div id="collaboration-health-links"></div><details><summary id="collaboration-health-config"></summary><label id="collaboration-health-label"></label><input id="collaboration-health-minutes"></details></section>';
  let context = { projectId: 'p1', selectedId: 'task1', task: task('DONE') };
  let locale = 'en'; const inspected = []; let stored;
  const view = mountCollaborationHealth({ document, getContext: () => context, t: key => I18N[locale][key] || key,
    now: () => now, storage: { getItem: () => '30', setItem: (key, value) => { stored = value; } }, onInspect: (...args) => inspected.push(args) });
  view.update();
  const panel = document.querySelector('#collaboration-health');
  assert.equal(panel.hidden, false); assert.match(panel.textContent, /Codex/); assert.match(panel.textContent, /DONE/);
  const input = document.querySelector('#collaboration-health-minutes');
  input.focus(); input.value = '90';
  for (const listener of input.listeners.get('change')) listener();
  assert.equal(stored, '90'); assert.equal(document.activeElement, input);
  assert.match(document.querySelector('#collaboration-health-heading').textContent, /Waiting/);
  const buttons = document.querySelector('#collaboration-health-links').children;
  for (const listener of buttons[0].listeners.get('click')) listener();
  assert.deepEqual(inspected[0], ['terminal', 'codex']);
  const stable = document.querySelector('#collaboration-health-signals').children[0];
  view.update(); assert.equal(document.querySelector('#collaboration-health-signals').children[0], stable);
  context = { ...context, selectedId: 'task2' }; view.update(); assert.equal(panel.hidden, true);
  assert.equal(document.querySelector('#collaboration-health-signals').textContent, '');
  context = { projectId: 'p2', selectedId: 'task1', task: { ...task('WORKING', 1), title: '<script>bad</script>', mode: 'custom' } };
  context.task.sessions.antigravity.state = 'exited';
  view.update(); assert.equal(panel.hidden, false); assert.doesNotMatch(panel.textContent, /WORKING|DONE|APPROVED/);
  assert.equal(document.querySelectorAll('script').length, 0);
  locale = 'zh'; view.update(); assert.match(panel.textContent, /Session/); assert.match(panel.textContent, /协作/);
});

test('real persisted snapshots isolate projects, refresh repeated receipts and survive server restart without writes', async t => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } = await import('node:fs');
  const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
  const { readWorkspaceTask, readWorkspaceTasks, dispatchWorkspaceTask, reportWorkspaceTask } = await import('../skills/coordinate-agents/scripts/workspace-task-runtime.mjs');
  const { startWorkspace } = await import('./support/workspace-server.mjs');
  const id = 'workspace-health1234'; const roots = [];
  for (let i = 0; i < 2; i++) {
    const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'collaboration-health-'))); roots.push(root);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const dir of ['workspace-tasks', 'sessions', 'tmp']) mkdirSync(join(root, '.agent-bus', dir), { recursive: true });
    const sessions = Object.fromEntries(['codex', 'antigravity'].map(agent => [agent, { slot: agent, agent, role: agent === 'codex' ? 'planner-reviewer' : 'implementer', sessionId: `session_${agent}12345678` }]));
    const record = { schemaVersion: 1, id, mode: 'default', title: 'Health', status: 'RUNNING', promptVersion: 'test', createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z', sessions };
    writeFileSync(join(root, '.agent-bus/workspace-tasks', `${id}.json`), JSON.stringify(record));
    for (const [agent, session] of Object.entries(sessions)) writeFileSync(join(root, '.agent-bus/sessions', `${session.sessionId}.json`), JSON.stringify({ id: session.sessionId, command: 'unused', cwd: root, agent, taskId: id, state: 'idle' }));
    await dispatchWorkspaceTask(root, id, 'round-health', async () => {});
  }
  const root = roots[0], file = join(root, '.agent-bus/workspace-tasks', `${id}.json`);
  await reportWorkspaceTask(root, id, 'WORKING', 'round-health', '', { notify: () => {} });
  const old = JSON.parse(readFileSync(file)); old.cooperation.updatedAt = '2026-10-16T00:00:00Z'; writeFileSync(file, JSON.stringify(old));
  assert.equal(health(await readWorkspaceTask(root, id)).state, 'attention');
  const saved = readFileSync(file, 'utf8');
  for (let i = 0; i < 2; i++) {
    const server = await startWorkspace({ root, port: 0 });
    try {
      const headers = { 'x-coordinate-agents-capability': server.capability };
      const base = server.url.replace('localhost', '127.0.0.1');
      const response = await fetch(`${base}/api/workspace-tasks/${id}`, { headers });
      assert.equal(response.status, 200); assert.equal(health(await response.json()).state, 'attention');
      const asset = await fetch(`${base}/collaboration-health.mjs`); assert.equal(asset.status, 200); assert.match(await asset.text(), /export function collaborationHealth/);
    } finally { await new Promise(done => { server.server.close(done); server.server.closeAllConnections?.(); }); }
  }
  assert.equal(readFileSync(file, 'utf8'), saved, 'observation cannot write receipts or rounds');
  assert.equal((await readWorkspaceTask(roots[1], id)).cooperation.status, 'SENT');
  await reportWorkspaceTask(root, id, 'WORKING', 'round-health', '', { notify: () => {} });
  assert.equal(health(await readWorkspaceTask(root, id)).state, 'attention', 'exact duplicates remain idempotent');
  await reportWorkspaceTask(root, id, 'WORKING', 'round-health', 'New formal progress', { notify: () => {} });
  const fresh = await readWorkspaceTask(root, id);
  assert.ok(Date.parse(fresh.cooperation.updatedAt) > Date.parse(old.cooperation.updatedAt));
  assert.equal(collaborationHealth(fresh).state, 'normal');
  const sessionFile = join(root, '.agent-bus/sessions', `${old.sessions.antigravity.sessionId}.json`);
  writeFileSync(sessionFile, JSON.stringify({ id: old.sessions.antigravity.sessionId, command: 'unused', cwd: root, agent: 'antigravity', taskId: 'workspace-another123', state: 'failed' }));
  const unavailable = collaborationHealth(await readWorkspaceTask(root, id));
  assert.equal(unavailable.signals.find(s => s.kind === 'session').sessionState, 'unavailable', 'foreign ownership is not evidence of this task session failure');
  rmSync(sessionFile);
  assert.equal(collaborationHealth((await readWorkspaceTasks(root))[0]).state, 'session');
  const customFile = join(roots[1], '.agent-bus/workspace-tasks', `${id}.json`);
  const customRecord = JSON.parse(readFileSync(customFile));
  customRecord.mode = 'custom'; delete customRecord.cooperation; delete customRecord.collaborationEvents;
  customRecord.custom = { terminal1: { command: 'codex' }, terminal2: { command: 'agy' }, prompts: { project: '', terminal1: '', terminal2: '' } };
  customRecord.sessions = Object.fromEntries(['terminal1', 'terminal2'].map(slot => [slot, { slot, agent: 'workspace-custom', role: 'custom', sessionId: `session_${slot}12345678` }]));
  writeFileSync(customFile, JSON.stringify(customRecord));
  for (const [slot, session] of Object.entries(customRecord.sessions)) writeFileSync(join(roots[1], '.agent-bus/sessions', `${session.sessionId}.json`), JSON.stringify({ id: session.sessionId, command: 'unused', cwd: roots[1], taskId: id, agent: 'workspace-custom', subtaskId: slot, state: slot === 'terminal1' ? 'idle' : 'exited' }));
  let customHealth = collaborationHealth(await readWorkspaceTask(roots[1], id));
  assert.equal(customHealth.lastReceipt, null);
  assert.deepEqual(customHealth.signals.map(s => [s.agent, s.sessionState]), [['terminal2', 'exited']]);
  const customSessionFile = join(roots[1], '.agent-bus/sessions', `${customRecord.sessions.terminal2.sessionId}.json`);
  const wrongSlot = JSON.parse(readFileSync(customSessionFile)); wrongSlot.subtaskId = 'terminal1'; writeFileSync(customSessionFile, JSON.stringify(wrongSlot));
  customHealth = collaborationHealth(await readWorkspaceTask(roots[1], id));
  assert.equal(customHealth.signals[0].sessionState, 'unavailable', 'Custom slot ownership must match as well as task and agent');
  const closed = JSON.parse(readFileSync(file)); closed.status = 'CLOSED'; closed.archivedAt = '2026-10-16T00:00:00Z'; writeFileSync(file, JSON.stringify(closed));
  assert.equal((await readWorkspaceTasks(root)).length, 0);
  assert.equal(health(await readWorkspaceTask(root, id)).signals.length, 0);
});

test('overlapping task-list reads cannot restore stale health after newer receipts or closure', async () => {
  const { readFileSync } = await import('node:fs'); const vm = await import('node:vm');
  const app = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('async function loadTaskList('), end = app.indexOf('async function loadSelectedTask(', start);
  const requests = []; const state = { projectId: 'p1', projectEpoch: 0, selectedId: 'task1', tasks: [], projectTasks: new Map() };
  const context = vm.createContext({ state, fetchJson: () => new Promise(resolve => requests.push(resolve)), renderTaskList: () => {} });
  vm.runInContext(app.slice(start, end), context);
  for (const status of ['APPROVED', 'CLOSED']) {
    const first = context.loadTaskList(), second = context.loadTaskList();
    const fresh = status === 'CLOSED' ? { ...task('WORKING'), status } : task(status);
    requests.at(-1)([fresh]); await second;
    requests.at(-2)([task('WORKING')]); await first;
    assert.equal(health(state.tasks[0]).state, 'normal');
  }
});

test('starting a lifecycle action invalidates in-flight task snapshots', async () => {
  const { readFileSync } = await import('node:fs'); const vm = await import('node:vm');
  const app = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
  const requests = [];
  const state = { projectId: 'p1', projectEpoch: 0, reviewTaskEpoch: 0, selectedId: 'task1', selectedTaskRequest: 0,
    healthTaskId: 'task1', selectedTask: task('APPROVED'), tasks: [task('APPROVED')], projectTasks: new Map() };
  const context = vm.createContext({ state, document: { querySelector: () => null },
    fetchJson: () => new Promise(resolve => requests.push(resolve)), renderTaskList: () => {}, renderSelectedTask: () => {}, renderWorkspaceHealth: () => {}, rememberSelection: () => {}, continueTaskStartup: () => {} });
  vm.runInContext(app.slice(app.indexOf('async function loadTaskList('), app.indexOf('async function continueTaskStartup(')), context);
  vm.runInContext(app.slice(app.indexOf('function setBusy('), app.indexOf('function settingsError(')), context);
  const list = context.loadTaskList(), selected = context.loadSelectedTask();
  context.setBusy(true);
  requests[0]([task('WORKING')]); requests[1](task('WORKING'));
  await Promise.all([list, selected]);
  assert.equal(health(state.tasks[0]).state, 'normal');
  assert.equal(health(state.selectedTask).state, 'normal');
});
