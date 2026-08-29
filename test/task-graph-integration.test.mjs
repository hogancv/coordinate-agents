import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { createMcpServer } from '../mcp/server.mjs';
import {
  runtimeTaskGraphCleanup,
  runtimeTaskGraphCreate,
  runtimeTaskGraphIntegrate,
} from '../bin/coordinate-agents.mjs';
import {
  captureGraphBaseCommit,
  ensureSubtaskWorktree,
  readTaskGraph,
  setTaskGraphSubtaskState,
  taskGraphBranchRef,
  taskGraphIntegrationBranchRef,
  taskGraphIntegrationWorktreePath,
} from '../skills/coordinate-agents/scripts/task-graph-runtime.mjs';

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

function repository(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', root], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Coordinate Test'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root, stdio: 'ignore', windowsHide: true });
  writeFileSync(join(root, 'README.md'), '# Integration fixture\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['commit', '-m', 'Initial integration fixture'], { cwd: root, stdio: 'ignore', windowsHide: true });
  return root;
}

function graph(parentTaskId, subtasks = [
  { id: 'alpha', implementer: 'antigravity', spec: 'Implement alpha.' },
  { id: 'zeta', implementer: 'antigravity', spec: 'Implement zeta.' },
]) {
  return {
    schemaVersion: 1,
    parentTask: {
      id: parentTaskId,
      title: 'Integrate completed subtasks',
      planner: 'codex',
      reviewer: 'codex',
    },
    subtasks: subtasks.map(item => ({
      id: item.id,
      implementer: item.implementer,
      spec: item.spec,
      ...(item.title === undefined ? {} : { title: item.title }),
      ...(item.dependsOn === undefined ? {} : { dependsOn: item.dependsOn }),
    })),
    maxConcurrency: 2,
  };
}

function seedSubtask(root, parentTaskId, subtaskId, baseCommit, relativeFile, contents) {
  const info = ensureSubtaskWorktree(root, parentTaskId, subtaskId, baseCommit);
  writeFileSync(join(info.worktreePath, relativeFile), contents, 'utf8');
  execFileSync('git', ['add', relativeFile], { cwd: info.worktreePath, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['commit', '-m', 'Implement ' + subtaskId], { cwd: info.worktreePath, stdio: 'ignore', windowsHide: true });
  const commit = git(info.worktreePath, ['rev-parse', 'HEAD']);
  setTaskGraphSubtaskState(root, parentTaskId, subtaskId, 'SUCCEEDED', {
    expectedState: 'READY',
    baseCommit,
    worktreePath: info.worktreePath,
    branch: info.branch,
    ref: info.ref,
    implementationCommit: commit,
    evidence: [{
      type: 'IMPLEMENTATION_DONE',
      relatedCommit: commit,
      source: 'isolated fixture',
    }],
  });
  return { ...info, commit };
}

async function seedGraph(root, parentTaskId, subtaskDefinitions, { only = null } = {}) {
  await runtimeTaskGraphCreate({ root, graph: graph(parentTaskId, subtaskDefinitions) });
  const baseCommit = captureGraphBaseCommit(root);
  const seeded = [];
  for (const item of subtaskDefinitions) {
    if (only && !only.includes(item.id)) continue;
    seeded.push(seedSubtask(
      root,
      parentTaskId,
      item.id,
      baseCommit,
      item.file || (item.id + '.txt'),
      item.contents || (item.id + '\n'),
    ));
  }
  return { baseCommit, seeded };
}

test('Task Graph integration verifies sources, uses a separate deterministic aggregate worktree, and routes review without touching checkout', async () => {
  const root = repository('coordinate-graph-integration-happy-');
  const parentTaskId = 'task-integration-happy';
  try {
    const definitions = [
      { id: 'zeta', implementer: 'antigravity', spec: 'Implement zeta.', file: 'zeta.txt', contents: 'zeta\n' },
      { id: 'alpha', implementer: 'antigravity', spec: 'Implement alpha.', file: 'alpha.txt', contents: 'alpha\n' },
    ];
    const { baseCommit, seeded } = await seedGraph(root, parentTaskId, definitions);
    writeFileSync(join(root, 'user-uncommitted.txt'), 'must remain in checkout\n', 'utf8');
    const beforeStatus = git(root, ['status', '--porcelain']);
    const beforeHead = git(root, ['rev-parse', 'HEAD']);

    const integrated = await runtimeTaskGraphIntegrate({ root, taskId: parentTaskId });
    assert.equal(integrated.ok, true);
    assert.equal(integrated.command, 'task.graph-integrate');
    assert.equal(integrated.integration.state, 'SUCCEEDED');
    assert.equal(integrated.integration.baseCommit, baseCommit.toLowerCase());
    assert.deepEqual(integrated.integration.appliedSubtasks, ['alpha', 'zeta']);
    assert.deepEqual(integrated.integration.sourceRefs.map(item => item.subtaskId), ['alpha', 'zeta']);
    assert.ok(integrated.integration.aggregateCommit);
    assert.notEqual(integrated.integration.aggregateCommit, baseCommit.toLowerCase());
    assert.equal(integrated.integration.worktree.branch, 'coordinate-agents/' + parentTaskId + '/__integration__');
    assert.equal(integrated.integration.worktree.ref, taskGraphIntegrationBranchRef(parentTaskId));
    assert.ok(integrated.integration.worktree.path.endsWith(join(parentTaskId, '__integration__')));
    assert.notEqual(integrated.integration.worktree.path, seeded[0].worktreePath);
    assert.deepEqual(integrated.integration.diff.files, ['alpha.txt', 'zeta.txt']);
    assert.equal(git(root, ['rev-parse', taskGraphIntegrationBranchRef(parentTaskId)]), integrated.integration.aggregateCommit);
    assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
    assert.equal(git(root, ['status', '--porcelain']), beforeStatus);
    assert.equal(readFileSync(join(root, 'user-uncommitted.txt'), 'utf8'), 'must remain in checkout\n');
    for (const item of seeded) {
      assert.equal(git(root, ['rev-parse', taskGraphBranchRef(parentTaskId, item.branch.split('/').at(-1))]), item.commit);
    }

    const second = await runtimeTaskGraphIntegrate({ root, taskId: parentTaskId });
    assert.equal(second.ok, true);
    assert.equal(second.idempotent, true);
    assert.equal(second.integration.aggregateCommit, integrated.integration.aggregateCommit);

    const server = createMcpServer({ root });
    const listed = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
    const toolNames = listed.result.tools.map(tool => tool.name);
    assert.ok(toolNames.includes('coordinate_agents_task_graph_integrate'));
    assert.ok(toolNames.includes('coordinate_agents_task_graph_review'));
    const dirtyFile = join(integrated.integration.worktree.path, 'unreviewed-change.txt');
    writeFileSync(dirtyFile, 'must not be included in approval\n', 'utf8');
    const dirtyReview = await server.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'coordinate_agents_task_graph_review',
        arguments: { root, taskId: parentTaskId, decision: 'REVIEW_APPROVED' },
      },
    });
    assert.equal(dirtyReview.result.isError, true);
    assert.equal(dirtyReview.result.structuredContent.error.code, 'WORKTREE_CONFLICT');
    unlinkSync(dirtyFile);
    const reviewed = await server.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'coordinate_agents_task_graph_review',
        arguments: {
          root,
          taskId: parentTaskId,
          decision: 'REVIEW_APPROVED',
          evidence: { checks: ['aggregate diff inspected'] },
        },
      },
    });
    assert.equal(reviewed.result.isError, false);
    assert.equal(reviewed.result.structuredContent.command, 'task.graph-review');
    assert.equal(reviewed.result.structuredContent.review.decision, 'REVIEW_APPROVED');
    assert.equal(reviewed.result.structuredContent.graph.state, 'APPROVED');
    assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
    assert.equal(git(root, ['status', '--porcelain']), beforeStatus);

    const cleaned = await runtimeTaskGraphCleanup({ root, taskId: parentTaskId });
    assert.equal(cleaned.ok, true);
    assert.equal(cleaned.integrationCleanup.status, 'CLEANED');
    assert.equal(existsSync(taskGraphIntegrationWorktreePath(root, parentTaskId)), false);
    assert.equal(git(root, ['rev-parse', taskGraphIntegrationBranchRef(parentTaskId)]), integrated.integration.aggregateCommit);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Task Graph integration refuses unresolved subtasks before creating aggregate state', async () => {
  const root = repository('coordinate-graph-integration-gate-');
  const parentTaskId = 'task-integration-gate';
  try {
    await seedGraph(root, parentTaskId, [
      { id: 'alpha', implementer: 'antigravity', spec: 'Implement alpha.' },
      { id: 'zeta', implementer: 'antigravity', spec: 'Implement zeta.' },
    ], { only: ['alpha'] });
    await assert.rejects(
      runtimeTaskGraphIntegrate({ root, taskId: parentTaskId }),
      error => error.code === 'TASK_STATE_CONFLICT'
        && error.stage === 'graph-integration'
        && error.details.unresolved.some(item => item.id === 'zeta'),
    );
    const stored = readTaskGraph(root, parentTaskId);
    assert.equal(stored.integration, null);
    assert.equal(existsSync(taskGraphIntegrationWorktreePath(root, parentTaskId)), false);
    assert.equal(git(root, ['status', '--porcelain']), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Task Graph review refuses an aggregate after the verified source commit changes', async () => {
  const root = repository('coordinate-graph-integration-stale-review-');
  const parentTaskId = 'task-stale-review';
  try {
    const { seeded } = await seedGraph(root, parentTaskId, [
      { id: 'alpha', implementer: 'antigravity', spec: 'Implement alpha.' },
    ]);
    const beforeHead = git(root, ['rev-parse', 'HEAD']);
    const integrated = await runtimeTaskGraphIntegrate({ root, taskId: parentTaskId });
    writeFileSync(join(seeded[0].worktreePath, 'alpha-followup.txt'), 'follow-up\n', 'utf8');
    execFileSync('git', ['add', 'alpha-followup.txt'], { cwd: seeded[0].worktreePath, stdio: 'ignore', windowsHide: true });
    execFileSync('git', ['commit', '-m', 'Follow up alpha'], { cwd: seeded[0].worktreePath, stdio: 'ignore', windowsHide: true });
    const changedCommit = git(seeded[0].worktreePath, ['rev-parse', 'HEAD']);
    setTaskGraphSubtaskState(root, parentTaskId, 'alpha', 'SUCCEEDED', {
      expectedState: 'SUCCEEDED',
      implementationCommit: changedCommit,
      evidence: [{ type: 'IMPLEMENTATION_DONE', relatedCommit: changedCommit }],
    });

    const server = createMcpServer({ root });
    const reviewed = await server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'coordinate_agents_task_graph_review',
        arguments: { root, taskId: parentTaskId, decision: 'REVIEW_APPROVED' },
      },
    });
    assert.equal(reviewed.result.isError, true);
    assert.equal(reviewed.result.structuredContent.error.code, 'TASK_STATE_CONFLICT');
    assert.notEqual(
      reviewed.result.structuredContent.error.details.expectedSourceFingerprint,
      integrated.integration.sourceFingerprint,
    );
    assert.equal(readTaskGraph(root, parentTaskId).review, null);
    assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Task Graph integration preserves bounded conflict facts and source work when cherry-pick conflicts', async () => {
  const root = repository('coordinate-graph-integration-conflict-');
  const parentTaskId = 'task-conflict';
  try {
    const { baseCommit, seeded } = await seedGraph(root, parentTaskId, [
      { id: 'alpha', implementer: 'antigravity', spec: 'Implement alpha.', file: 'shared.txt', contents: 'alpha\n' },
      { id: 'beta', implementer: 'antigravity', spec: 'Implement beta.', file: 'shared.txt', contents: 'beta\n' },
    ]);
    const beforeHead = git(root, ['rev-parse', 'HEAD']);
    const failure = await runtimeTaskGraphIntegrate({ root, taskId: parentTaskId }).catch(error => error);
    assert.equal(failure.code, 'WORKTREE_CONFLICT');
    assert.equal(failure.stage, 'graph-integration');
    const stored = readTaskGraph(root, parentTaskId);
    assert.equal(stored.integration.state, 'FAILED');
    assert.equal(stored.integration.conflict.state, 'CONFLICTED');
    assert.equal(stored.integration.conflict.inProgress, true);
    assert.equal(stored.integration.conflict.subtaskId, 'beta');
    assert.deepEqual(stored.integration.appliedSubtasks, ['alpha']);
    assert.ok(stored.integration.worktreePath);
    assert.equal(existsSync(stored.integration.worktreePath), true);
    assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
    assert.equal(git(root, ['rev-parse', taskGraphIntegrationBranchRef(parentTaskId)]), stored.integration.aggregateCommit);
    assert.equal(git(root, ['rev-parse', taskGraphBranchRef(parentTaskId, 'alpha')]), seeded.find(item => item.branch.endsWith('/alpha')).commit);
    assert.equal(git(root, ['rev-parse', taskGraphBranchRef(parentTaskId, 'beta')]), seeded.find(item => item.branch.endsWith('/beta')).commit);
    assert.equal(stored.integration.baseCommit, baseCommit.toLowerCase());

    const inspected = readTaskGraph(root, parentTaskId);
    assert.equal(inspected.integration.conflict.files.includes('shared.txt'), true);
    const cleaned = await runtimeTaskGraphCleanup({ root, taskId: parentTaskId });
    assert.equal(cleaned.integrationCleanup.status, 'CLEANED');
    assert.equal(readTaskGraph(root, parentTaskId).integration.conflict.state, 'CONFLICTED');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
