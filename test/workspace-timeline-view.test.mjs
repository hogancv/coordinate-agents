import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { listDocument } from './support/list-dom.mjs';
import { I18N } from '../inspector/web-workspace/i18n.mjs';

const moduleUrl = new URL('../inspector/web-workspace/collaboration-timeline.mjs', import.meta.url);
function dom() {
  const document = listDocument();
  document.body.innerHTML = '<section id="collaboration-timeline"><h3 id="timeline-heading"></h3><div class="timeline-content"><label id="timeline-filter-label"></label><select id="timeline-round"></select><p id="timeline-note"></p><button id="timeline-more"></button><p id="timeline-error"></p><ol id="timeline-events"></ol><p id="timeline-empty"></p></div></section>';
  return document;
}
const events = ['SENT', 'WORKING', 'DONE', 'REVIEWING', 'APPROVED'].map((status, i) => ({ taskId: 'task1', roundId: 'round-first', revision: i + 1, timestamp: '2026-10-16T01:00:00Z', agent: i === 1 || i === 2 ? 'antigravity' : 'codex', fromStatus: i ? ['SENT', 'WORKING', 'DONE', 'REVIEWING'][i - 1] : 'IDLE', status, summary: i ? '<script>receipt</script>' : '' }));

test('older history loads on demand, retries errors, survives polling and ignores selection ABA responses', async () => {
  const { mountCollaborationTimeline } = await import(moduleUrl);
  const document = dom(), requests = [];
  let context = { projectId: 'p1', selectedId: 'task1', task: { id: 'task1', mode: 'default', cooperation: { roundId: 'round-first' },
    collaborationEvents: events.slice(3), collaborationHistory: { archivedEvents: 3, previousPage: 1 } } };
  let locale = 'en';
  const view = mountCollaborationTimeline({ document, getContext: () => context, t: key => I18N[locale][key] || key,
    loadPage: target => new Promise((resolve, reject) => requests.push({ target, resolve, reject })) });
  const more = document.querySelector('#timeline-more'), list = document.querySelector('#timeline-events');
  const click = () => more.listeners.get('click')[0]();
  view.update();
  assert.match(document.querySelector('#timeline-note').textContent, /3.*archiv/i);
  assert.equal(more.hidden, false); assert.equal(requests.length, 0);
  let pending = click(); assert.equal(more.disabled, true);
  assert.deepEqual(requests[0].target, { projectId: 'p1', taskId: 'task1', historyPage: 1 });
  requests[0].reject(Error('offline')); await pending;
  assert.equal(more.disabled, false); assert.match(document.querySelector('#timeline-error').textContent, /retry/i);
  pending = click();
  requests[1].resolve({ ...context.task, collaborationEvents: events.slice(0, 3), collaborationHistory: { archivedEvents: 3, previousPage: null } }); await pending;
  assert.equal(list.children.length, 5); assert.equal(more.hidden, true);
  view.update(); assert.equal(list.children.length, 5, 'polling cannot erase explicitly loaded pages');
  assert.deepEqual(list.children.map(row => row.dataset.revision), ['1', '2', '3', '4', '5']);
  locale = 'zh'; view.update(); assert.match(document.querySelector('#timeline-note').textContent, /3.*归档/);
  context.task = { ...context.task, collaborationEvents: events.slice(4), collaborationHistory: { archivedEvents: 4, previousPage: 2 } };
  view.update(); pending = click();
  requests[2].resolve({ ...context.task, collaborationEvents: events.slice(2, 4), collaborationHistory: { archivedEvents: 4, previousPage: 1 } }); await pending;
  assert.equal(list.children.length, 5, 'overlapping snapshots and pages cannot duplicate revisions');
  context = { ...context, projectId: 'p2' }; view.update();
  pending = click(); context = { ...context, projectId: 'p1' }; view.update();
  context = { ...context, projectId: 'p2' }; view.update();
  requests[3].resolve({ ...context.task, collaborationEvents: events.slice(0, 4), collaborationHistory: { archivedEvents: 4, previousPage: null } }); await pending;
  assert.equal(list.children.length, 1, 'a stale page must not survive project ABA');
  assert.equal(more.disabled, false); assert.equal(more.hidden, false);
});

test('timeline renders persisted facts as text, filters rounds, keeps focus/scroll and resets on task/project switches', async () => {
  const { mountCollaborationTimeline } = await import(moduleUrl);
  const document = dom();
  let context = { projectId: 'p1', selectedId: 'task1', task: { id: 'task1', mode: 'default', cooperation: { roundId: 'round-second' }, collaborationEvents: [...events, { ...events[0], revision: 6, roundId: 'round-second', fromStatus: 'APPROVED' }] } };
  let locale = 'en';
  const view = mountCollaborationTimeline({ document, getContext: () => context, t: key => I18N[locale][key] || key, onResize: () => {} });
  view.update();
  const details = document.querySelector('#collaboration-timeline'), list = document.querySelector('#timeline-events'), filter = document.querySelector('#timeline-round');
  assert.equal(details.hidden, false);
  assert.equal(list.children.length, 1);
  filter.value = 'all'; for (const listener of filter.listeners.get('change')) listener();
  assert.equal(list.children.length, 6);
  assert.match(list.textContent, /Codex.*IDLE → SENT/); assert.match(list.textContent, /Antigravity.*WORKING/);
  assert.match(list.textContent, /round-first/); assert.match(list.textContent, /round-second/);
  assert.equal(list.querySelectorAll('script').length, 0); assert.match(list.textContent, /<script>receipt<\/script>/);
  const content = document.querySelector('.timeline-content');
  content.scrollTop = 90; filter.focus(); view.update();
  assert.equal(content.scrollTop, 90); assert.equal(document.activeElement, filter);
  filter.value = 'round-first'; for (const listener of filter.listeners.get('change')) listener(); assert.equal(list.children.length, 5);
  locale = 'zh'; view.update(); assert.match(document.querySelector('#timeline-heading').textContent, /协作时间线/);
  context = { ...context, projectId: 'p2' }; view.update(); assert.equal(list.children.length, 1);
  context = { ...context, selectedId: 'task2' }; view.update(); assert.equal(details.hidden, true, 'old task must disappear immediately');
  context.task = { id: 'task2', mode: 'custom', collaborationEvents: events }; view.update(); assert.equal(details.hidden, true);
  context.task = { id: 'task2', mode: 'default', cooperation: { roundId: null }, collaborationEvents: [] }; view.update();
  assert.equal(details.hidden, false); assert.equal(list.children.length, 0); assert.equal(document.querySelector('#timeline-empty').hidden, false);
});

test('selected task loader rejects overlapping, project/task ABA and deselected responses', async () => {
  const app = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('async function loadSelectedTask('), end = app.indexOf('async function continueTaskStartup(', start);
  const requests = [];
  const state = { projectId: 'p1', selectedId: 'task1', projectEpoch: 0, reviewTaskEpoch: 0, selectedTaskRequest: 0, healthTaskId: 'task1', selectedTask: null };
  const context = vm.createContext({ state, fetchJson: () => new Promise(resolve => requests.push(resolve)), checkWorkspaceHealth: () => {}, rememberSelection: () => {}, renderSelectedTask: () => {}, renderWorkspaceHealth: () => {}, continueTaskStartup: () => {}, disposeTerminalViews: () => {} });
  vm.runInContext(app.slice(start, end), context);
  const first = context.loadSelectedTask(), second = context.loadSelectedTask();
  requests[1]({ id: 'task1', cooperation: { revision: 5 } }); await second;
  requests[0]({ id: 'task1', cooperation: { revision: 1 } }); await first;
  assert.equal(state.selectedTask.cooperation.revision, 5);
  const third = context.loadSelectedTask(); state.reviewTaskEpoch += 2; // task1 -> task2 -> task1
  requests[2]({ id: 'task1', cooperation: { revision: 2 } }); await third;
  assert.equal(state.selectedTask.cooperation.revision, 5);
  const fourth = context.loadSelectedTask(); state.projectEpoch += 2;
  requests[3]({ id: 'task1', cooperation: { revision: 3 } }); await fourth;
  assert.equal(state.selectedTask.cooperation.revision, 5);
  const fifth = context.loadSelectedTask(); state.selectedId = null; await context.loadSelectedTask();
  requests[4]({ id: 'task1', cooperation: { revision: 4 } }); await fifth; assert.equal(state.selectedTask, null);
});

test('late startup continuations cannot replace newer history or survive a task selection ABA', async () => {
  const app = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
  const start = app.indexOf('async function continueTaskStartup('), end = app.indexOf('async function refresh(', start);
  const posts = [];
  const state = { projectId: 'p1', projectEpoch: 0, selectedId: 'task1', reviewTaskEpoch: 0, selectedTaskRequest: 1,
    actionBusy: false, startupContinuing: new Set(), tasks: [], projectTasks: new Map(), selectedTask: null };
  const context = vm.createContext({ state, postAction: () => new Promise(resolve => posts.push(resolve)), renderTaskList: () => {}, renderSelectedTask: () => {}, renderWorkspaceHealth: () => {} });
  vm.runInContext(app.slice(start, end), context);
  const old = { id: 'task1', status: 'STARTING', startup: { slots: {} }, cooperation: { revision: 0 }, collaborationEvents: [] };
  const latest = { id: 'task1', status: 'RUNNING', cooperation: { revision: 2 }, collaborationEvents: events.slice(0, 2) };
  const first = context.continueTaskStartup(old, 'p1', 0);
  state.selectedTaskRequest++; state.selectedTask = latest;
  posts[0]({ workspaceTask: { ...old, status: 'RUNNING' } }); await first;
  assert.equal(state.selectedTask, latest);
  const second = context.continueTaskStartup(old, 'p1', 0);
  state.reviewTaskEpoch += 2; // A -> B -> A, even before another GET begins.
  posts[1]({ workspaceTask: { ...old, status: 'RUNNING' } }); await second;
  assert.equal(state.selectedTask, latest);
  assert.equal(state.startupContinuing.size, 0);
});
