import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

import { createMcpServer } from '../mcp/server.mjs';
import {
  runtimeTaskGraphCreate,
  runtimeTaskGraphPlan,
} from '../bin/coordinate-agents.mjs';
import {
  readTaskGraph,
  setTaskGraphSubtaskState,
} from '../skills/coordinate-agents/scripts/task-graph-runtime.mjs';

function repository(prefix = 'coordinate-agents-intent-scheduler-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', root], { stdio: 'ignore', windowsHide: true });
  return root;
}

function graph(parentTaskId = 'task-intent-scheduler') {
  return {
    schemaVersion: 1,
    parentTask: {
      id: parentTaskId,
      title: 'Schedule conflict-aware work',
      planner: 'codex',
      reviewer: 'codex',
    },
    subtasks: [
      { id: 'alpha', implementer: 'antigravity', spec: 'Implement alpha.' },
      { id: 'beta', implementer: 'antigravity', spec: 'Implement beta.' },
      { id: 'gamma', implementer: 'antigravity', spec: 'Implement gamma.' },
      { id: 'omega', implementer: 'antigravity', spec: 'Implement omega.', dependsOn: ['alpha'] },
    ],
    maxConcurrency: 2,
  };
}

function intentMap(parentTaskId = 'task-intent-scheduler') {
  return {
    schemaVersion: 1,
    parentTaskId,
    scopePolicy: 'warn',
    subtasks: [
      { id: 'alpha', writeIntent: ['src/shared/**'] },
      { id: 'beta', writeIntent: ['src/shared/file.js'] },
      { id: 'gamma', writeIntent: ['docs/**'] },
      { id: 'omega', writeIntent: ['config/**'] },
    ],
  };
}

test('plan exposes deterministic conflict-aware wave facts without changing dependency edges', async () => {
  const root = repository();
  try {
    await runtimeTaskGraphCreate({ root, graph: graph(), intentMap: intentMap() });
    const before = readTaskGraph(root, 'task-intent-scheduler');
    const first = await runtimeTaskGraphPlan({ root, taskId: 'task-intent-scheduler' });
    const second = await runtimeTaskGraphPlan({ root, taskId: 'task-intent-scheduler' });
    const concurrent = await Promise.all(Array.from({ length: 4 }, () => (
      runtimeTaskGraphPlan({ root, taskId: 'task-intent-scheduler' })
    )));

    assert.deepEqual(first.plan, second.plan);
    assert.equal(concurrent.every(item => JSON.stringify(item.plan) === JSON.stringify(first.plan)), true);
    assert.deepEqual(first.plan.eligible.map(item => item.subtaskId), ['alpha', 'gamma']);
    assert.deepEqual(first.plan.conflictDeferred.map(item => item.subtaskId), ['beta']);
    assert.deepEqual(first.plan.capacityLimited, []);
    assert.deepEqual(first.plan.wave.selected, ['alpha', 'gamma']);
    assert.deepEqual(first.plan.wave.conflictDeferred, ['beta']);
    assert.equal(first.plan.conflicts[0].code, 'WRITE_INTENT_CONFLICT');
    assert.deepEqual(first.plan.conflicts[0].subtasks, ['alpha', 'beta']);
    assert.deepEqual(first.plan.conflicts[0].patterns, [
      { subtaskId: 'alpha', pattern: 'src/shared/**' },
      { subtaskId: 'beta', pattern: 'src/shared/file.js' },
    ]);
    assert.match(first.plan.conflictDeferred[0].reason, /deferred from this wave/);
    assert.match(first.plan.eligible[0].reason, /no selected write-intent conflict/);
    assert.equal(first.plan.preflight.scopePolicy, 'warn');
    assert.equal(first.plan.preflight.concurrentWriteSafety, 'DECLARED_NON_CONFLICTING');
    assert.equal(first.plan.preflight.estimates.worktreeCount, 2);
    assert.deepEqual(first.plan.preflight.risks.map(item => item.code), ['WRITE_INTENT_CONFLICT']);
    assert.deepEqual(first.plan.preflight.risks[0].affectedSubtasks, ['beta']);
    assert.deepEqual(
      readTaskGraph(root, 'task-intent-scheduler').subtasks.map(item => item.dependsOn),
      before.subtasks.map(item => item.dependsOn),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing Intent Map preserves v2.3 eligibility and visibly reports unavailable conflict coverage', async () => {
  const root = repository('coordinate-agents-intent-legacy-scheduler-');
  try {
    await runtimeTaskGraphCreate({ root, graph: graph('task-legacy') });
    const plan = await runtimeTaskGraphPlan({ root, taskId: 'task-legacy' });
    assert.deepEqual(plan.plan.eligible.map(item => item.subtaskId), ['alpha', 'beta']);
    assert.deepEqual(plan.plan.capacityLimited.map(item => item.subtaskId), ['gamma']);
    assert.deepEqual(plan.plan.conflictDeferred, []);
    assert.deepEqual(plan.plan.conflicts, []);
    assert.equal(plan.plan.wave.intentCoverageAvailable, false);
    assert.equal(plan.plan.intentCoverage.available, false);
    assert.equal(plan.plan.eligible[0].reason, 'Eligible: no dependencies and a concurrency slot is available.');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('graph lock rejects a conflicting READY claim without sibling or dependency mutation', async () => {
  const root = repository('coordinate-agents-intent-lock-');
  try {
    await runtimeTaskGraphCreate({
      root,
      graph: graph('task-intent-lock'),
      intentMap: intentMap('task-intent-lock'),
    });
    setTaskGraphSubtaskState(root, 'task-intent-lock', 'alpha', 'RUNNING', {
      expectedState: 'READY',
      requireAvailableSlot: true,
      requireIntentCompatible: true,
    });
    assert.throws(
      () => setTaskGraphSubtaskState(root, 'task-intent-lock', 'beta', 'RUNNING', {
        expectedState: 'READY',
        requireAvailableSlot: true,
        requireIntentCompatible: true,
      }),
      error => error.code === 'TASK_STATE_CONFLICT'
        && error.stage === 'graph-scheduling'
        && error.details.conflict.code === 'WRITE_INTENT_CONFLICT',
    );
    const stored = readTaskGraph(root, 'task-intent-lock');
    assert.equal(stored.subtasks.find(item => item.id === 'alpha').state, 'RUNNING');
    assert.equal(stored.subtasks.find(item => item.id === 'beta').state, 'READY');
    assert.deepEqual(stored.subtasks.find(item => item.id === 'omega').dependsOn, ['alpha']);
    assert.equal(stored.subtasks.find(item => item.id === 'gamma').state, 'READY');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI and MCP plan expose equivalent additive conflict and wave facts', async () => {
  const root = repository('coordinate-agents-intent-parity-');
  try {
    await runtimeTaskGraphCreate({
      root,
      graph: graph('task-intent-parity'),
      intentMap: intentMap('task-intent-parity'),
    });
    const cli = spawnSync(process.execPath, [
      join(process.cwd(), 'bin', 'coordinate-agents.mjs'), 'task', 'graph-plan',
      '--root', root, '--id', 'task-intent-parity', '--json',
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(cli.status, 0, cli.stderr || cli.stdout);
    const cliPlan = JSON.parse(cli.stdout).plan;

    const server = createMcpServer();
    const mcp = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: {
        name: 'coordinate_agents_task_graph_plan',
        arguments: { root, taskId: 'task-intent-parity' },
      },
    });
    assert.equal(mcp.result.isError, false);
    const mcpPlan = mcp.result.structuredContent.plan;
    assert.deepEqual(mcpPlan.wave, cliPlan.wave);
    assert.deepEqual(mcpPlan.conflicts, cliPlan.conflicts);
    assert.deepEqual(mcpPlan.eligible.map(item => item.subtaskId), cliPlan.eligible.map(item => item.subtaskId));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
