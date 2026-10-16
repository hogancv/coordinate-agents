import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { dispatchWorkspaceTask, reportWorkspaceTask, readWorkspaceTask, readWorkspaceTasks, validateWorkspaceTaskRecord } from '../skills/coordinate-agents/scripts/workspace-task-runtime.mjs';
import { startWorkspace } from './support/workspace-server.mjs';

function fixture(t, id = 'workspace-timeline123') {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'collaboration-')));
  for (const directory of ['workspace-tasks', 'sessions', 'tmp']) mkdirSync(join(root, '.agent-bus', directory), { recursive: true });
  const sessions = Object.fromEntries(['codex', 'antigravity'].map(agent => [agent, {
    slot: agent, agent, role: agent === 'codex' ? 'planner-reviewer' : 'implementer', sessionId: `session_${agent}12345678`,
  }]));
  const record = { schemaVersion: 1, id, mode: 'default', title: 'Timeline', status: 'RUNNING', promptVersion: 'test',
    createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z', sessions };
  const file = join(root, '.agent-bus/workspace-tasks', `${id}.json`);
  writeFileSync(file, JSON.stringify(record));
  for (const [agent, session] of Object.entries(sessions)) writeFileSync(join(root, '.agent-bus/sessions', `${session.sessionId}.json`), JSON.stringify({ id: session.sessionId, command: 'unused', agent, taskId: id, cwd: root, state: 'idle' }));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, id, file, record };
}
const quiet = { notify: () => {} };
const report = (f, status, round = 'round-first', summary = '') => reportWorkspaceTask(f.root, f.id, status, round, summary, quiet);
const history = async f => (await readWorkspaceTask(f.root, f.id)).collaborationEvents;

test('formal transitions persist atomically with revisions, keep rework rounds and survive fresh processes', async t => {
  const f = fixture(t);
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  for (const status of ['WORKING', 'DONE', 'REVIEWING', 'CHANGES_REQUESTED']) await report(f, status);
  await dispatchWorkspaceTask(f.root, f.id, 'round-second', async () => {});
  for (const status of ['WORKING', 'DONE', 'REVIEWING', 'CHANGES_REQUESTED']) await report(f, status, 'round-second');
  await dispatchWorkspaceTask(f.root, f.id, 'round-third', async () => {});
  for (const status of ['WORKING', 'DONE', 'REVIEWING', 'APPROVED']) await report(f, status, 'round-third', 'Test receipt');
  const events = await history(f);
  assert.deepEqual(events.map(e => e.status), ['SENT', 'WORKING', 'DONE', 'REVIEWING', 'CHANGES_REQUESTED', 'SENT', 'WORKING', 'DONE', 'REVIEWING', 'CHANGES_REQUESTED', 'SENT', 'WORKING', 'DONE', 'REVIEWING', 'APPROVED']);
  assert.deepEqual(events.map(e => e.roundId), [...Array(5).fill('round-first'), ...Array(5).fill('round-second'), ...Array(5).fill('round-third')]);
  assert.deepEqual(events.slice(0, 5).map(e => e.agent), ['codex', 'antigravity', 'antigravity', 'codex', 'codex']);
  for (const [i, e] of events.entries()) {
    assert.equal(e.taskId, f.id); assert.equal(e.revision, i + 1);
    assert.equal(e.fromStatus, i ? events[i - 1].status : 'IDLE');
    assert.ok(Number.isFinite(Date.parse(e.timestamp)));
  }
  const persisted = JSON.parse(readFileSync(f.file));
  assert.equal(persisted.cooperation.revision, events.at(-1).revision);
  assert.equal(persisted.cooperation.updatedAt, events.at(-1).timestamp);
  assert.equal((await readWorkspaceTasks(f.root))[0].collaborationEvents, undefined, 'list polling must not carry full history');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {readWorkspaceTask} from ${JSON.stringify(new URL('../skills/coordinate-agents/scripts/workspace-task-runtime.mjs', import.meta.url).href)}; console.log(JSON.stringify((await readWorkspaceTask(process.argv[1], process.argv[2])).collaborationEvents));`, f.root, f.id], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); assert.deepEqual(JSON.parse(child.stdout), events);
});

test('duplicate receipts and summary edits never manufacture transitions; stale and failed writes leave history unchanged', async t => {
  const f = fixture(t);
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  await Promise.all([report(f, 'WORKING'), report(f, 'WORKING')]);
  await report(f, 'WORKING', 'round-first', 'changed');
  await report(f, 'DONE');
  assert.deepEqual((await history(f)).map(e => [e.status, e.revision]), [['SENT', 1], ['WORKING', 2], ['DONE', 4]]);
  const before = readFileSync(f.file, 'utf8');
  await assert.rejects(report(f, 'REVIEWING', 'round-stale'), /roundId/);
  await assert.rejects(dispatchWorkspaceTask(f.root, f.id, 'round-next', async () => { throw Error('no delivery'); }), /delivery/);
  assert.equal(readFileSync(f.file, 'utf8'), before);
  rmSync(join(f.root, '.agent-bus/tmp'), { recursive: true }); writeFileSync(join(f.root, '.agent-bus/tmp'), 'blocked');
  await assert.rejects(report(f, 'REVIEWING'));
  assert.equal(readFileSync(f.file, 'utf8'), before);
});

test('history never infers completion from sessions or reconstructs legacy snapshots and rejects corrupted history', async t => {
  const f = fixture(t);
  assert.deepEqual(await history(f), []);
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  const before = await history(f);
  for (const state of ['idle', 'exited', 'failed']) {
    const sessionFile = join(f.root, '.agent-bus/sessions', `${f.record.sessions.antigravity.sessionId}.json`);
    const session = JSON.parse(readFileSync(sessionFile)); writeFileSync(sessionFile, JSON.stringify({ ...session, state }));
    assert.deepEqual(await history(f), before);
  }
  const value = JSON.parse(readFileSync(f.file)); delete value.collaborationEvents;
  writeFileSync(f.file, JSON.stringify(value));
  assert.deepEqual(await history(f), [], 'legacy snapshot is not an event log');
  assert.throws(() => validateWorkspaceTaskRecord({ ...value, collaborationEvents: [{ status: 'DONE' }] }), /collaboration/i);
});

test('summaries are single-line, credential-redacted, Unicode bounded and do not include dispatch instructions', async t => {
  const f = fixture(t);
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  const secret = '\x1b[31mDone\x1b[0m\nTOKEN="abc def" Authorization: Basic dXNlcjpwYXNz https://alice:pwd@example.com/path?api_key=hidden ghp_123456789012345678901234567890123456 sk-proj-123456789012345678901234567890';
  await report(f, 'WORKING', 'round-first', secret);
  await report(f, 'DONE', 'round-first', '🙂'.repeat(400));
  const events = await history(f);
  assert.equal(events[0].summary, '');
  assert.doesNotMatch(JSON.stringify(events), /abc|def\"|dXNlcjpwYXNz|alice|pwd|hidden|ghp_|sk-proj-|\\u001b/);
  assert.doesNotMatch(events[1].summary, /[\r\n\x00-\x1f\x7f]/);
  assert.ok(Array.from(events[2].summary).length <= 240);
  assert.doesNotMatch(events[2].summary, /\uFFFD/);
});

test('existing task API returns isolated history after server restart, serves timeline assets', async t => {
  const f = fixture(t);
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  await report(f, 'DONE');
  const expected = await history(f);
  for (let i = 0; i < 2; i++) {
    const server = await startWorkspace({ root: f.root, port: 0 });
    try {
      const base = server.url.replace('localhost', '127.0.0.1');
      const url = `${base}/api/workspace-tasks/${f.id}`;
      const response = await fetch(url, { headers: { 'x-coordinate-agents-capability': server.capability } });
      assert.equal(response.status, 200); assert.deepEqual((await response.json()).collaborationEvents, expected);
      const asset = await fetch(`${base}/collaboration-timeline.mjs`); assert.equal(asset.status, 200);
    } finally { await new Promise(done => { server.server.close(done); server.server.closeAllConnections?.(); }); }
  }
});

test('independent report processes serialize duplicate transitions and preserve another task unchanged', async t => {
  const f = fixture(t);
  const other = { ...f.record, id: 'workspace-other12345' };
  const otherFile = join(f.root, '.agent-bus/workspace-tasks', `${other.id}.json`);
  writeFileSync(otherFile, JSON.stringify(other));
  const before = readFileSync(otherFile, 'utf8');
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  const { spawn } = await import('node:child_process');
  const code = `import {reportWorkspaceTask} from ${JSON.stringify(new URL('../skills/coordinate-agents/scripts/workspace-task-runtime.mjs', import.meta.url).href)}; await reportWorkspaceTask(process.argv[1], process.argv[2], 'WORKING', 'round-first', 'same');`;
  const child = () => new Promise((done, reject) => {
    const process = spawn(globalThis.process.execPath, ['--input-type=module', '-e', code, f.root, f.id], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let error = ''; process.stderr.on('data', chunk => { error += chunk; });
    process.on('error', reject); process.on('exit', status => status === 0 ? done() : reject(Error(error)));
  });
  await Promise.all([child(), child(), child()]);
  assert.deepEqual((await history(f)).map(event => event.status), ['SENT', 'WORKING']);
  await report(f, 'FAILED', 'round-first', 'Formal failure');
  assert.equal((await history(f)).at(-1).status, 'FAILED');
  assert.equal(readFileSync(otherFile, 'utf8'), before);
});

test('history sanitizer redacts before Unicode truncation, including load-time untrusted previews', async () => {
  const { collaborationSummary } = await import('../skills/coordinate-agents/scripts/workspace-collaboration.mjs');
  for (const input of ['prefix password="secret with spaces" suffix', '{"api_key":"hidden value"}', 'https://name:pass@host/?token=hidden&x=ok', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature', '-----BEGIN RSA PRIVATE KEY-----\nprivate-content\n-----END RSA PRIVATE KEY-----']) {
    assert.doesNotMatch(collaborationSummary(input), /secret with spaces|hidden|name:pass|private-content|eyJhbGci/);
  }
  const preview = collaborationSummary('safe '.repeat(42) + 'TOKEN=' + 'a'.repeat(700));
  assert.ok(Array.from(preview).length <= 240); assert.doesNotMatch(preview, /a{10}/);
});


test('complete Cookie headers are private, including quoted values, multiple cookies and following text', async t => {
  const { collaborationSummary } = await import('../skills/coordinate-agents/scripts/workspace-collaboration.mjs');
  for (const value of ['Cookie: session=alpha; sid=bravo', 'Set-Cookie: session=alpha; Secure; HttpOnly', 'cookie="sid=alpha; auth=bravo"', 'COOKIE: session=alpha;\nTests passed']) {
    assert.doesNotMatch(collaborationSummary(value), /alpha|bravo|HttpOnly/);
  }
  assert.match(collaborationSummary('Cookie: session=alpha; sid=bravo\nTests passed'), /Tests passed/);
  const f = fixture(t);
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  await report(f, 'WORKING', 'round-first', 'Cookie: session=alpha; sid=bravo');
  const stored = JSON.parse(readFileSync(f.file));
  assert.doesNotMatch(JSON.stringify(stored.collaborationEvents), /alpha|bravo/);
  stored.collaborationEvents[1].summary = 'Cookie: session=alpha; sid=bravo';
  writeFileSync(f.file, JSON.stringify(stored));
  assert.doesNotMatch(JSON.stringify(await history(f)), /alpha|bravo/);

});
