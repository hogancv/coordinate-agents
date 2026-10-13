import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceMessage } from '../skills/coordinate-agents/scripts/workspace-message.mjs';

function fixture({ taskId = 'task-a', status = 'RUNNING' } = {}) {
  const writes = [];
  let cooperation = { status: 'IDLE', roundId: null, revision: 0, summary: '' };
  return { writes, api: {
    readWorkspaceTask: async () => ({ status, cooperation, sessions: { antigravity: { sessionId: 'peer-a' } } }),
    runtimeSessionRead: async input => ({ session: { taskId, agent: 'antigravity' }, nextCursor: 42, output: 'hello', ...input }),
    runtimeSessionWrite: async input => { writes.push(input); },
    dispatchWorkspaceTask: async (root, id, roundId, deliver) => {
      await deliver();
      cooperation = { status: 'SENT', roundId, revision: cooperation.revision + 1, summary: '' };
      return cooperation;
    },
  } };
}
test('send binds to this pair, captures cursor before input, and writes Enter separately', async () => {
  const { writes, api } = fixture();
  const result = await workspaceMessage('/repo', 'task-a', 'send', 'hello', api);
  assert.equal(result.cursor, 42);
  assert.match(result.roundId, /^round-/);
  assert.equal(result.status, 'SENT');
  assert.match(writes[0].input, /hello/);
  assert.ok(writes[0].input.includes(result.roundId));
  assert.equal(writes[0].sessionId, 'peer-a');
  assert.equal(writes[0].submit, false);
  assert.equal(writes[1].input, '\r');
  await workspaceMessage('/repo', 'task-a', 'read', '42', api);
  assert.equal(writes.length, 2);
});
test('mismatched and starting tasks never receive input', async () => {
  for (const options of [{ taskId: 'task-b' }, { status: 'STARTING' }]) {
    const { writes, api } = fixture(options);
    await assert.rejects(workspaceMessage('/repo', 'task-a', 'send', 'hello', api));
    assert.equal(writes.length, 0);
  }
});
test('invalid inputs are rejected before lookup', async () => {
  await assert.rejects(workspaceMessage('/repo', 'task-a', 'read', '-1', {}));
  await assert.rejects(workspaceMessage('/repo', 'task-a', 'send', '', {}));
});

test('message helper executes through an npm-style symlink', async t => {
  if (process.platform === 'win32') { t.skip('Windows npm uses a command shim rather than a file symlink'); return; }
  const { mkdtempSync, symlinkSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const temporary = mkdtempSync(join(tmpdir(), 'workspace-message-link-'));
  try {
    const linked = join(temporary, 'message.mjs');
    symlinkSync(fileURLToPath(new URL('../skills/coordinate-agents/scripts/workspace-message.mjs', import.meta.url)), linked);
    const result = spawnSync(process.execPath, [linked, 'invalid', 'send', 'hello'], { cwd: temporary, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).ok, false);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

// Keep the wait tests short while exercising the same bounded loop as the CLI.
test('wait observes a state-only receipt and times out without sending again', async () => {
  const { api, writes } = fixture();
  let reads = 0;
  api.runtimeSessionRead = async () => ({ session: { taskId: 'task-a', agent: 'antigravity', state: 'idle' }, nextCursor: 42, output: '' });
  api.readWorkspaceTask = async () => ({ status: 'RUNNING', sessions: { antigravity: { sessionId: 'peer-a' } },
    cooperation: { roundId: 'round-a', status: ++reads > 1 ? 'DONE' : 'WORKING', revision: reads > 1 ? 3 : 2, summary: 'finished' } });
  const received = await workspaceMessage('/repo', 'task-a', 'wait', '42', api, { revision: 2, timeoutMs: 100, pollMs: 5 });
  assert.equal(received.status, 'DONE');
  assert.equal(received.pending, false);
  api.readWorkspaceTask = async () => ({ status: 'RUNNING', sessions: { antigravity: { sessionId: 'peer-a' } },
    cooperation: { roundId: 'round-a', status: 'WORKING', revision: 2 } });
  const pending = await workspaceMessage('/repo', 'task-a', 'wait', '42', api, { revision: 2, timeoutMs: 15, pollMs: 5 });
  assert.equal(pending.pending, true);
  assert.equal(pending.cursor, 42);
  assert.equal(writes.length, 0);
});

test('wait notices receipts already present, and output remains ordinary terminal text', async () => {
  const { api } = fixture();
  api.readWorkspaceTask = async () => ({ status: 'RUNNING', sessions: { antigravity: { sessionId: 'peer-a' } },
    cooperation: { roundId: 'round-a', status: 'DONE', revision: 3 } });
  api.runtimeSessionRead = async () => ({ session: { taskId: 'task-a', agent: 'antigravity' }, nextCursor: 42, output: '' });
  assert.equal((await workspaceMessage('/repo', 'task-a', 'wait', '42', api)).pending, false);
  api.readWorkspaceTask = async () => ({ status: 'RUNNING', sessions: { antigravity: { sessionId: 'peer-a' } },
    cooperation: { roundId: 'round-a', status: 'SENT', revision: 1 } });
  api.runtimeSessionRead = async () => ({ session: { taskId: 'task-a', agent: 'antigravity', state: 'idle' }, nextCursor: 43, output: 'done approved' });
  const reply = await workspaceMessage('/repo', 'task-a', 'wait', '42', api, { revision: 1 });
  assert.equal(reply.status, 'SENT');
  assert.equal(reply.pending, false);
});

test('task JSON persists receipts, isolates rounds/tasks, and preserves Session fields', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const runtime = await import('../skills/coordinate-agents/scripts/workspace-task-runtime.mjs');
  const root = mkdtempSync(join(tmpdir(), 'workspace-receipts-'));
  const directory = join(root, '.agent-bus', 'workspace-tasks');
  mkdirSync(directory, { recursive: true });
  mkdirSync(join(root, '.agent-bus', 'sessions'));
  const id = 'workspace-receipts0001';
  const other = 'workspace-receipts0002';
  const timestamp = new Date().toISOString();
  const sessions = { codex: { slot: 'codex', agent: 'codex', role: 'planner-reviewer', sessionId: 'session_receiptcodex' },
    antigravity: { slot: 'antigravity', agent: 'antigravity', role: 'implementer', sessionId: 'session_receiptagy01' } };
  const record = { schemaVersion: 1, id, title: 'Receipt test', status: 'RUNNING', promptVersion: 'test',
    createdAt: timestamp, updatedAt: timestamp, sessions, sessionHistory: [], error: null };
  const path = join(directory, `${id}.json`);
  writeFileSync(path, JSON.stringify(record));
  writeFileSync(join(directory, `${other}.json`), JSON.stringify({ ...record, id: other }));
  for (const slot of Object.values(sessions)) writeFileSync(join(root, '.agent-bus', 'sessions', `${slot.sessionId}.json`),
    JSON.stringify({ schemaVersion: 1, id: slot.sessionId, agent: slot.agent, cwd: root, command: 'mock', state: 'running', taskId: id }));
  try {
    assert.equal((await runtime.readWorkspaceTask(root, id)).cooperation.status, 'IDLE');
    const sent = await runtime.dispatchWorkspaceTask(root, id, 'round-first', async () => {});
    assert.equal(sent.status, 'SENT');
    for (const status of ['WORKING', 'DONE', 'REVIEWING', 'APPROVED']) {
      const result = await workspaceMessage(root, id, 'report', status.toLowerCase(), undefined, { roundId: sent.roundId, summary: status === 'DONE' ? 'changed app.js' : '' });
      assert.equal(result.status, status);
    }
    const saved = JSON.parse(readFileSync(path));
    assert.equal(saved.cooperation.status, 'APPROVED');
    assert.deepEqual(saved.sessions, sessions);
    assert.deepEqual(saved.sessionHistory, []);
    assert.equal((await runtime.readWorkspaceTasks(root)).find(task => task.id === id).cooperation.status, 'APPROVED');
    assert.equal((await runtime.readWorkspaceTask(root, other)).cooperation.status, 'IDLE');
    await runtime.dispatchWorkspaceTask(root, id, 'round-second', async () => {});
    await assert.rejects(workspaceMessage(root, id, 'report', 'done', undefined, { roundId: sent.roundId }), /round/i);
    assert.equal((await runtime.readWorkspaceTask(root, id)).cooperation.status, 'SENT');
    await assert.rejects(workspaceMessage(root, id, 'report', 'approved', undefined, { roundId: 'round-second' }), /transition/i);
    await assert.rejects(workspaceMessage(root, id, 'report', 'bogus', undefined, { roundId: 'round-second' }), /status/i);
    await assert.rejects(workspaceMessage(root, id, 'report', 'done', undefined, { roundId: 'round-second', summary: 'x'.repeat(2049) }), /summary/i);
    for (const status of ['working', 'done', 'reviewing', 'changes-requested']) {
      const reported = await workspaceMessage(root, id, 'report', status, undefined, { roundId: 'round-second', summary: 'corrections needed' });
      assert.equal(reported.status, status.toUpperCase().replaceAll('-', '_'));
    }
    let immediateReceipt;
    await runtime.dispatchWorkspaceTask(root, id, 'round-third', async () => {
      immediateReceipt = runtime.reportWorkspaceTask(root, id, 'WORKING', 'round-third');
      await new Promise(done => setTimeout(done, 5));
    });
    assert.equal((await immediateReceipt).status, 'WORKING');
    assert.equal((await workspaceMessage(root, id, 'report', 'failed', undefined, { roundId: 'round-third', summary: 'blocked' })).status, 'FAILED');
    await assert.rejects(runtime.dispatchWorkspaceTask(root, id, 'round-failed', async () => { throw new Error('write failed'); }), /write failed/);
    assert.equal((await runtime.readWorkspaceTask(root, id)).cooperation.roundId, 'round-third');
    const sessionPath = join(root, '.agent-bus', 'sessions', `${sessions.antigravity.sessionId}.json`);
    const session = JSON.parse(readFileSync(sessionPath));
    writeFileSync(sessionPath, JSON.stringify({ ...session, taskId: other }));
    await assert.rejects(workspaceMessage(root, id, 'report', 'working', undefined, { roundId: 'round-third' }), /binding/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('wait returns a persisted receipt even when terminal transport is unavailable', async () => {
  const { api } = fixture();
  let taskReads = 0;
  api.readWorkspaceTask = async () => ({ status: 'RUNNING', sessions: { antigravity: { sessionId: 'peer-a' } },
    cooperation: { roundId: 'round-a', status: ++taskReads > 2 ? 'DONE' : 'WORKING', revision: taskReads > 2 ? 3 : 2 } });
  api.runtimeSessionRead = async () => { throw new Error('host unavailable'); };
  const result = await workspaceMessage('/repo', 'task-a', 'wait', '42', api, { revision: 2, timeoutMs: 100 });
  assert.equal(result.status, 'DONE');
  assert.equal(result.pending, false);
  assert.equal(result.cursor, 42);
});

test('wait bounds a stalled host read and still observes a new receipt', async () => {
  const { api } = fixture();
  let reads = 0, outputReads = 0;
  api.readWorkspaceTask = async () => ({ status: 'RUNNING', sessions: { antigravity: { sessionId: 'peer-a' } },
    cooperation: { roundId: 'round-a', status: ++reads > 3 ? 'FAILED' : 'WORKING', revision: reads > 3 ? 3 : 2 } });
  api.runtimeSessionRead = () => { outputReads++; return new Promise(() => {}); };
  const result = await workspaceMessage('/repo', 'task-a', 'wait', '42', api, { revision: 2, timeoutMs: 30, pollMs: 5 });
  assert.equal(result.status, 'FAILED');
  assert.equal(result.pending, false);
  assert.equal(outputReads, 1);
  api.readWorkspaceTask = async () => ({ status: 'RUNNING', sessions: { antigravity: { sessionId: 'peer-a' } }, cooperation: { roundId: 'round-a', status: 'WORKING', revision: 2 } });
  const started = Date.now();
  assert.equal((await workspaceMessage('/repo', 'task-a', 'wait', '42', api, { revision: 2, timeoutMs: 15, pollMs: 5 })).pending, true);
  assert.ok(Date.now() - started < 500);
});
