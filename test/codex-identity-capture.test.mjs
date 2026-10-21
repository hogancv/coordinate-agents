import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const capture = await import('../skills/coordinate-agents/scripts/codex-identity-capture.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error;
});
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
function event(id = A, extra = {}) {
  return { resourceLogs: [{ scopeLogs: [{ logRecords: [{ attributes: Object.entries({
    'event.name': 'codex.conversation_starts', 'conversation.id': id, 'event.timestamp': new Date().toISOString(),
    'app.version': '0.163.0', originator: 'codex_cli_rs', ...extra,
  }).map(([key, value]) => ({ key, value: { stringValue: value } })) }] }] }] };
}
function records(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'codex-capture-'))), home = join(root, 'home');
  const directory = join(home, 'sessions'); mkdirSync(directory, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (id = A, extra = {}) => writeFileSync(join(directory, `rollout-test-${id}.jsonl`), JSON.stringify({ type: 'session_meta',
    payload: { id, cwd: root, source: 'cli', originator: 'codex_cli_rs', cli_version: '0.163.0', ...extra } }) + '\n');
  return { root, home, write };
}

test('capture authenticates its private process endpoint and rejects stale, foreign or non-primary metadata', async t => {
  assert.equal(typeof capture.createCodexIdentityCapture, 'function');
  const f = records(t); f.write();
  let active = true; const observed = [];
  const collector = await capture.createCodexIdentityCapture({ root: f.root, codexHome: f.home, version: '0.163.0',
    isActive: () => active, observe: async value => { observed.push(value); } });
  t.after(() => collector.close());
  const post = (data, endpoint = collector.endpoint) => fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  assert.equal((await post(event(), collector.endpoint.replace(/identity\/.+$/, 'identity/wrong'))).status, 403);
  await post(event(A, { 'event.timestamp': new Date(Date.now() - 60000).toISOString() }));
  f.write(A, { source: { subagent: {} } }); await post(event());
  f.write(A, { cwd: tmpdir() }); await post(event());
  f.write(A, { originator: 'invented-source' }); await post(event());
  assert.equal(observed.length, 0);
  f.write(); await post(event());
  assert.equal(observed.length, 1); assert.equal(observed[0].conversationId, A);
  assert.equal(observed[0].source.id, 'codex-otel');
  active = false; f.write(B); await post(event(B)); assert.equal(observed.length, 1);
});

test('capture bounds JSON requests and ignores duplicate attributes and event replays', async t => {
  assert.equal(typeof capture.createCodexIdentityCapture, 'function');
  const f = records(t); f.write(); let count = 0;
  const collector = await capture.createCodexIdentityCapture({ root: f.root, codexHome: f.home, version: '0.163.0', isActive: () => true,
    observe: async () => { count++; } });
  t.after(() => collector.close());
  const post = body => fetch(collector.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal((await post('x'.repeat(1024 * 1024 + 1))).status, 413);
  assert.equal((await post('{invalid')).status, 400);
  const duplicate = event(); duplicate.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.push({ key: 'conversation.id', value: { stringValue: B } });
  await post(JSON.stringify(duplicate)); assert.equal(count, 0);
  const payload = JSON.stringify(event()); await post(payload); await post(payload); assert.equal(count, 1);
});

test('a primary user-prompt event binds a lazy native record after startup discovery was unavailable', async t => {
  const f = records(t); let count = 0;
  const collector = await capture.createCodexIdentityCapture({ root: f.root, codexHome: f.home, version: '0.163.0',
    isActive: () => true, observe: async () => { count++; } });
  t.after(() => collector.close());
  f.write();
  await fetch(collector.endpoint, { method: 'POST', body: JSON.stringify(event(A, { 'event.name': 'codex.user_prompt' })) });
  assert.equal(count, 1);
});

test('repeated prompts for the bound identity do not exhaust detection of a different conversation', async t => {
  const f = records(t); f.write(); f.write(B); const observed = [];
  const collector = await capture.createCodexIdentityCapture({ root: f.root, codexHome: f.home, version: '0.163.0',
    isActive: () => true, observe: async value => { observed.push(value.conversationId); } });
  t.after(() => collector.close());
  const stamp = Date.now();
  for (let index = 0; index < 270; index++) await fetch(collector.endpoint, { method: 'POST', body: JSON.stringify(event(A,
    { 'event.name': 'codex.user_prompt', 'event.timestamp': new Date(stamp + index).toISOString() })) });
  await fetch(collector.endpoint, { method: 'POST', body: JSON.stringify(event(B,
    { 'event.timestamp': new Date(stamp + 300).toISOString() })) });
  assert.deepEqual(observed, [A, B]);
});

test('a newer untrusted subagent candidate cannot suppress an earlier primary event in the same batch', async t => {
  const f = records(t); f.write(); f.write(B, { source: { subagent: {} } }); const observed = [];
  const collector = await capture.createCodexIdentityCapture({ root: f.root, codexHome: f.home, version: '0.163.0',
    isActive: () => true, observe: async value => { observed.push(value.conversationId); } });
  t.after(() => collector.close());
  const stamp = Date.now(), batch = event(B, { 'event.timestamp': new Date(stamp + 1).toISOString() });
  batch.resourceLogs[0].scopeLogs[0].logRecords.push(...event(A, { 'event.timestamp': new Date(stamp).toISOString() }).resourceLogs[0].scopeLogs[0].logRecords);
  await fetch(collector.endpoint, { method: 'POST', body: JSON.stringify(batch) });
  assert.deepEqual(observed, [A]);
});

test('distinct primary identities sharing millisecond timestamps are both observed', async t => {
  const f = records(t); f.write(); f.write(B); const observed = [];
  const collector = await capture.createCodexIdentityCapture({ root: f.root, codexHome: f.home, version: '0.163.0',
    isActive: () => true, observe: async value => { observed.push(value.conversationId); } });
  t.after(() => collector.close());
  const timestamp = new Date().toISOString(), batch = event(A, { 'event.timestamp': timestamp });
  batch.resourceLogs[0].scopeLogs[0].logRecords.push(...event(B, { 'event.timestamp': timestamp }).resourceLogs[0].scopeLogs[0].logRecords);
  await fetch(collector.endpoint, { method: 'POST', body: JSON.stringify(batch) });
  assert.deepEqual(observed, [A, B]);
});
