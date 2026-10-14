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
