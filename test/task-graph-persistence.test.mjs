import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

import { createMcpServer } from '../mcp/server.mjs';
import {
  runtimeTaskGraphCreate,
  runtimeTaskGraphInspect,
  runtimeTaskGraphStatus,
  runtimeTaskOperation,
} from '../bin/coordinate-agents.mjs';
import {
  readTaskGraph,
  setTaskGraphSubtaskState,
  taskGraphPath,
} from '../skills/coordinate-agents/scripts/task-graph-runtime.mjs';
import { readRuntimeEvents } from '../skills/coordinate-agents/scripts/runtime-events.mjs';

function repository(prefix = 'coordinate-agents-graph-persistence-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  execFileSync('git', ['init', root], { stdio: 'ignore', windowsHide: true });
  return root;
}

function graph(overrides = {}) {
  return {
    schemaVersion: 1,
    parentTask: {
      id: 'task-graph-persistence',
      title: 'Persist a dependency graph',
      planner: 'codex',
      reviewer: 'codex',
    },
    subtasks: [
      { id: 'backend', implementer: 'antigravity', spec: 'Implement the backend.' },
      { id: 'frontend', implementer: 'codex', spec: 'Implement the frontend.', dependsOn: ['backend'] },
      { id: 'docs', implementer: 'codex', spec: 'Document the result.', dependsOn: ['backend'] },
    ],
    maxConcurrency: 2,
    ...overrides,
  };
}

test('Task Graph create persists parent, subtasks, deterministic frontier, and lifecycle event without Adapter launch', async () => {
  const root = repository();
  try {
    const result = await runtimeTaskGraphCreate({ root, graph: graph() });
    assert.equal(result.ok, true);
    assert.equal(result.command, 'task.graph-create');
    assert.equal(result.validation.sideEffects, true);
    assert.equal(result.graph.state, 'CREATED');
    assert.deepEqual(result.frontier.ready, ['backend']);
    assert.deepEqual(result.frontier.waiting, ['docs', 'frontend']);
    assert.deepEqual(result.frontier.blocked, []);
    assert.deepEqual(result.graph.subtasks.map(subtask => ({
      id: subtask.id,
      parentTaskId: subtask.parentTaskId,
      implementer: subtask.implementer,
      dependsOn: subtask.dependsOn,
      state: subtask.state,
    })), [
      { id: 'backend', parentTaskId: 'task-graph-persistence', implementer: 'antigravity', dependsOn: [], state: 'READY' },
      { id: 'docs', parentTaskId: 'task-graph-persistence', implementer: 'codex', dependsOn: ['backend'], state: 'WAITING' },
      { id: 'frontend', parentTaskId: 'task-graph-persistence', implementer: 'codex', dependsOn: ['backend'], state: 'WAITING' },
    ]);
    assert.equal(existsSync(taskGraphPath(root, 'task-graph-persistence')), true);
    const events = readRuntimeEvents(root, { taskId: 'task-graph-persistence', limit: 20 });
    assert.deepEqual(events.map(event => event.type), ['TASK_GRAPH_CREATED']);
    assert.deepEqual(events[0].data.subtaskIds, ['backend', 'docs', 'frontend']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Task Graph status and inspect use the same durable record through Runtime, CLI, and MCP', async () => {
  const root = repository('coordinate-agents-graph-views-');
  const inputPath = join(root, 'graph.json');
  try {
    const input = graph({ parentTask: { ...graph().parentTask, id: 'task-graph-views' } });
    writeFileSync(inputPath, `${JSON.stringify(input)}\n`, 'utf8');
    const cli = spawnSync(process.execPath, [
      join(process.cwd(), 'bin', 'coordinate-agents.mjs'), 'task', 'graph-create',
      '--root', root, '--input', inputPath, '--json',
    ], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PATH: '' } });
    assert.equal(cli.status, 0, cli.stderr || cli.stdout);
    const cliStatus = spawnSync(process.execPath, [
      join(process.cwd(), 'bin', 'coordinate-agents.mjs'), 'task', 'status',
      '--root', root, '--id', 'task-graph-views', '--json',
    ], { encoding: 'utf8', windowsHide: true });
    assert.equal(cliStatus.status, 0, cliStatus.stderr || cliStatus.stdout);
    const status = JSON.parse(cliStatus.stdout);
    assert.equal(status.command, 'task.status');
    assert.equal(status.graph.parentTask.id, 'task-graph-views');
    assert.deepEqual(status.frontier.ready, ['backend']);

    const inspected = await runtimeTaskOperation('inspect', { root, taskId: 'task-graph-views' });
    assert.equal(inspected.ok, true);
    assert.equal(inspected.task.graph, true);
    assert.deepEqual(inspected.events.map(event => event.type), ['TASK_GRAPH_CREATED']);

    const server = createMcpServer();
    const mcp = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'coordinate_agents_task_graph_create', arguments: { root, graph: { ...input, parentTask: { ...input.parentTask, id: 'task-graph-mcp' } } } },
    });
    assert.equal(mcp.result.isError, false);
    assert.equal(mcp.result.structuredContent.graph.parentTaskId, 'task-graph-mcp');
    const mcpStatus = await server.handle({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'coordinate_agents_task_status', arguments: { root, taskId: 'task-graph-mcp' } },
    });
    assert.equal(mcpStatus.result.isError, false);
    assert.equal(mcpStatus.result.structuredContent.graph.parentTaskId, 'task-graph-mcp');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Task Graph transitions persist bounded reasons/evidence, unlock dependents, block failures, and remain idempotent', async () => {
  const root = repository('coordinate-agents-graph-transition-');
  try {
    await runtimeTaskGraphCreate({ root, graph: graph({ parentTask: { ...graph().parentTask, id: 'task-graph-transition' } }) });
    const running = setTaskGraphSubtaskState(root, 'task-graph-transition', 'backend', 'RUNNING');
    assert.equal(running.changed, true);
    assert.equal(running.graph.subtasks.find(item => item.id === 'frontend').state, 'WAITING');
    const succeeded = setTaskGraphSubtaskState(root, 'task-graph-transition', 'backend', 'SUCCEEDED', {
      evidence: [{ commit: 'abc1234', tests: 'PASS' }],
    });
    assert.equal(succeeded.graph.subtasks.find(item => item.id === 'frontend').state, 'READY');
    assert.equal(succeeded.graph.subtasks.find(item => item.id === 'docs').state, 'READY');
    const failed = setTaskGraphSubtaskState(root, 'task-graph-transition', 'frontend', 'FAILED', {
      reason: 'fixture failure',
    });
    assert.equal(failed.graph.state, 'ERROR');
    assert.deepEqual(failed.graph.frontier.blocked, []);
    const repeat = setTaskGraphSubtaskState(root, 'task-graph-transition', 'frontend', 'FAILED', { reason: 'fixture failure' });
    assert.equal(repeat.changed, false);
    const stored = readTaskGraph(root, 'task-graph-transition');
    assert.equal(stored.subtasks.find(item => item.id === 'frontend').reason, 'fixture failure');
    assert.equal(stored.subtasks.find(item => item.id === 'frontend').evidence.length, 0);
    const events = readRuntimeEvents(root, { taskId: 'task-graph-transition', limit: 20 });
    assert.equal(events.filter(event => event.type === 'TASK_GRAPH_SUBTASK_STATE_CHANGED').length, 5);
    assert.deepEqual(readRuntimeEvents(root, { taskId: 'task-graph-transition', subtaskId: 'backend', limit: 20 }).map(event => event.subtaskId), ['backend', 'backend', 'backend']);
    const inspected = await runtimeTaskGraphInspect({ root, taskId: 'task-graph-transition' });
    assert.ok(inspected.events.some(event => event.type === 'TASK_GRAPH_STATUS_CHANGED'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Task Graph malformed and duplicate creation leave no partial graph or extra events', async () => {
  const root = repository('coordinate-agents-graph-atomic-');
  try {
    const malformed = await runtimeTaskGraphCreate({ root, graph: graph({ subtasks: [
      { id: 'one', implementer: 'codex', spec: 'one' },
      { id: 'one', implementer: 'codex', spec: 'duplicate' },
    ] }) }).catch(error => error);
    assert.equal(malformed.code, 'TASK_GRAPH_INVALID');
    assert.equal(existsSync(join(root, '.agent-bus')), false);

    const first = await runtimeTaskGraphCreate({ root, graph: graph() });
    const before = readFileSync(taskGraphPath(root, first.graph.parentTaskId), 'utf8');
    const duplicate = await runtimeTaskGraphCreate({ root, graph: graph() }).catch(error => error);
    assert.equal(duplicate.code, 'TASK_STATE_CONFLICT');
    assert.equal(readFileSync(taskGraphPath(root, first.graph.parentTaskId), 'utf8'), before);
    assert.equal(readRuntimeEvents(root, { taskId: first.graph.parentTaskId, limit: 20 }).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
