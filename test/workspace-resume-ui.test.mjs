import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
function ui() {
  const ids = ['conversation-resume', 'conversation-resume-open', 'conversation-confirm-open',
    'conversation-id', 'conversation-manual-check', 'conversation-resume-button',
    'conversation-confirm-button', 'conversation-resume-status'];
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
  assert.equal(e['#conversation-confirm-open'].hidden, true);
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
  for (const status of ['RUNNING', 'EXITED', 'DEGRADED', 'ERROR']) {
    state.selectedTask.status = status; c.renderConversationResume();
    assert.equal(e['#conversation-resume-open'].hidden, true, status);
  }
});

test('resumed tasks keep a temporary confirmation entry until identity is confirmed', () => {
  const { elements: e, state, context: c } = ui();
  state.selectedTask.status = 'RUNNING';
  state.selectedTask.sessions.codex.state = 'running';
  state.selectedTask.resume = { state: 'AWAITING_CONFIRMATION', conversationId: '019a0000-0000-7000-8000-000000000001' };
  c.renderConversationResume();
  assert.equal(e['#conversation-resume-open'].hidden, true);
  assert.equal(e['#conversation-confirm-open'].hidden, false);
  c.openConversationResume();
  assert.equal(e['#conversation-resume'].open, true);
  assert.equal(e['#conversation-confirm-button'].disabled, true);
  e['#conversation-manual-check'].checked = true; c.renderConversationResume();
  assert.equal(e['#conversation-confirm-button'].disabled, false);
  state.selectedTask.resume.state = 'READY'; c.renderConversationResume();
  assert.equal(e['#conversation-confirm-open'].hidden, true);
  assert.equal(e['#conversation-resume'].open, false);
});

test('switching targets or hiding archived/custom tasks dismisses the dialog and clears confirmation', () => {
  const { elements: e, state, context: c } = ui();
  c.renderConversationResume(); c.openConversationResume();
  e['#conversation-manual-check'].checked = true;
  state.projectId = 'p2'; state.projectEpoch++; c.renderConversationResume();
  assert.equal(e['#conversation-resume'].open, false);
  assert.equal(e['#conversation-manual-check'].checked, false);
  c.openConversationResume(); state.selectedTask.archivedAt = 'now'; c.renderConversationResume();
  assert.equal(e['#conversation-resume'].open, false);
  assert.equal(e['#conversation-resume-open'].hidden, true);
  delete state.selectedTask.archivedAt; state.selectedTask.mode = 'custom'; c.renderConversationResume();
  assert.equal(e['#conversation-resume-open'].hidden, true);
  assert.equal(e['#conversation-confirm-open'].hidden, true);
});

test('manual proof captures the current runtime generation and ignores completion after a project switch', async () => {
  const { elements: e, state, context: c } = ui();
  state.selectedTask.status = 'RUNNING'; state.selectedTask.sessions.codex.state = 'running';
  state.selectedTask.resume = { state: 'AWAITING_CONFIRMATION', conversationId: '019a0000-0000-7000-8000-000000000001' };
  c.renderConversationResume(); c.openConversationResume(); e['#conversation-manual-check'].checked = true;
  let finish, seen; const pending = new Promise(done => { finish = done; });
  c.postAction = async (action, params, projectId) => { seen = { action, params, projectId }; return pending; };
  let refreshes = 0; c.refresh = async () => { refreshes++; };
  const operation = c.conversationTaskAction('confirm');
  assert.equal(seen.action, 'workspaceTaskConfirmConversation');
  assert.equal(seen.params.runtimeGeneration, 'old-generation'); assert.equal(seen.projectId, 'p1');
  state.projectId = 'p2'; state.projectEpoch++; finish({ ok: true }); await operation;
  assert.equal(refreshes, 0);
});
