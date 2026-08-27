import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  taskGraphDurableFacts,
  validateTaskGraphV1,
} from '../skills/coordinate-agents/scripts/task-graph-contract.mjs';
import { runtimeTaskGraphValidate } from '../bin/coordinate-agents.mjs';
import { createMcpServer } from '../mcp/server.mjs';

const cli = fileURLToPath(new URL('../bin/coordinate-agents.mjs', import.meta.url));

function graph(overrides = {}) {
  return {
    schemaVersion: 1,
    parentTask: {
      id: 'task-graph-contract',
      title: 'Build a dependency graph',
      planner: 'codex',
      reviewer: 'codex',
    },
    subtasks: [
      { id: 'backend', implementer: 'agent-a', spec: 'Implement the backend.', dependsOn: [] },
      { id: 'frontend', implementer: 'agent-b', spec: 'Implement the frontend.', dependsOn: ['backend'] },
    ],
    maxConcurrency: 2,
    ...overrides,
  };
}

function invalid(input, match) {
  assert.throws(
    () => validateTaskGraphV1(input, { configuredAgents: ['codex', 'agent-a', 'agent-b'] }),
    error => error.code === 'TASK_GRAPH_INVALID'
      && error.recoverable === false
      && error.stage === 'graph-validation'
      && match.test(error.message),
  );
}

function temporaryGitRepository(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const initialized = spawnSync('git', ['init', root], { encoding: 'utf8', windowsHide: true });
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  return root;
}

test('Task Graph v1 normalizes explicit identity, dependency, concurrency, and initial state facts', () => {
  const validated = validateTaskGraphV1(graph(), { configuredAgents: ['codex', 'agent-b', 'agent-a'] });
  assert.equal(validated.schemaVersion, 1);
  assert.equal(validated.kind, 'task-graph');
  assert.equal(validated.parentTaskId, 'task-graph-contract');
  assert.equal(validated.state, 'CREATED');
  assert.equal(validated.parentTask.id, 'task-graph-contract');
  assert.equal(validated.maxConcurrency, 2);
  assert.deepEqual(validated.subtasks.map(subtask => ({
    id: subtask.id,
    parentTaskId: subtask.parentTaskId,
    implementer: subtask.implementer,
    dependsOn: subtask.dependsOn,
  })), [
    { id: 'backend', parentTaskId: 'task-graph-contract', implementer: 'agent-a', dependsOn: [] },
    { id: 'frontend', parentTaskId: 'task-graph-contract', implementer: 'agent-b', dependsOn: ['backend'] },
  ]);
  assert.deepEqual(taskGraphDurableFacts(validated), {
    parent: {
      kind: 'parent-task',
      taskId: 'task-graph-contract',
      planner: 'codex',
      reviewer: 'codex',
      state: 'CREATED',
      status: 'CREATED',
      maxConcurrency: 2,
    },
    subtasks: [
      { kind: 'subtask', parentTaskId: 'task-graph-contract', subtaskId: 'backend', implementer: 'agent-a', state: 'PENDING', status: 'PENDING', dependsOn: [] },
      { kind: 'subtask', parentTaskId: 'task-graph-contract', subtaskId: 'frontend', implementer: 'agent-b', state: 'PENDING', status: 'PENDING', dependsOn: ['backend'] },
    ],
  });
});

test('Task Graph v1 preserves optional parent Task fields and immutable dependency facts', () => {
  const validated = validateTaskGraphV1(graph({
    parentTask: {
      ...graph().parentTask,
      spec: 'The approved parent specification.',
      implementer: 'agent-a',
    },
    subtasks: [
      { id: 'worker', title: 'Worker slice', implementer: 'agent-b', spec: 'Implement the worker slice.', dependsOn: ['root'] },
      { id: 'root', implementer: 'agent-a', spec: 'Implement the root slice.' },
    ],
  }), { configuredAgents: ['codex', 'agent-a', 'agent-b'] });
  assert.equal(validated.parentTask.spec, 'The approved parent specification.');
  assert.equal(validated.parentTask.implementer, 'agent-a');
  assert.equal(validated.subtasks[1].title, 'Worker slice');
  assert.equal(Object.isFrozen(validated.subtasks[1].dependsOn), true);
  assert.throws(() => validated.subtasks[1].dependsOn.push('root'), TypeError);
  assert.equal(taskGraphDurableFacts(validated).parent.implementer, 'agent-a');
});

test('Task Graph v1 does not trim or reinterpret Agent and subtask identities', () => {
  invalid(graph({ parentTask: { ...graph().parentTask, planner: ' codex' } }), /Agent identity .* malformed/);
  invalid(graph({ subtasks: [{ id: 'con', implementer: 'agent-a', spec: 'one' }] }), /malformed id/);
  invalid(graph({ subtasks: [{ id: 'worker', implementer: ' agent-a', spec: 'one' }] }), /Agent identity .* malformed/);
});

test('Task Graph v1 rejects every malformed DAG class with one stable bounded Runtime error', () => {
  invalid(graph({ subtasks: [
    { id: 'same', implementer: 'agent-a', spec: 'one' },
    { id: 'same', implementer: 'agent-b', spec: 'two' },
  ] }), /duplicate subtask id "same"/);
  invalid(graph({ subtasks: [{ id: 'Bad.ID', implementer: 'agent-a', spec: 'one' }] }), /malformed id/);
  invalid(graph({ subtasks: [{ id: 'self', implementer: 'agent-a', spec: 'one', dependsOn: ['self'] }] }), /cannot depend on itself/);
  invalid(graph({ subtasks: [{ id: 'missing', implementer: 'agent-a', spec: 'one', dependsOn: ['absent'] }] }), /missing dependency "absent"/);
  invalid(graph({ subtasks: [
    { id: 'alpha', implementer: 'agent-a', spec: 'one', dependsOn: ['beta'] },
    { id: 'beta', implementer: 'agent-b', spec: 'two', dependsOn: ['alpha'] },
  ] }), /alpha -> beta -> alpha/);
  invalid(graph({ subtasks: [{ id: 'unknown', implementer: 'agent-z', spec: 'one' }] }), /unknown or unconfigured/);
  invalid(graph({ parentTask: { ...graph().parentTask, planner: 'agent-z' } }), /parent planner .*unknown or unconfigured/);
  invalid(graph({ subtasks: [{ id: 'bad-agent', implementer: 'Bad.Agent', spec: 'one' }] }), /identity .* malformed/);
  invalid(graph({ subtasks: [{ id: 'empty', implementer: 'agent-a', spec: '  ' }] }), /must be a non-empty string/);
  invalid(graph({ maxConcurrency: 0 }), /maxConcurrency must be an integer from 1 to 32/);
  invalid(graph({ maxConcurrency: 33 }), /maxConcurrency must be an integer from 1 to 32/);
  invalid({ ...graph(), unexpected: true }, /unknown field "unexpected"/);
});

test('canonical Runtime and CLI validate graphs without creating Bus, worktree, Session, or process facts', async () => {
  const root = temporaryGitRepository('coordinate-agents-graph-contract-');
  const inputPath = join(root, 'graph.json');
  try {
    const valid = graph({
      subtasks: [{ id: 'implementation', implementer: 'antigravity', spec: 'Implement the approved specification.' }],
      maxConcurrency: 1,
    });
    const runtime = await runtimeTaskGraphValidate({ root, graph: valid });
    assert.equal(runtime.ok, true);
    assert.equal(runtime.command, 'task.graph-validate');
    assert.equal(runtime.validation.sideEffects, false);
    assert.equal(runtime.facts.parent.taskId, 'task-graph-contract');
    assert.equal(runtime.facts.subtasks[0].subtaskId, 'implementation');
    assert.equal(existsSync(join(root, '.agent-bus')), false);

    const malformed = graph({ subtasks: [
      { id: 'cycle-a', implementer: 'antigravity', spec: 'a', dependsOn: ['cycle-b'] },
      { id: 'cycle-b', implementer: 'antigravity', spec: 'b', dependsOn: ['cycle-a'] },
    ] });
    writeFileSync(inputPath, `${JSON.stringify(malformed)}\n`, 'utf8');
    const fakeBin = join(root, 'fake-bin');
    const gitSpawnMarker = join(root, 'git-spawned.txt');
    mkdirSync(fakeBin);
    if (process.platform === 'win32') {
      writeFileSync(join(fakeBin, 'git.cmd'), `@echo spawned>"${gitSpawnMarker}"\r\n@echo ${root}\r\n@exit /b 0\r\n`, 'utf8');
    } else {
      const fakeGit = join(fakeBin, 'git');
      writeFileSync(fakeGit, `#!/bin/sh\nprintf spawned > '${gitSpawnMarker}'\nprintf '%s\\n' '${root}'\n`, 'utf8');
      chmodSync(fakeGit, 0o755);
    }
    const result = spawnSync(process.execPath, [cli, 'task', 'graph-validate', '--root', root, '--input', inputPath, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: fakeBin },
      windowsHide: true,
    });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, 'task.graph-validate');
    assert.equal(payload.error.code, 'TASK_GRAPH_INVALID');
    assert.equal(payload.error.stage, 'graph-validation');
    assert.equal(existsSync(gitSpawnMarker), false, 'invalid graph must be rejected before Git or another child process is spawned');
    assert.equal(existsSync(join(root, '.agent-bus')), false);
    for (const path of [
      join(root, '.agent-bus', 'worktrees'),
      join(root, '.agent-bus', 'sessions'),
      join(root, '.agent-bus', 'inbox'),
    ]) assert.equal(existsSync(path), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('MCP exposes the same Task Graph v1 validation result and bounded error contract', async () => {
  const root = temporaryGitRepository('coordinate-agents-graph-mcp-');
  try {
    const server = createMcpServer();
    const valid = graph({
      subtasks: [{ id: 'implementation', implementer: 'antigravity', spec: 'Implement it.' }],
      maxConcurrency: 1,
    });
    const accepted = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'coordinate_agents_task_graph_validate', arguments: { root, graph: valid } },
    });
    assert.equal(accepted.result.isError, false);
    assert.equal(accepted.result.structuredContent.command, 'task.graph-validate');
    assert.equal(accepted.result.structuredContent.facts.subtasks[0].parentTaskId, 'task-graph-contract');

    const rejected = await server.handle({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: {
        name: 'coordinate_agents_task_graph_validate',
        arguments: { root, graph: graph({ subtasks: [{ id: 'broken', implementer: 'missing-agent', spec: 'x' }] }) },
      },
    });
    assert.equal(rejected.result.isError, true);
    assert.equal(rejected.result.structuredContent.error.code, 'TASK_GRAPH_INVALID');
    assert.ok(rejected.result.structuredContent.error.message.length <= 2048);
    assert.equal(existsSync(join(root, '.agent-bus')), false);

    const malformedShape = await server.handle({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'coordinate_agents_task_graph_validate', arguments: { root, graph: null } },
    });
    assert.equal(malformedShape.result.isError, true);
    assert.equal(malformedShape.result.structuredContent.error.code, 'TASK_GRAPH_INVALID');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
