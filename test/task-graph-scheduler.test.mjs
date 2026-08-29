import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
  taskGraphPath,
} from '../skills/coordinate-agents/scripts/task-graph-runtime.mjs';
import { readRuntimeEvents } from '../skills/coordinate-agents/scripts/runtime-events.mjs';

const cli = join(process.cwd(), 'bin', 'coordinate-agents.mjs');

function repository(prefix = 'coordinate-agents-graph-plan-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', root], { stdio: 'ignore', windowsHide: true });
  return root;
}

function schedulerGraph(parentTaskId = 'task-gd-scheduler') {
  return {
    schemaVersion: 1,
    parentTask: {
      id: parentTaskId,
      title: 'Plan deterministic graph scheduling',
      planner: 'codex',
      reviewer: 'codex',
    },
    subtasks: [
      { id: 'alpha', implementer: 'codex', spec: 'Implement alpha.' },
      { id: 'beta', implementer: 'antigravity', spec: 'Implement beta.' },
      { id: 'gamma', implementer: 'codex', spec: 'Implement gamma.' },
      { id: 'after-alpha', implementer: 'antigravity', spec: 'Use alpha.', dependsOn: ['alpha'] },
      { id: 'after-beta', implementer: 'codex', spec: 'Use beta.', dependsOn: ['beta'] },
    ],
    maxConcurrency: 2,
  };
}

function fileSnapshot(root, current = root) {
  const snapshot = {};
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const relative = path.slice(root.length + 1).replaceAll('\\', '/');
    if (entry.isDirectory()) Object.assign(snapshot, fileSnapshot(root, path));
    else if (entry.isFile()) snapshot[relative] = readFileSync(path).toString('base64');
  }
  return snapshot;
}

async function withIsolatedHome(home, callback) {
  const previous = process.env.COORDINATE_AGENTS_HOME;
  process.env.COORDINATE_AGENTS_HOME = home;
  try { return await callback(); } finally {
    if (previous === undefined) delete process.env.COORDINATE_AGENTS_HOME;
    else process.env.COORDINATE_AGENTS_HOME = previous;
  }
}

test('Task Graph plan is deterministic, capacity-bounded, Agent-explicit, and read-only', async () => {
  const root = repository();
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-graph-plan-home-'));
  try {
    await withIsolatedHome(home, async () => {
      await runtimeTaskGraphCreate({ root, graph: schedulerGraph() });
      const before = fileSnapshot(join(root, '.agent-bus'));
      const first = await runtimeTaskGraphPlan({ root, taskId: 'task-gd-scheduler' });
      const second = await runtimeTaskGraphPlan({ root, taskId: 'task-gd-scheduler' });

      assert.deepEqual(second, first);
      assert.equal(first.command, 'task.graph-plan');
      assert.equal(first.plan.deterministic, true);
      assert.equal(first.plan.sideEffects, false);
      assert.equal(first.plan.maxConcurrency, 2);
      assert.equal(first.plan.runningCount, 0);
      assert.equal(first.plan.availableSlots, 2);
      assert.deepEqual(first.plan.eligible.map(item => item.subtaskId), ['alpha', 'beta']);
      assert.deepEqual(first.plan.capacityLimited.map(item => item.subtaskId), ['gamma']);
      assert.deepEqual(first.plan.decisions.map(item => item.subtaskId), [
        'after-alpha', 'after-beta', 'alpha', 'beta', 'gamma',
      ]);
      assert.match(first.plan.decisions[0].reason, /^Waiting/);
      assert.match(first.plan.capacityLimited[0].reason, /^Capacity-limited:/);

      const alpha = first.plan.decisions.find(item => item.subtaskId === 'alpha');
      const beta = first.plan.decisions.find(item => item.subtaskId === 'beta');
      assert.deepEqual({ id: alpha.agent.id, adapter: alpha.agent.adapter, command: alpha.agent.command, source: alpha.agent.commandSource }, {
        id: 'codex', adapter: 'codex-cli', command: 'codex', source: 'adapter-default',
      });
      assert.deepEqual({ id: beta.agent.id, adapter: beta.agent.adapter, command: beta.agent.command, source: beta.agent.commandSource }, {
        id: 'antigravity', adapter: 'antigravity-cli', command: 'agy', source: 'adapter-default',
      });
      assert.deepEqual(fileSnapshot(join(root, '.agent-bus')), before);
      assert.equal(existsSync(join(root, '.agent-bus', 'worktrees')), false);
      assert.equal(existsSync(join(root, '.agent-bus', 'sessions')), false);
      assert.deepEqual(readRuntimeEvents(root, { taskId: 'task-gd-scheduler', limit: 20 }).map(event => event.type), ['TASK_GRAPH_CREATED']);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('Task Graph plan explains running, failed dependency, blocked, and remaining capacity decisions', async () => {
  const root = repository('coordinate-agents-graph-plan-states-');
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-graph-plan-home-'));
  try {
    await withIsolatedHome(home, async () => {
      await runtimeTaskGraphCreate({ root, graph: schedulerGraph('task-gd-plan-states') });
      setTaskGraphSubtaskState(root, 'task-gd-plan-states', 'alpha', 'RUNNING');
      setTaskGraphSubtaskState(root, 'task-gd-plan-states', 'beta', 'FAILED', { reason: 'fixture conflict' });
      const plan = await runtimeTaskGraphPlan({ root, taskId: 'task-gd-plan-states' });
      const decisions = Object.fromEntries(plan.plan.decisions.map(item => [item.subtaskId, item]));

      assert.equal(plan.plan.runningCount, 1);
      assert.equal(plan.plan.availableSlots, 1);
      assert.deepEqual(plan.plan.eligible.map(item => item.subtaskId), ['gamma']);
      assert.equal(decisions.alpha.decision, 'RUNNING');
      assert.match(decisions.alpha.reason, /^Running:/);
      assert.equal(decisions.beta.decision, 'FAILED');
      assert.equal(decisions.beta.reason, 'fixture conflict');
      assert.equal(decisions['after-alpha'].decision, 'WAITING');
      assert.deepEqual(decisions['after-alpha'].dependencies, [{ id: 'alpha', state: 'RUNNING' }]);
      assert.equal(decisions['after-beta'].decision, 'BLOCKED');
      assert.match(decisions['after-beta'].reason, /beta \(FAILED\)/);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('CLI and MCP expose the same no-process graph plan and reject unsupported scheduling input', async () => {
  const root = repository('coordinate-agents-graph-plan-transport-');
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-graph-plan-home-'));
  try {
    await withIsolatedHome(home, async () => {
      await runtimeTaskGraphCreate({ root, graph: schedulerGraph('task-gd-plan-transport') });
      const cliResult = spawnSync(process.execPath, [
        cli, 'task', 'graph-plan', '--root', root, '--id', 'task-gd-plan-transport', '--json',
      ], {
        encoding: 'utf8',
        windowsHide: true,
        env: { ...process.env, COORDINATE_AGENTS_HOME: home, PATH: '' },
      });
      assert.equal(cliResult.status, 0, cliResult.stderr || cliResult.stdout);
      const cliPlan = JSON.parse(cliResult.stdout);
      assert.deepEqual(cliPlan.plan.eligible.map(item => item.subtaskId), ['alpha', 'beta']);

      const server = createMcpServer();
      const mcp = await server.handle({
        jsonrpc: '2.0', id: 1, method: 'tools/call',
        params: {
          name: 'coordinate_agents_task_graph_plan',
          arguments: { root, taskId: 'task-gd-plan-transport' },
        },
      });
      assert.equal(mcp.result.isError, false);
      assert.deepEqual(mcp.result.structuredContent.plan, cliPlan.plan);

      const rejected = await server.handle({
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: {
          name: 'coordinate_agents_task_graph_plan',
          arguments: { root, taskId: 'task-gd-plan-transport', maxConcurrency: 99 },
        },
      });
      assert.equal(rejected.error.code, -32602);
      assert.match(rejected.error.message, /maxConcurrency|unknown|additional/i);
      assert.equal(readTaskGraph(root, 'task-gd-plan-transport').frontier.maxConcurrency, 2);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('Task Graph plan rejects contradictory persisted scheduling facts without repairing or executing them', async () => {
  const root = repository('coordinate-agents-graph-plan-conflict-');
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-graph-plan-home-'));
  try {
    await withIsolatedHome(home, async () => {
      await runtimeTaskGraphCreate({ root, graph: schedulerGraph('task-gd-plan-conflict') });
      const path = taskGraphPath(root, 'task-gd-plan-conflict');
      const record = JSON.parse(readFileSync(path, 'utf8'));
      record.frontier.maxConcurrency = 3;
      writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
      const before = fileSnapshot(join(root, '.agent-bus'));

      const error = await runtimeTaskGraphPlan({ root, taskId: 'task-gd-plan-conflict' }).catch(value => value);
      assert.equal(error.code, 'TASK_STATE_CONFLICT');
      assert.equal(error.stage, 'graph-scheduling');
      assert.match(error.message, /contradictory persisted scheduling facts/);
      assert.deepEqual(fileSnapshot(join(root, '.agent-bus')), before);
      assert.equal(existsSync(join(root, '.agent-bus', 'worktrees')), false);
      assert.equal(existsSync(join(root, '.agent-bus', 'sessions')), false);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
