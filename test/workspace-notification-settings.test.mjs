import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { createLocalServer } from '../inspector/server/http-server.mjs';
import { createActionGateway } from '../inspector/server/action-gateway.mjs';
import { createWorkspaceData } from '../inspector/server/workspace-data.mjs';
import { invokeRuntimeOperation } from '../skills/coordinate-agents/scripts/workspace-services.mjs';
import { readNotificationConfig } from '../skills/coordinate-agents/scripts/workspace-notification-config.mjs';
const config = { enabled: true, events: { done: false, approved: true, failed: false } };

test('notification settings API uses capability and bound root; fixed test action never creates a receipt', async t => {
  const root = mkdtempSync(join(tmpdir(), 'notification-api-'));
  const other = mkdtempSync(join(tmpdir(), 'notification-api-other-'));
  mkdirSync(join(root, '.agent-bus')); mkdirSync(join(other, '.agent-bus'));
  let tests = 0;
  const capability = 'notification-test';
  const gateway = createActionGateway({ root, capability, invoke: async (operation, input, options) => {
    if (operation === 'workspaceNotificationsTest') {
      assert.deepEqual(Object.keys(input), ['root']); tests++;
      return { ok: true, notification: { status: 'accepted', displayed: null } };
    }
    return invokeRuntimeOperation(operation, input, options);
  } });
  const server = createLocalServer({ root, ui: 'workspace', capability, gateway, data: createWorkspaceData(root) });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(async () => { await new Promise(done => { server.close(done); server.closeAllConnections?.(); }); rmSync(root, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (action, params, authorized = true) => fetch(`${base}/api/action`, { method: 'POST', headers: { 'content-type': 'application/json', ...(authorized ? { 'x-coordinate-agents-capability': capability } : {}) }, body: JSON.stringify({ action, params }) });
  assert.equal((await post('workspaceNotificationsSave', { notifications: config }, false)).status, 401);
  assert.equal((await post('workspaceNotificationsSave', { notifications: config, root: other })).status, 403);
  assert.equal((await post('workspaceNotificationsSave', { notifications: { ...config, command: 'evil' } })).status, 400);
  assert.equal((await post('workspaceNotificationsTest', { script: 'evil' })).status, 400);
  assert.equal((await post('workspaceNotificationsTest', {}, false)).status, 401);
  assert.equal((await post('workspaceNotificationsTest', { root: other })).status, 403);
  const response = await post('workspaceNotificationsSave', { notifications: config });
  assert.equal(response.status, 200); assert.equal((await response.json()).ok, true);
  assert.deepEqual(readNotificationConfig(root), config); assert.equal(readNotificationConfig(other).enabled, false);
  const settings = await (await fetch(`${base}/api/workspace-settings`)).json();
  assert.deepEqual(settings.notifications.config, config);
  assert.equal(typeof settings.notifications.capability.supported, 'boolean');
  const tested = await (await post('workspaceNotificationsTest', {})).json();
  assert.equal(tested.notification.status, 'accepted'); assert.equal(tests, 1);
  assert.deepEqual(readNotificationConfig(root), config);
});

const app = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
function settingsContext() {
  const elements = new Map();
  for (const id of ['notifications-enabled', 'notifications-done', 'notifications-approved', 'notifications-failed', 'notifications-status', 'notifications-save', 'notifications-test']) elements.set(`#${id}`, { checked: false, disabled: false, textContent: '' });
  const state = { projectId: 'p1', projectEpoch: 0, settingsBusy: false, actionBusy: false, notificationBusy: false, notifications: { config, capability: { supported: true }, lastResult: null } };
  let error = null, calls = [];
  const context = vm.createContext({ state, document: { querySelector: id => elements.get(id) }, t: key => key,
    canEditProjectSettings: () => true, settingsError: value => { error = value; }, showToast() {}, setSettingsBusy(value) { state.settingsBusy = value; },
    postAction: async (...args) => { calls.push(args); throw new Error('save failed'); } });
  vm.runInContext(app.slice(app.indexOf('function renderNotificationSettings('), app.indexOf('function healthTerminal(')), context);
  return { context, elements, state, calls, error: () => error };
}
test('notification save failure retains form and the test button guards repeated clicks', async () => {
  const { context, elements, state, calls, error } = settingsContext();
  context.renderNotificationSettings();
  assert.equal(elements.get('#notifications-enabled').checked, true);
  elements.get('#notifications-done').checked = true;
  await context.saveNotificationSettings();
  assert.equal(calls[0][0], 'workspaceNotificationsSave');
  assert.equal(calls[0][1].notifications.events.done, true);
  assert.equal(elements.get('#notifications-done').checked, true);
  assert.equal(error(), 'save failed');
  let complete;
  context.postAction = async () => new Promise(done => { complete = done; });
  const first = context.sendNotificationTest();
  assert.equal(state.notificationBusy, true); assert.equal(elements.get('#notifications-test').disabled, true);
  await context.sendNotificationTest();
  complete({ notification: { status: 'accepted', displayed: null } }); await first;
  assert.equal(state.notificationBusy, false);
  assert.match(elements.get('#notifications-status').textContent, /accepted/);
});

test('a stale notification response cannot update a newly selected project', async () => {
  const { context, state } = settingsContext();
  let complete, submitted;
  context.postAction = (action, params, projectId) => { submitted = projectId; return new Promise(done => { complete = done; }); };
  const pending = context.saveNotificationSettings();
  state.projectId = 'p2'; state.projectEpoch++; state.settingsBusy = false;
  const current = { config: { enabled: false, events: { done: false, approved: false, failed: false } }, capability: { supported: false } };
  state.notifications = current;
  complete({ ok: true }); await pending;
  assert.equal(submitted, 'p1'); assert.equal(state.notifications, current);
});

test('the main settings save binds its terminal write to the original project and cancels after a switch', async () => {
  const { context, state } = settingsContext();
  context.document = { querySelector: () => ({ value: 'codex' }) };
  context.replaceCodexModel = () => []; context.replaceCodexEffort = () => [];
  context.notificationFormConfig = () => config;
  context.setBusy = value => { state.actionBusy = value; };
  context.closeSettings = () => {}; context.checkWorkspaceHealth = () => {};
  state.settings = {};
  vm.runInContext(app.slice(app.indexOf('async function saveSettings('), app.indexOf('function renderNotificationSettings(')), context);
  let complete; const requests = [];
  context.postAction = (action, params, projectId) => { requests.push({ action, projectId }); return requests.length === 1 ? new Promise(done => { complete = done; }) : Promise.resolve({ ok: true }); };
  const pending = context.saveSettings();
  state.projectId = 'p2'; state.projectEpoch++;
  const current = { config: { enabled: false } }; state.notifications = current;
  complete({ ok: true }); await pending;
  assert.deepEqual(requests, [{ action: 'workspaceSettingsSave', projectId: 'p1' }]);
  assert.equal(state.notifications, current);
});


test('the main settings save only saves terminal settings and does not touch notification preferences', async () => {
  const { context, state, error } = settingsContext();
  context.document = { querySelector: () => ({ value: 'codex' }) };
  context.replaceCodexModel = () => []; context.replaceCodexEffort = () => [];
  context.notificationFormConfig = () => config;
  context.setBusy = value => { state.actionBusy = value; };
  let closed = false;
  context.closeSettings = () => { closed = true; }; context.checkWorkspaceHealth = () => {};
  state.settings = {};
  const preferences = state.notifications;
  vm.runInContext(app.slice(app.indexOf('async function saveSettings('), app.indexOf('function renderNotificationSettings(')), context);
  const actions = [];
  context.postAction = async action => {
    actions.push(action);
    if (action === 'workspaceNotificationsSave') throw new Error('notification save failed');
    return { ok: true };
  };
  await context.saveSettings();
  assert.deepEqual(actions, ['workspaceSettingsSave']);
  assert.equal(closed, true);
  assert.equal(error(), undefined);
  assert.equal(state.notifications, preferences);
  assert.equal(state.settings.codex, 'codex');
});

test('notification tests bypass a busy project action queue and still run the project guard', async () => {
  const { withWorkspaceProjectOperation } = await import('../skills/coordinate-agents/scripts/workspace-services.mjs');
  const root = join(tmpdir(), 'notification-queue-check');
  let release, entered;
  const started = new Promise(done => { entered = done; });
  const queued = withWorkspaceProjectOperation(root, () => { entered(); return new Promise(done => { release = done; }); });
  await started;
  const denied = new Error('Project is archived.');
  let guarded = false;
  // Throw before any real OS notification. This exercises the production
  // invoke path while another real project operation owns its queue.
  const tested = invokeRuntimeOperation('workspaceNotificationsTest', { root }, { before: () => { guarded = true; throw denied; } }).catch(error => error);
  try {
    await new Promise(setImmediate);
    assert.equal(guarded, true, 'test notification waited on the shared project queue');
  } finally { release(); await queued; }
  assert.equal(await tested, denied);
  await assert.rejects(invokeRuntimeOperation('workspaceNotificationsTest', { root }, { before: () => { throw denied; } }), error => error === denied);
});

test('a slow notification test neither blocks normal project actions nor allows a concurrent test', async t => {
  const { withWorkspaceNotificationTest } = await import('../skills/coordinate-agents/scripts/workspace-services.mjs');
  assert.equal(typeof withWorkspaceNotificationTest, 'function');
  const root = mkdtempSync(join(tmpdir(), 'notification-independent-'));
  mkdirSync(join(root, '.agent-bus'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let complete;
  const slow = withWorkspaceNotificationTest(root, () => new Promise(done => { complete = done; }));
  try {
    await assert.rejects(invokeRuntimeOperation('workspaceNotificationsTest', { root }), /already running/i);
    const saved = invokeRuntimeOperation('workspaceNotificationsSave', { root, notifications: config });
    let savedBeforeNotificationFinished = false;
    saved.then(() => { savedBeforeNotificationFinished = true; });
    await new Promise(setImmediate);
    assert.equal(savedBeforeNotificationFinished, true);
    assert.equal((await saved).ok, true);
    assert.deepEqual(readNotificationConfig(root), config);
    assert.equal(await withWorkspaceNotificationTest(root + '-other', async () => 'other project'), 'other project');
  } finally { complete(); await slow; }
  assert.equal(await withWorkspaceNotificationTest(root, async () => 'again'), 'again');
  await assert.rejects(withWorkspaceNotificationTest(root, async () => { throw new Error('native failed'); }), /native failed/);
  assert.equal(await withWorkspaceNotificationTest(root, async () => 'after failure'), 'after failure');
});
