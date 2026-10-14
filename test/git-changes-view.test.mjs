import test from 'node:test';
import assert from 'node:assert/strict';
import { createChangesModel, diffRows } from '../inspector/web-workspace/git-changes.mjs';

test('project switch and drawer close discard stale list and diff replies', async () => {
  const pending = [];
  const model = createChangesModel({ request: (path, options) => new Promise(resolve => pending.push({ path, ...options, resolve })) });
  model.reset('a'); const a = model.refresh();
  model.reset('b'); const b = model.refresh();
  pending[1].resolve({ ok: true, files: [{ path: 'b', status: 'modified' }], summary: { files: 1, additions: 1, deletions: 0 } }); await b;
  pending[0].resolve({ ok: true, files: [{ path: 'a' }], summary: { files: 1 } }); await a;
  assert.equal(model.state.files[0].path, 'b');
  model.state.open = true; const diff = model.select('b'); model.close();
  pending[2].resolve({ ok: true, diff: '+stale code' }); await diff;
  assert.equal(model.state.diff, null); assert.equal(model.state.diffLoading, false);
  model.state.open = true; const old = model.select('b'); model.reset('c');
  pending[3].resolve({ ok: true, diff: '+old project' }); await old;
  assert.equal(model.state.path, null); assert.equal(model.state.diff, null); assert.deepEqual(model.state.files, []);
});

test('diff hunk line numbers handle additions, deletions, headers and no-newline markers', () => {
  const rows = diffRows('--- a/file\n+++ b/file\n@@ -4,2 +8,2 @@\n-old\n+<script>bad()</script>\n same\n\\ No newline at end of file\n');
  assert.deepEqual(rows.slice(3).map(row => [row.kind, row.old, row.new]), [['delete', 4, null], ['add', null, 8], ['context', 5, 9], ['meta', null, null]]);
  assert.equal(rows[4].text, '+<script>bad()</script>');
});

test('removing the last project closes the drawer and cancels pending changes while normal switches keep it open', async () => {
  let resolveList;
  const model = createChangesModel({ request: () => new Promise(resolve => { resolveList = resolve; }) });
  model.reset('a'); model.state.open = true;
  model.reset('b'); assert.equal(model.state.open, true);
  const pending = model.refresh();
  model.reset(null);
  assert.equal(model.state.open, false);
  assert.equal(model.state.loading, false);
  assert.equal(model.state.projectId, null);
  resolveList({ ok: true, files: [{ path: 'stale' }], summary: { files: 1 } });
  await pending;
  assert.deepEqual(model.state.files, []);
  assert.equal(model.state.summary, null);
});

import { mountChangesDrawer } from '../inspector/web-workspace/git-changes.mjs';
import { listDocument } from './support/list-dom.mjs';

function drawerDocument() {
  const doc = listDocument();
  const create = doc.createElement;
  doc.createElement = tag => {
    const el = create(tag);
    el.replaceChildren = (...children) => { for (const child of [...el.children]) child.remove(); el.append(...children); };
    return el;
  };
  doc.getElementById = id => doc.querySelector(`#${id}`);
  doc.createDocumentFragment = () => doc.createElement('fragment');
  doc.addEventListener = (type, fn) => doc.body.addEventListener(type, fn);
  for (const id of ['changes-button', 'changes-drawer', 'changes-title', 'changes-close', 'changes-refresh', 'changes-scope', 'changes-summary', 'changes-stat-note', 'changes-message', 'changes-files', 'changes-path', 'changes-copy-path', 'changes-copy-diff', 'changes-diff', 'review-feedback', 'review-title', 'review-selection', 'review-comment', 'review-clear', 'review-copy', 'review-send', 'review-status', 'review-ready', 'review-ready-label', 'review-hint']) {
    const el = doc.createElement('div'); el.setAttribute('id', id); el.value = ''; doc.body.append(el);
  }
  return doc;
}
const tick = () => new Promise(setImmediate);
const fixtureDiff = '@@ -1,2 +1,2 @@\n-old\n+中文 😀\n same\n';
async function setupDrawer({ locale = () => 'zh', sendToCodex = async ({ validateSelection }) => validateSelection(),
  files = [{ path: '<文件>.js', status: 'modified' }] } = {}) {
  const document = drawerDocument(); globalThis.document = document;
  const task = { id: 't', status: 'RUNNING', startup: { slots: { codex: 'READY' } }, sessions: { codex: { sessionId: 'c', state: 'idle' } } };
  const context = { projectId: 'a', taskId: 't', task, taskEpoch: 1, projectEpoch: 1 };
  let currentDiff = fixtureDiff; const requests = [];
  const drawer = mountChangesDrawer({ locale, toast() {}, getTaskContext: () => context, sendToCodex,
    request: async path => { requests.push(path); return path.includes('/diff?') ? { ok: true, diff: currentDiff } : { ok: true, files, summary: { files: files.length } }; } });
  drawer.reset('a'); await tick(); document.getElementById('changes-button').click(); await tick();
  document.getElementById('changes-files').children[0].click(); await tick();
  const $ = id => document.getElementById(id);
  const select = (index, shiftKey = false) => $('changes-diff').listeners.get('click').forEach(fn => fn({ target: $('changes-diff').querySelectorAll('[data-diff-row]')[index], shiftKey }));
  const comment = value => { $('review-comment').value = value; $('review-comment').listeners.get('input').forEach(fn => fn({})); };
  const ready = () => { $('review-ready').checked = true; $('review-ready').listeners.get('change').forEach(fn => fn({})); };
  return { drawer, $, select, comment, ready, context, requests, changeDiff: value => { currentDiff = value; } };
}

test('drawer selection is local, preserves editor focus through refresh of task context, and clears on diff reload', async () => {
  const env = await setupDrawer();
  assert.equal(env.$('review-feedback').hidden, true);
  const oldRows = env.$('changes-diff').children.slice(); const count = env.requests.length;
  env.select(1); env.select(2, true);
  env.comment('需要检查空字符串 😀'); env.$('review-comment').focus();
  env.drawer.render(); env.drawer.updateContext();
  assert.equal(env.requests.length, count);
  assert.deepEqual(env.$('changes-diff').children, oldRows);
  assert.equal(env.$('review-comment').value, '需要检查空字符串 😀');
  assert.equal(document.activeElement, env.$('review-comment'));
  assert.match(env.$('review-selection').textContent, /2/);
  env.$('changes-refresh').click(); await tick();
  assert.equal(env.$('review-feedback').hidden, true);
});

test('drawer single send keeps failed drafts, suppresses duplicate clicks and blocks stale selections', async () => {
  let reject; let writes = 0;
  const env = await setupDrawer({ sendToCodex: async ({ validateSelection }) => { await validateSelection(); writes++; await new Promise((_, no) => { reject = no; }); } });
  env.select(2); env.comment('fix'); env.ready();
  env.$('review-send').click(); env.$('review-send').click(); await tick();
  assert.equal(writes, 1); assert.equal(env.$('review-send').disabled, true);
  reject(Object.assign(new Error('uncertain'), { code: 'reviewUncertain' })); await tick();
  assert.equal(env.$('review-comment').value, 'fix');
  assert.equal(env.$('review-send').disabled, true); assert.equal(env.$('review-copy').disabled, false);
  env.select(1); env.ready(); env.changeDiff('@@ -1 +1 @@\n+changed\n');
  env.$('review-send').click(); await tick();
  assert.equal(writes, 1); assert.equal(env.$('review-send').disabled, true);
  assert.equal(env.$('review-comment').value, 'fix');
});

test('successful feedback sends consume readiness and edited comments require confirmation again', async () => {
  let writes = 0;
  const env = await setupDrawer({ sendToCodex: async ({ validateSelection }) => { await validateSelection(); writes++; } });
  env.context.inputRevision = 0;
  env.select(2); env.comment('first feedback'); env.ready();
  env.$('review-send').click(); await tick();
  assert.equal(writes, 1);
  assert.equal(env.$('review-ready').checked, false);
  assert.equal(env.$('review-send').disabled, true);
  env.comment('updated feedback');
  assert.equal(env.$('review-send').disabled, true);
  env.$('review-send').click(); await tick();
  assert.equal(writes, 1);
  env.ready();
  assert.equal(env.$('review-send').disabled, false);
  env.$('review-send').click(); await tick();
  assert.equal(writes, 2);
  assert.equal(env.$('review-ready').checked, false);
});

test('drawer provides a synchronous final selection guard after diff validation', async t => {
  const mutations = {
    'switch file': env => env.$('changes-files').children[1].click(),
    'refresh diff': env => env.$('changes-refresh').click(),
    'close drawer': env => env.$('changes-close').click(),
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    await t.test(name, async () => {
      let release, validated, writes = 0, selectionGuard;
      const taskRead = new Promise(resolve => { release = resolve; });
      const diffValidated = new Promise(resolve => { validated = resolve; });
      const env = await setupDrawer({
        files: [{ path: '<文件>.js', status: 'modified' }, { path: 'other.js', status: 'modified' }],
        sendToCodex: async ({ validateSelection, assertSelection }) => {
          await validateSelection(); selectionGuard = assertSelection; validated();
          await taskRead;
          // Model the handoff's final synchronous check without another diff request.
          assertSelection?.(); writes++;
        },
      });
      env.select(2); env.comment('feedback'); env.ready();
      env.$('review-send').click(); await diffValidated;
      mutate(env); release(); await tick();
      assert.equal(writes, 0);
      assert.throws(selectionGuard, { code: 'reviewTargetChanged' });
      assert.equal(env.requests.filter(path => path.includes('/diff?path=%3C')).length, 2);
    });
  }
});

test('task change disables the bound draft; project switch and close discard the previous target', async () => {
  const env = await setupDrawer(); env.select(2); env.comment('keep'); env.ready();
  env.context.taskEpoch++; env.drawer.updateContext();
  assert.equal(env.$('review-send').disabled, true); assert.equal(env.$('review-comment').value, 'keep');
  assert.equal(env.$('review-copy').disabled, false);
  env.drawer.reset('b'); await tick();
  assert.equal(env.$('review-feedback').hidden, true);
  assert.equal(env.$('review-comment').value, '');
});

test('copy works without a task, preserves the draft on clipboard failure, and never dispatches', async () => {
  let sent = 0, copied;
  const env = await setupDrawer({ sendToCodex: async () => { sent++; } });
  env.context.task = null; env.context.taskId = null;
  env.select(2); env.comment('中文 😀 complete feedback');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async value => { copied = value; } } } });
  try {
    const before = JSON.stringify(env.context), requests = env.requests.length;
    env.$('review-copy').click(); await tick();
    assert.ok(copied.includes('中文 😀 complete feedback'));
    assert.ok(copied.includes('<文件>.js'));
    assert.equal(sent, 0); assert.equal(env.requests.length, requests);
    assert.equal(JSON.stringify(env.context), before);
    navigator.clipboard.writeText = async () => { throw new Error('clipboard denied'); };
    env.$('review-copy').click(); await tick();
    assert.equal(env.$('review-comment').value, '中文 😀 complete feedback');
    assert.equal(env.$('review-send').disabled, true);
  } finally { if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator); else delete globalThis.navigator; }
});

test('new raw input revokes readiness confirmation, and closing discards the bound feedback', async () => {
  const env = await setupDrawer(); env.context.inputRevision = 1;
  env.select(2); env.comment('fix'); env.ready();
  assert.equal(env.$('review-send').disabled, false);
  env.context.inputRevision++; env.drawer.updateContext();
  assert.equal(env.$('review-ready').checked, false);
  assert.equal(env.$('review-send').disabled, true);
  env.$('changes-close').click();
  assert.equal(env.$('changes-drawer').hidden, true);
  assert.equal(env.$('review-comment').value, '');
});


test('locale changes update diff selection guidance without replacing code rows or feedback', async () => {
  let language = 'zh';
  const env = await setupDrawer({ locale: () => language });
  env.select(2); env.comment('保留');
  const line = env.$('changes-diff').querySelectorAll('[data-diff-row]')[2];
  assert.match(line.title, /点击/);
  language = 'en'; env.drawer.render();
  assert.equal(env.$('changes-diff').querySelectorAll('[data-diff-row]')[2], line);
  assert.match(line.title, /Click/);
  assert.equal(env.$('review-comment').value, '保留');
});
