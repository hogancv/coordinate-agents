import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { createMcpServer } from '../mcp/server.mjs';
import {
  runtimeTaskGraphCleanup,
  runtimeTaskGraphCreate,
  runtimeTaskGraphRecover,
  runtimeTaskGraphResume,
  runtimeTaskGraphStatus,
  runtimeTaskGraphStop,
} from '../bin/coordinate-agents.mjs';
import {
  captureGraphBaseCommit,
  cleanupTaskGraphWorktree,
  ensureSubtaskWorktree,
  ensureSubtaskWorktreeBus,
  readTaskGraph,
  taskGraphBranchRef,
  taskGraphPath,
  taskGraphWorktreePath,
  setTaskGraphSubtaskState,
} from '../skills/coordinate-agents/scripts/task-graph-runtime.mjs';
import { readRuntimeEvents } from '../skills/coordinate-agents/scripts/runtime-events.mjs';

function repository(prefix = 'coordinate-agents-graph-recovery-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', root], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Coordinate Test'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root, stdio: 'ignore', windowsHide: true });
  writeFileSync(join(root, 'README.md'), '# Recovery fixture\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['commit', '-m', 'Initial recovery fixture'], { cwd: root, stdio: 'ignore', windowsHide: true });
  return root;
}

function graph(parentTaskId) {
  return {
    schemaVersion: 1,
    parentTask: {
      id: parentTaskId,
      title: 'Recover a parallel graph safely',
      planner: 'codex',
      reviewer: 'codex',
    },
    subtasks: [
      { id: 'backend', implementer: 'antigravity', spec: 'Implement the backend.' },
      { id: 'frontend', implementer: 'codex', spec: 'Implement the frontend.', dependsOn: ['backend'] },
    ],
    maxConcurrency: 2,
  };
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
}

async function removeRepository(root) {
  // A test that creates a worktree must unregister it before removing the
  // temporary repository; this also keeps the shared Git metadata healthy.
  try { execFileSync('git', ['worktree', 'prune'], { cwd: root, stdio: 'ignore', windowsHide: true }); } catch { /* best effort */ }
  rmSync(root, { recursive: true, force: true });
}

test('graph recovery reports durable interruption facts, blocks dependents, and requires explicit resume', async () => {
  const root = repository('coordinate-agents-graph-interrupted-');
  const parentTaskId = 'task-graph-interrupted';
  try {
    await runtimeTaskGraphCreate({ root, graph: graph(parentTaskId) });
    const baseCommit = captureGraphBaseCommit(root);
    // A product-looking file is deliberately not completion evidence.
    writeFileSync(join(root, 'completed.txt'), 'prose is not proof\n', 'utf8');
    setTaskGraphSubtaskState(root, parentTaskId, 'backend', 'RUNNING', {
      baseCommit,
      reason: 'Coordinator interrupted after claiming the subtask.',
    });

    const status = await runtimeTaskGraphStatus({ root, taskId: parentTaskId });
    const statusRecovery = status.recovery.find(item => item.subtaskId === 'backend');
    assert.equal(statusRecovery.classification, 'interrupted');
    assert.equal(statusRecovery.recoverable, true);
    assert.equal(statusRecovery.completionEvidence, false);
    assert.equal(statusRecovery.worktree.exists, false);
    assert.equal(statusRecovery.worktree.ownershipKnown, false);

    const recovered = await runtimeTaskGraphRecover({ root, taskId: parentTaskId });
    const outcome = recovered.outcomes.find(item => item.subtaskId === 'backend');
    assert.equal(outcome.state, 'FAILED');
    assert.equal(outcome.changed, true);
    assert.equal(outcome.error.root, resolve(root));
    assert.equal(outcome.error.taskId, parentTaskId);
    assert.equal(outcome.error.subtaskId, 'backend');
    assert.equal(outcome.error.agent, 'antigravity');
    const failedGraph = readTaskGraph(root, parentTaskId);
    assert.equal(failedGraph.subtasks.find(item => item.id === 'backend').state, 'FAILED');
    assert.equal(failedGraph.subtasks.find(item => item.id === 'frontend').state, 'BLOCKED');
    assert.equal(failedGraph.subtasks.find(item => item.id === 'backend').lastError.root, resolve(root));
    assert.equal(existsSync(join(root, 'completed.txt')), true);

    const eventCount = readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length;
    const repeated = await runtimeTaskGraphRecover({ root, taskId: parentTaskId });
    assert.equal(repeated.outcomes.find(item => item.subtaskId === 'backend').changed, false);
    assert.equal(readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length, eventCount);

    const resumed = await runtimeTaskGraphResume({ root, taskId: parentTaskId, subtaskId: 'backend' });
    assert.equal(resumed.dispatchRequired, true);
    assert.equal(resumed.automaticRetry, false);
    assert.equal(resumed.outcomes[0].action, 'ready-for-explicit-dispatch');
    const resumedGraph = readTaskGraph(root, parentTaskId);
    assert.equal(resumedGraph.subtasks.find(item => item.id === 'backend').state, 'READY');
    assert.equal(resumedGraph.subtasks.find(item => item.id === 'frontend').state, 'WAITING');

    const resumeEventCount = readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length;
    const repeatedResume = await runtimeTaskGraphResume({ root, taskId: parentTaskId, subtaskId: 'backend' });
    assert.equal(repeatedResume.outcomes[0].action, 'none');
    assert.equal(repeatedResume.outcomes[0].error.taskId, parentTaskId);
    assert.equal(readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length, resumeEventCount);
  } finally {
    await removeRepository(root);
  }
});

test('recovery promotes a durable commit/evidence pair even after the worktree is gone', async () => {
  const root = repository('coordinate-agents-graph-durable-completion-');
  const parentTaskId = 'task-graph-durable-completion';
  try {
    await runtimeTaskGraphCreate({ root, graph: graph(parentTaskId) });
    const baseCommit = captureGraphBaseCommit(root);
    writeFileSync(join(root, 'durable-product.txt'), 'committed before coordinator interruption\n', 'utf8');
    execFileSync('git', ['add', 'durable-product.txt'], { cwd: root, stdio: 'ignore', windowsHide: true });
    execFileSync('git', ['commit', '-m', 'Durable implementation fixture'], { cwd: root, stdio: 'ignore', windowsHide: true });
    const implementationCommit = git(root, ['rev-parse', 'HEAD']);
    setTaskGraphSubtaskState(root, parentTaskId, 'backend', 'RUNNING', {
      baseCommit,
      sessionId: 'session_gone_after_interruption',
      implementationCommit,
      evidence: [{ type: 'IMPLEMENTATION_DONE', relatedCommit: implementationCommit, details: 'durable evidence' }],
      reason: 'Coordinator interrupted after durable completion was recorded.',
    });

    const recovered = await runtimeTaskGraphRecover({ root, taskId: parentTaskId, subtaskId: 'backend' });
    assert.equal(recovered.outcomes[0].state, 'SUCCEEDED');
    assert.equal(recovered.outcomes[0].classification, 'completed');
    assert.equal(recovered.outcomes[0].implementationCommit, implementationCommit);
    const recoveredGraph = readTaskGraph(root, parentTaskId);
    assert.equal(recoveredGraph.subtasks.find(item => item.id === 'backend').state, 'SUCCEEDED');
    assert.equal(recoveredGraph.subtasks.find(item => item.id === 'frontend').state, 'READY');
    const cleaned = await runtimeTaskGraphCleanup({ root, taskId: parentTaskId, subtaskId: 'backend' });
    assert.equal(cleaned.outcomes[0].status, 'CLEANED');
  } finally {
    await removeRepository(root);
  }
});

test('explicit resume reuses a verified healthy Session and does not relaunch or duplicate state', async () => {
  const root = repository('coordinate-agents-graph-healthy-');
  const parentTaskId = 'task-graph-healthy';
  const subtaskId = 'backend';
  let worktreePath = null;
  try {
    await runtimeTaskGraphCreate({ root, graph: graph(parentTaskId) });
    const baseCommit = captureGraphBaseCommit(root);
    const worktree = ensureSubtaskWorktree(root, parentTaskId, subtaskId, baseCommit);
    worktreePath = worktree.worktreePath;
    ensureSubtaskWorktreeBus(root, worktreePath);
    const sessionId = 'session_graphhealthy';
    const sessionPath = join(worktreePath, '.agent-bus', 'sessions', `${sessionId}.json`);
    writeFileSync(sessionPath, `${JSON.stringify({
      schemaVersion: 1,
      id: sessionId,
      agent: 'antigravity',
      command: 'fixture-agent',
      resolvedCommand: 'fixture-agent',
      cwd: worktreePath,
      pid: null,
      state: 'running',
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      exitCode: null,
      signal: null,
      error: null,
      endpoint: 'fixture-endpoint',
      hostPid: process.pid,
      taskId: parentTaskId,
      subtaskId,
    }, null, 2)}\n`, 'utf8');
    setTaskGraphSubtaskState(root, parentTaskId, subtaskId, 'RUNNING', {
      baseCommit,
      worktreePath,
      branch: worktree.branch,
      ref: worktree.ref,
      sessionId,
    });

    const beforeEvents = readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length;
    const resumed = await runtimeTaskGraphResume({ root, taskId: parentTaskId, subtaskId });
    assert.equal(resumed.outcomes[0].action, 'reused-healthy-session');
    assert.equal(resumed.outcomes[0].changed, false);
    assert.equal(resumed.outcomes[0].session.id, sessionId);
    assert.equal(resumed.graph.subtasks.find(item => item.id === subtaskId).state, 'RUNNING');
    assert.equal(readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length, beforeEvents);

    const status = await runtimeTaskGraphStatus({ root, taskId: parentTaskId });
    const recovery = status.recovery.find(item => item.subtaskId === subtaskId);
    assert.equal(recovery.classification, 'running');
    assert.equal(recovery.sessionHealthy, true);
    assert.equal(recovery.sessionOwned, true);
  } finally {
    try { rmSync(join(worktreePath || '', '.agent-bus', 'sessions', 'session_graphhealthy.json'), { force: true }); } catch { /* best effort */ }
    if (worktreePath) {
      try { cleanupTaskGraphWorktree(root, parentTaskId, subtaskId); } catch { /* best effort */ }
    }
    await removeRepository(root);
  }
});

test('stop and cleanup preserve successful commits, refs, evidence, and user worktree while remaining idempotent', async () => {
  const root = repository('coordinate-agents-graph-stop-');
  const parentTaskId = 'task-graph-stop';
  const subtaskId = 'backend';
  let worktreePath = null;
  try {
    await runtimeTaskGraphCreate({ root, graph: graph(parentTaskId) });
    const baseCommit = captureGraphBaseCommit(root);
    const worktree = ensureSubtaskWorktree(root, parentTaskId, subtaskId, baseCommit);
    worktreePath = worktree.worktreePath;
    writeFileSync(join(root, 'user-uncommitted.txt'), 'preserve me\n', 'utf8');
    writeFileSync(join(worktreePath, 'product.txt'), 'successful product\n', 'utf8');
    execFileSync('git', ['add', 'product.txt'], { cwd: worktreePath, stdio: 'ignore', windowsHide: true });
    execFileSync('git', ['commit', '-m', 'Successful graph subtask'], { cwd: worktreePath, stdio: 'ignore', windowsHide: true });
    const implementationCommit = git(worktreePath, ['rev-parse', 'HEAD']);
    setTaskGraphSubtaskState(root, parentTaskId, subtaskId, 'SUCCEEDED', {
      baseCommit,
      worktreePath,
      branch: worktree.branch,
      ref: worktree.ref,
      implementationCommit,
      evidence: [{ type: 'IMPLEMENTATION_DONE', relatedCommit: implementationCommit, details: 'verified fixture commit' }],
    });

    const stopped = await runtimeTaskGraphStop({ root, taskId: parentTaskId });
    assert.equal(stopped.graph.state, 'STOPPED');
    assert.equal(stopped.outcomes[0].cleanup.status, 'CLEANED');
    assert.equal(stopped.cleanup.find(item => item.subtaskId === subtaskId).status, 'CLEANED');
    assert.equal(existsSync(worktreePath), false);
    assert.equal(git(root, ['rev-parse', taskGraphBranchRef(parentTaskId, subtaskId)]), implementationCommit);
    assert.equal(readFileSync(join(root, 'user-uncommitted.txt'), 'utf8'), 'preserve me\n');
    const stored = readTaskGraph(root, parentTaskId);
    const storedSubtask = stored.subtasks.find(item => item.id === subtaskId);
    assert.equal(storedSubtask.implementationCommit, implementationCommit);
    assert.equal(storedSubtask.evidence[0].relatedCommit, implementationCommit);
    assert.equal(storedSubtask.cleanup.status, 'CLEANED');

    const eventCount = readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length;
    const repeated = await runtimeTaskGraphStop({ root, taskId: parentTaskId });
    assert.equal(repeated.graph.state, 'STOPPED');
    assert.equal(repeated.outcomes[0].cleanup.idempotent, true);
    assert.equal(readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length, eventCount);
  } finally {
    if (worktreePath && existsSync(worktreePath)) {
      try { cleanupTaskGraphWorktree(root, parentTaskId, subtaskId); } catch { /* best effort */ }
    }
    await removeRepository(root);
  }
});

test('scoped stop leaves unrelated running subtasks and the graph lifecycle intact', async () => {
  const root = repository('coordinate-agents-graph-scoped-stop-');
  const parentTaskId = 'task-graph-scoped-stop';
  try {
    await runtimeTaskGraphCreate({
      root,
      graph: {
        schemaVersion: 1,
        parentTask: { id: parentTaskId, title: 'Scoped stop fixture', planner: 'codex', reviewer: 'codex' },
        subtasks: [
          { id: 'api', implementer: 'antigravity', spec: 'API fixture.' },
          { id: 'web', implementer: 'codex', spec: 'Web fixture.' },
        ],
        maxConcurrency: 2,
      },
    });
    const baseCommit = captureGraphBaseCommit(root);
    setTaskGraphSubtaskState(root, parentTaskId, 'web', 'RUNNING', { baseCommit, reason: 'web is still executing' });
    const stopped = await runtimeTaskGraphStop({ root, taskId: parentTaskId, subtaskId: 'api' });
    assert.equal(stopped.graph.state, 'RUNNING');
    assert.equal(stopped.graph.subtasks.find(item => item.id === 'api').state, 'STOPPED');
    assert.equal(stopped.graph.subtasks.find(item => item.id === 'web').state, 'RUNNING');
    assert.equal(stopped.outcomes[0].state, 'STOPPED');
    const eventCount = readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length;
    const repeated = await runtimeTaskGraphStop({ root, taskId: parentTaskId, subtaskId: 'api' });
    assert.equal(repeated.graph.state, 'RUNNING');
    assert.equal(repeated.outcomes[0].cleanup.idempotent, true);
    assert.equal(readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length, eventCount);
  } finally {
    await removeRepository(root);
  }
});

test('cleanup remains idempotent after closing a persisted terminal Session and removing its worktree', async () => {
  const root = repository('coordinate-agents-graph-cleaned-session-');
  const parentTaskId = 'task-graph-cleaned-session';
  const subtaskId = 'backend';
  let worktreePath = null;
  try {
    await runtimeTaskGraphCreate({ root, graph: graph(parentTaskId) });
    const baseCommit = captureGraphBaseCommit(root);
    const worktree = ensureSubtaskWorktree(root, parentTaskId, subtaskId, baseCommit);
    worktreePath = worktree.worktreePath;
    ensureSubtaskWorktreeBus(root, worktreePath);
    const sessionId = 'session_graphclosed';
    writeFileSync(join(worktreePath, '.agent-bus', 'sessions', `${sessionId}.json`), `${JSON.stringify({
      schemaVersion: 1,
      id: sessionId,
      agent: 'antigravity',
      command: 'fixture-agent',
      resolvedCommand: 'fixture-agent',
      cwd: worktreePath,
      pid: null,
      state: 'exited',
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      exitCode: 0,
      signal: null,
      error: null,
      endpoint: 'fixture-endpoint',
      hostPid: null,
      taskId: parentTaskId,
      subtaskId,
    }, null, 2)}\n`, 'utf8');
    setTaskGraphSubtaskState(root, parentTaskId, subtaskId, 'STOPPED', {
      baseCommit,
      worktreePath,
      branch: worktree.branch,
      ref: worktree.ref,
      sessionId,
    });

    const first = await runtimeTaskGraphStop({ root, taskId: parentTaskId });
    assert.equal(first.outcomes[0].cleanup.status, 'CLEANED');
    assert.equal(first.outcomes[0].cleanup.idempotent, false);
    assert.equal(existsSync(worktreePath), false);
    const eventCount = readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length;

    const repeated = await runtimeTaskGraphStop({ root, taskId: parentTaskId });
    assert.equal(repeated.outcomes[0].cleanup.status, 'CLEANED');
    assert.equal(repeated.outcomes[0].cleanup.idempotent, true);
    assert.equal(readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length, eventCount);
  } finally {
    if (worktreePath && existsSync(worktreePath)) {
      try { cleanupTaskGraphWorktree(root, parentTaskId, subtaskId); } catch { /* best effort */ }
    }
    await removeRepository(root);
  }
});

test('cleanup refuses an unowned worktree, records the bounded error, and is idempotent', async () => {
  const root = repository('coordinate-agents-graph-unowned-');
  const parentTaskId = 'task-graph-unowned';
  const subtaskId = 'backend';
  try {
    await runtimeTaskGraphCreate({ root, graph: graph(parentTaskId) });
    const unowned = taskGraphWorktreePath(root, parentTaskId, subtaskId);
    mkdirSync(unowned, { recursive: true });
    writeFileSync(join(unowned, 'user-sentinel.txt'), 'never delete\n', 'utf8');
    ensureSubtaskWorktreeBus(root, unowned);
    const sessionId = 'session_unowned';
    writeFileSync(join(unowned, '.agent-bus', 'sessions', `${sessionId}.json`), `${JSON.stringify({
      schemaVersion: 1,
      id: sessionId,
      agent: 'antigravity',
      command: 'fixture-agent',
      resolvedCommand: 'fixture-agent',
      cwd: unowned,
      pid: null,
      state: 'running',
      createdAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      exitCode: null,
      signal: null,
      error: null,
      endpoint: 'fixture-endpoint',
      hostPid: process.pid,
      taskId: parentTaskId,
      subtaskId,
    }, null, 2)}\n`, 'utf8');
    setTaskGraphSubtaskState(root, parentTaskId, subtaskId, 'FAILED', {
      reason: 'fixture failure',
      worktreePath: unowned,
      branch: 'refs/heads/user-owned-branch',
      ref: 'refs/heads/user-owned-branch',
      sessionId,
    });

    const cleaned = await runtimeTaskGraphCleanup({ root, taskId: parentTaskId, subtaskId });
    assert.equal(cleaned.outcomes[0].status, 'FAILED');
    assert.equal(cleaned.outcomes[0].error.root, resolve(root));
    assert.equal(cleaned.outcomes[0].error.taskId, parentTaskId);
    assert.equal(cleaned.outcomes[0].error.subtaskId, subtaskId);
    assert.equal(existsSync(join(unowned, 'user-sentinel.txt')), true);
    const stored = readTaskGraph(root, parentTaskId);
    assert.equal(stored.subtasks.find(item => item.id === subtaskId).cleanup.status, 'FAILED');

    const eventCount = readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length;
    const repeated = await runtimeTaskGraphCleanup({ root, taskId: parentTaskId, subtaskId });
    assert.equal(repeated.outcomes[0].status, 'FAILED');
    assert.equal(repeated.outcomes[0].idempotent, true);
    assert.equal(readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length, eventCount);
  } finally {
    await removeRepository(root);
  }
});

test('cleanup refuses a stale recorded path even when the canonical worktree is already absent', async () => {
  const root = repository('coordinate-agents-graph-stale-record-');
  const parentTaskId = 'task-graph-stale-record';
  const subtaskId = 'backend';
  try {
    await runtimeTaskGraphCreate({ root, graph: graph(parentTaskId) });
    const outside = join(tmpdir(), `coordinate-agents-user-path-${Date.now()}`);
    setTaskGraphSubtaskState(root, parentTaskId, subtaskId, 'FAILED', {
      worktreePath: outside,
      branch: 'refs/heads/user-owned-branch',
      ref: 'refs/heads/user-owned-branch',
      reason: 'stale path fixture',
    });
    const cleaned = await runtimeTaskGraphCleanup({ root, taskId: parentTaskId, subtaskId });
    assert.equal(cleaned.outcomes[0].status, 'FAILED');
    assert.equal(cleaned.outcomes[0].error.subtaskId, subtaskId);
    assert.equal(existsSync(outside), false);
  } finally {
    await removeRepository(root);
  }
});

test('recovery/stop/cleanup commands expose the same durable graph record through MCP', async () => {
  const root = repository('coordinate-agents-graph-mcp-recovery-');
  const parentTaskId = 'task-graph-mcp-recovery';
  try {
    await runtimeTaskGraphCreate({ root, graph: graph(parentTaskId) });
    const statusPath = taskGraphPath(root, parentTaskId);
    assert.equal(existsSync(statusPath), true);
    const server = createMcpServer();
    const status = await server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'coordinate_agents_task_status', arguments: { root, taskId: parentTaskId } },
    });
    assert.equal(status.result.isError, false);
    assert.equal(status.result.structuredContent.graph.parentTaskId, parentTaskId);
    const recover = await server.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'coordinate_agents_task_graph_recover', arguments: { root, taskId: parentTaskId } },
    });
    assert.equal(recover.result.isError, false);
    assert.equal(recover.result.structuredContent.command, 'task.graph-recover');
    const stop = await server.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'coordinate_agents_task_graph_stop', arguments: { root, taskId: parentTaskId } },
    });
    assert.equal(stop.result.isError, false);
    assert.equal(stop.result.structuredContent.command, 'task.graph-stop');
    assert.equal(stop.result.structuredContent.graph.state, 'STOPPED');
    const cleanup = await server.handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'coordinate_agents_task_graph_cleanup', arguments: { root, taskId: parentTaskId } },
    });
    assert.equal(cleanup.result.isError, false);
    assert.equal(cleanup.result.structuredContent.command, 'task.graph-cleanup');
  } finally {
    await removeRepository(root);
  }
});
