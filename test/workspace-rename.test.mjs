import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createProjectStore } from '../inspector/server/workspace-projects.mjs';
import { startWorkspace } from '../inspector/server/workspace-server.mjs';
import { listDocument } from './support/list-dom.mjs';

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'workspace-rename-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const store = createProjectStore({ home });
  const projects = ['first', 'second'].map(name => {
    const root = join(home, name); mkdirSync(root);
    return store.register(root, true);
  });
  const id = 'workspace-rename0001';
  for (const [index, project] of projects.entries()) {
    const directory = join(project.root, '.agent-bus', 'workspace-tasks');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, `${id}.json`), JSON.stringify({ schemaVersion: 1, id,
      title: 'Original task', status: index ? 'RUNNING' : 'CLOSED', promptVersion: 'test',
      createdAt: '2026-10-21T00:00:00Z', updatedAt: '2026-10-21T00:00:00Z',
      sessions: { codex: { slot: 'codex', agent: 'codex', role: 'planner-reviewer', sessionId: null },
        antigravity: { slot: 'antigravity', agent: 'antigravity', role: 'implementer', sessionId: null } },
      sessionHistory: [], error: null }));
  }
  return { home, projects, id, record: project => join(project.root, '.agent-bus', 'workspace-tasks', `${id}.json`) };
}

async function serverFixture(t) {
  const fixtureData = fixture(t);
  const started = await startWorkspace({ root: fixtureData.projects[0].root, port: 0, projectHome: fixtureData.home });
  t.after(() => new Promise(resolve => { started.server.close(resolve); started.server.closeAllConnections?.(); }));
  const base = started.url.replace('localhost', '127.0.0.1');
  const headers = { 'content-type': 'application/json', 'x-coordinate-agents-capability': started.capability };
  const post = (project, title, extra = {}, authorized = true) => fetch(`${base}/api/projects/${project.id}/api/action`, {
    method: 'POST', headers: authorized ? headers : { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'workspaceTaskRename', params: { workspaceTaskId: fixtureData.id, title, ...extra } }),
  });
  return { ...fixtureData, base, headers, post };
}

test('renaming persists a trimmed task title in the chosen project without changing its terminal bindings', async t => {
  const f = await serverFixture(t);
  const otherBefore = readFileSync(f.record(f.projects[1]), 'utf8');
  for (const project of f.projects) {
    const before = JSON.parse(readFileSync(f.record(project), 'utf8'));
    const response = await f.post(project, '  修复登录 <review> 🙂  ');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).workspaceTask.title, '修复登录 <review> 🙂');
    const record = JSON.parse(readFileSync(f.record(project), 'utf8'));
    assert.equal(record.title, '修复登录 <review> 🙂');
    assert.equal(record.status, before.status);
    assert.equal(record.createdAt, before.createdAt);
    assert.deepEqual(record.sessions, before.sessions);
    assert.deepEqual(record.sessionHistory, before.sessionHistory);
    if (project === f.projects[0]) assert.equal(readFileSync(f.record(f.projects[1]), 'utf8'), otherBefore);
    const read = await fetch(`${f.base}/api/projects/${project.id}/api/workspace-tasks/${f.id}`, { headers: f.headers });
    assert.equal((await read.json()).title, '修复登录 <review> 🙂');
  }
});

test('rename rejects unauthorized, empty, oversized, multiline and project-root override requests without writing', async t => {
  const f = await serverFixture(t), project = f.projects[0];
  const before = readFileSync(f.record(project), 'utf8');
  assert.ok([401, 403].includes((await f.post(project, 'Denied', {}, false)).status));
  for (const title of ['', '   ', 'a'.repeat(129), 'first\nsecond', 'first\u0000second', 42, null]) {
    assert.equal((await (await f.post(project, title)).json()).ok, false, `invalid title: ${JSON.stringify(title)}`);
    assert.equal(readFileSync(f.record(project), 'utf8'), before);
  }
  assert.equal((await f.post(project, 'Wrong root', { root: f.projects[1].root })).status, 403);
  const archived = JSON.parse(before); archived.archivedAt = '2026-10-21T01:00:00Z';
  writeFileSync(f.record(project), JSON.stringify(archived));
  assert.equal((await (await f.post(project, 'Archived')).json()).ok, false);
  assert.equal(JSON.parse(readFileSync(f.record(project), 'utf8')).title, 'Original task');
});

const app = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
function renameContext() {
  const document = listDocument();
  const dialog = document.createElement('dialog'); dialog.setAttribute('id', 'task-rename-dialog');
  for (const id of ['task-rename-input', 'task-rename-error', 'task-rename-save', 'task-rename-cancel']) {
    const field = document.createElement('input'); field.setAttribute('id', id); dialog.append(field);
  }
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  document.body.append(dialog);
  const input = document.querySelector('#task-rename-input'); input.select = () => { input.selected = true; };
  const task = { id: 't1', title: 'Original', sessions: { codex: { sessionId: 'unchanged' } } };
  const state = { projectId: 'p1', projectEpoch: 1, selectedId: 't1', selectedTask: task, actionBusy: false,
    tasks: [task], projectTasks: new Map([['p1', [task]], ['p2', [{ ...task, title: 'Other project' }]]]) };
  const calls = [], toasts = [];
  const context = vm.createContext({ document, state, t: key => key, showToast: message => toasts.push(message),
    renderTaskList() {}, renderSelectedTask() {},
    async postAction(action, params, projectId) {
      calls.push({ action, title: params.title, id: params.workspaceTaskId, projectId });
      return { ok: true, workspaceTask: { ...task, title: params.title } };
    },
  });
  const start = app.indexOf('function openTaskRename(');
  assert.notEqual(start, -1, 'rename UI must exist');
  vm.runInContext(app.slice(start, app.indexOf('function renderTaskList(', start)), context);
  return { context, state, calls, toasts, dialog, input, task };
}

test('rename editor preselects the name, cancels without writing and updates both visible titles on save', async () => {
  const { context, state, calls, dialog, input, task } = renameContext();
  context.openTaskRename('p1', 't1');
  assert.equal(dialog.open, true); assert.equal(input.value, 'Original'); assert.equal(input.selected, true);
  input.value = 'Cancelled'; context.closeTaskRename();
  assert.equal(dialog.open, false); assert.equal(calls.length, 0);
  context.openTaskRename('p1', 't1'); input.value = '  新名称  ';
  await context.saveTaskRename({ preventDefault() {} });
  assert.deepEqual(calls, [{ action: 'workspaceTaskRename', id: 't1', title: '新名称', projectId: 'p1' }]);
  assert.equal(state.selectedTask.title, '新名称'); assert.equal(state.tasks[0].title, '新名称');
  assert.equal(state.projectTasks.get('p1')[0].title, '新名称');
  assert.equal(state.projectTasks.get('p2')[0].title, 'Other project');
  assert.equal(state.selectedTask.sessions, task.sessions);
  assert.equal(dialog.open, false);
});

test('empty, unchanged and failed renames retain the original title and keep failed drafts editable', async () => {
  const { context, state, calls, dialog, input } = renameContext();
  context.openTaskRename('p1', 't1'); input.value = '   ';
  await context.saveTaskRename({ preventDefault() {} });
  assert.equal(dialog.open, true); assert.equal(calls.length, 0); assert.equal(state.tasks[0].title, 'Original');
  input.value = 'Original'; await context.saveTaskRename({ preventDefault() {} });
  assert.equal(dialog.open, false); assert.equal(calls.length, 0);
  context.openTaskRename('p1', 't1'); input.value = 'Retry me';
  context.postAction = async () => { throw new Error('Network failed'); };
  await context.saveTaskRename({ preventDefault() {} });
  assert.equal(dialog.open, true); assert.equal(input.value, 'Retry me');
  assert.equal(state.selectedTask.title, 'Original'); assert.equal(state.renameBusy, false);
});

test('a slow rename response cannot overwrite the selected task or same-id task in another project', async () => {
  const { context, state, input, task } = renameContext();
  let complete;
  context.postAction = () => new Promise(resolve => { complete = resolve; });
  context.openTaskRename('p1', 't1'); input.value = 'First project renamed';
  const saving = context.saveTaskRename({ preventDefault() {} });
  state.projectId = 'p2'; state.projectEpoch++;
  state.tasks = state.projectTasks.get('p2'); state.selectedTask = state.tasks[0];
  complete({ workspaceTask: { ...task, title: 'First project renamed' } }); await saving;
  assert.equal(state.selectedTask.title, 'Other project'); assert.equal(state.tasks[0].title, 'Other project');
  assert.equal(state.projectTasks.get('p1')[0].title, 'First project renamed');
});

test('saving immediately after selecting a task fills its details instead of retaining the previous task', async () => {
  const { context, state, input, task } = renameContext();
  state.selectedTask = { id: 'previous', title: 'Previous task', sessions: {} };
  state.selectedTaskRequest = 4;
  context.openTaskRename('p1', 't1'); input.value = 'Newly selected task';
  await context.saveTaskRename({ preventDefault() {} });
  assert.equal(state.selectedTask.id, 't1');
  assert.equal(state.selectedTask.title, 'Newly selected task');
  assert.equal(state.selectedTask.sessions, task.sessions);
  assert.ok(state.selectedTaskRequest > 4);
});

test('renaming another task does not cancel the pending detail read for the current selection', async () => {
  const { context, state, input } = renameContext();
  context.openTaskRename('p1', 't1'); input.value = 'Renamed elsewhere';
  state.selectedId = 'another'; state.selectedTaskRequest = 7;
  await context.saveTaskRename({ preventDefault() {} });
  assert.equal(state.selectedTaskRequest, 7);
});
