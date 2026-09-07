import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceMessage } from '../skills/coordinate-agents/scripts/workspace-message.mjs';

function fixture({ taskId = 'task-a', status = 'RUNNING' } = {}) {
  const writes = [];
  return { writes, api: {
    readWorkspaceTask: async () => ({ status, sessions: { antigravity: { sessionId: 'peer-a' } } }),
    runtimeSessionRead: async input => ({ session: { taskId, agent: 'antigravity' }, nextCursor: 42, output: 'hello', ...input }),
    runtimeSessionWrite: async input => { writes.push(input); },
  } };
}
test('send binds to this pair, captures cursor before input, and writes Enter separately', async () => {
  const { writes, api } = fixture();
  const result = await workspaceMessage('/repo', 'task-a', 'send', 'hello', api);
  assert.equal(result.cursor, 42);
  assert.deepEqual(writes.map(x => [x.sessionId, x.input, x.submit]), [['peer-a', 'hello', false], ['peer-a', '\r', false]]);
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
