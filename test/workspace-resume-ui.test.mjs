import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
function ui() {
  const ids = ['conversation-resume', 'conversation-resume-open',
    'conversation-id', 'conversation-resume-button', 'conversation-resume-title',
    'conversation-resume-status', 'conversation-identity-status'];
  const elements = Object.fromEntries(ids.map(id => ['#' + id, {
    dataset: {}, value: '', checked: false, hidden: false, open: false,
    setAttribute(name, value) { this[name] = value; },
    showModal() { this.open = true; }, close() { this.open = false; },
    focus() { this.focused = true; },
  }]));
  const state = { projectId: 'p1', projectEpoch: 0, selectedId: 'workspace-one', actionBusy: false,
    selectedTask: { id: 'workspace-one', mode: 'default', status: 'CLOSED',
      sessions: { codex: { sessionId: 'old', runtimeGeneration: 'old-generation', state: 'exited' } } } };
  const start = source.indexOf('function renderConversationResume(');
  assert.notEqual(start, -1);
  const context = vm.createContext({ state, document: { querySelector: key => elements[key] },
    t: key => key, isActiveTerminalSession: session => session?.state === 'running',
    setBusy: busy => { state.actionBusy = busy; }, showToast() {}, localeCode: () => 'en',
    refresh: async () => {}, renderTaskList() {}, renderSelectedTask() {} });
  vm.runInContext(source.slice(start, source.indexOf('function renderSelectedTask(', start)), context);
  return { elements, state, context };
}

test('closed tasks expose a compact reopen entry without opening the dialog automatically', () => {
  const { elements: e, state, context: c } = ui();
  c.renderConversationResume();
  assert.equal(e['#conversation-resume-open'].hidden, false);
  assert.equal(e['#conversation-resume'].open, false);
  c.openConversationResume();
  assert.equal(e['#conversation-resume'].open, true);
  assert.equal(e['#conversation-resume-button'].disabled, true);
  e['#conversation-id'].value = '019a0000-0000-7000-8000-000000000001';
  c.renderConversationResume();
  assert.equal(e['#conversation-resume-button'].disabled, false);
  c.closeConversationResume();
  assert.equal(e['#conversation-resume'].open, false);
  assert.equal(e['#conversation-resume-open'].focused, true);
  for (const status of ['RUNNING']) {
    state.selectedTask.status = status; c.renderConversationResume();
    assert.equal(e['#conversation-resume-open'].hidden, true, status);
  }
});

test('reopen immediately resumes a bound task without a UUID form and coalesces repeated clicks', async () => {
  const { elements: e, state, context: c } = ui();
  state.selectedTask.sessions.codex.nativeIdentity = { binding: { conversationId: '019a0000-0000-7000-8000-000000000001' } };
  let finish, seen, calls = 0;
  c.postAction = async (action, params) => { calls++; seen = { action, params }; await new Promise(done => { finish = done; }); };
  const operation = c.reopenConversationTask();
  await c.reopenConversationTask();
  assert.equal(calls, 1);
  assert.equal(seen.action, 'workspaceTaskResume');
  assert.equal(seen.params.workspaceTaskId, 'workspace-one');
  assert.equal(seen.params.conversationId, undefined, 'server chooses its persisted original UUID');
  assert.equal(e['#conversation-resume'].open, false);
  finish(); await operation;
});

test('reopen failures expose the prefilled fallback and failed or partial tasks remain recoverable', async () => {
  const { elements: e, state, context: c } = ui();
  const id = '019a0000-0000-7000-8000-000000000001';
  state.selectedTask.sessions.codex.nativeIdentity = { binding: { conversationId: id } };
  c.postAction = async () => { throw new Error('Native record unavailable'); };
  await c.reopenConversationTask();
  assert.equal(e['#conversation-resume'].open, true);
  assert.equal(e['#conversation-id'].value, id);
  for (const status of ['EXITED', 'DEGRADED', 'ERROR']) {
    state.selectedTask.status = status; c.renderConversationResume();
    assert.equal(e['#conversation-resume-open'].hidden, false);
  }
  state.selectedTask.sessions.codex.nativeIdentity.firstConflict = { conversationId: '019a0000-0000-7000-8000-000000000002' };
  c.renderConversationResume();
  assert.equal(e['#conversation-resume-button'].disabled, true);
  assert.match(e['#conversation-resume-status'].textContent, /IDENTITY_CHANGED/);
});

test('resumed tasks have no confirmation entry or dialog, including legacy pending tasks', () => {
  const { elements: e, state, context: c } = ui();
  state.selectedTask.status = 'RUNNING';
  state.selectedTask.sessions.codex.state = 'running';
  for (const status of ['READY', 'AWAITING_CONFIRMATION', 'PARTIAL']) {
    state.selectedTask.resume = { state: status, conversationId: '019a0000-0000-7000-8000-000000000001' };
    c.renderConversationResume(); c.openConversationResume();
    assert.equal(e['#conversation-resume-open'].hidden, true);
    assert.equal(e['#conversation-resume'].open, false);
  }
  const html = readFileSync(new URL('../inspector/web-workspace/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /conversation-confirm|conversation-manual-check|resume.manualNote/);
});

test('switching targets or hiding archived/custom tasks dismisses the dialog', () => {
  const { elements: e, state, context: c } = ui();
  c.renderConversationResume(); c.openConversationResume();
  state.projectId = 'p2'; state.projectEpoch++; c.renderConversationResume();
  assert.equal(e['#conversation-resume'].open, false);
  c.openConversationResume(); state.selectedTask.archivedAt = 'now'; c.renderConversationResume();
  assert.equal(e['#conversation-resume'].open, false);
  assert.equal(e['#conversation-resume-open'].hidden, true);
  delete state.selectedTask.archivedAt; state.selectedTask.mode = 'custom'; c.renderConversationResume();
  assert.equal(e['#conversation-resume-open'].hidden, true);
});

test('fallback resume ignores completion after a project switch', async () => {
  const { elements: e, state, context: c } = ui();
  c.renderConversationResume(); c.openConversationResume();
  e['#conversation-id'].value = '019a0000-0000-7000-8000-000000000001';
  c.renderConversationResume();
  let finish, seen; const pending = new Promise(done => { finish = done; });
  c.postAction = async (action, params, projectId) => { seen = { action, params, projectId }; return pending; };
  let refreshes = 0; c.refresh = async () => { refreshes++; };
  const operation = c.conversationTaskAction();
  assert.equal(seen.action, 'workspaceTaskResume');
  assert.equal(seen.params.conversationId, e['#conversation-id'].value); assert.equal(seen.projectId, 'p1');
  state.projectId = 'p2'; state.projectEpoch++; finish({ ok: true }); await operation;
  assert.equal(refreshes, 0);
});

test('degraded task with live Codex and inactive executor labels recovery for the missing executor', () => {
  const { elements: e, state, context: c } = ui();
  state.selectedTask.status = 'DEGRADED';
  state.selectedTask.sessions.codex.state = 'running';
  state.selectedTask.sessions.antigravity = { sessionId: 'session-antigravity', state: 'exited' };
  c.renderConversationResume();
  assert.equal(e['#conversation-resume-open'].hidden, false);
  assert.equal(e['#conversation-resume-open'].title, 'resume.recoverExecutor');
  c.openConversationResume();
  assert.equal(e['#conversation-resume-title'].textContent, 'resume.recoverExecutor');
  assert.equal(e['#conversation-resume-button'].textContent, 'resume.recoverExecutor');
});
