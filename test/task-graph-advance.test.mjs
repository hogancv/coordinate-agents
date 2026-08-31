import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { createMcpServer } from '../mcp/server.mjs';
import {
  runtimeSetupConfigure,
  runtimeTaskGraphAdvance,
  runtimeTaskGraphCreate,
} from '../bin/coordinate-agents.mjs';
import { runtimeSessionClose } from '../skills/coordinate-agents/scripts/session-service.mjs';
import {
  readTaskGraph,
  setTaskGraphIntegration,
  setTaskGraphReview,
  setTaskGraphSubtaskState,
} from '../skills/coordinate-agents/scripts/task-graph-runtime.mjs';

const canonicalTmpdir = realpathSync(tmpdir());
const cli = resolve('bin/coordinate-agents.mjs');
const busTool = resolve('skills/coordinate-agents/scripts/agent-bus.mjs');

function repository(prefix = 'coordinate-agents-advance-') {
  const root = mkdtempSync(join(canonicalTmpdir, prefix));
  execFileSync('git', ['init', root], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Coordinate Test'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root, stdio: 'ignore', windowsHide: true });
  writeFileSync(join(root, 'README.md'), '# Advance fixture\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: root, stdio: 'ignore', windowsHide: true });
  return root;
}

function graph(parentTaskId, { parallel = false } = {}) {
  return {
    schemaVersion: 1,
    parentTask: { id: parentTaskId, title: 'Advance bounded waves', planner: 'codex', reviewer: 'codex' },
    subtasks: parallel
      ? [
        { id: 'alpha', implementer: 'antigravity', spec: 'Implement alpha.' },
        { id: 'beta', implementer: 'antigravity', spec: 'Implement beta.' },
      ]
      : [
        { id: 'alpha', implementer: 'antigravity', spec: 'Implement alpha.' },
        { id: 'beta', implementer: 'antigravity', spec: 'Implement beta.', dependsOn: ['alpha'] },
        { id: 'gamma', implementer: 'antigravity', spec: 'Implement gamma.', dependsOn: ['beta'] },
      ],
    maxConcurrency: parallel ? 2 : 1,
  };
}

function advanceImplementer(root) {
  const bin = join(root, 'advance fixture bin');
  mkdirSync(bin, { recursive: true });
  const source = `const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('advance-fixture 1.0.0'); process.exit(0); }
const prompt = args.join(' ');
const parentTaskId = (prompt.match(/Parent Task ID:\\s*(task-[A-Za-z0-9_-]+)/) || [])[1];
const subtaskId = (prompt.match(/Subtask ID:\\s*([a-z0-9_-]+)/) || [])[1];
if (!parentTaskId || !subtaskId) process.exit(10);
const delayMs = Number(process.env.ADVANCE_DELAY_MS || 0);
if (delayMs > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
const markerRoot = process.env.ADVANCE_MARKERS;
fs.mkdirSync(markerRoot, { recursive: true });
const marker = path.join(markerRoot, subtaskId + '.started');
try { fs.writeFileSync(marker, String(Date.now()), { encoding: 'utf8', flag: 'wx' }); }
catch { process.stderr.write('duplicate launch: ' + subtaskId); process.exit(11); }
if (process.env.ADVANCE_FAIL_SUBTASK === subtaskId) {
  process.stderr.write('fixture failure for ' + subtaskId);
  process.exit(17);
}
const product = 'advance-' + subtaskId + '.txt';
fs.writeFileSync(product, 'Implemented ' + subtaskId + '\\n', 'utf8');
cp.execFileSync('git', ['add', product], { stdio: 'ignore', windowsHide: true });
cp.execFileSync('git', ['commit', '-m', 'Implement ' + subtaskId], { stdio: 'ignore', windowsHide: true });
const commit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
const sent = cp.spawnSync(process.execPath, [
  ${JSON.stringify(busTool)}, 'send', '--root', process.cwd(),
  '--from', 'antigravity', '--to', 'codex', '--type', 'IMPLEMENTATION_DONE',
  '--subject', 'Completed ' + subtaskId,
  '--dedupe-key', 'task:' + parentTaskId + ':subtask:' + subtaskId + ':done',
  '--related-commit', commit,
  '--body', 'Parent Task ID: ' + parentTaskId + '\\nSubtask ID: ' + subtaskId + '\\nimplementationCommit: ' + commit + '\\nEvidence: advance fixture passed',
], { encoding: 'utf8', windowsHide: true });
if (sent.status !== 0) { process.stderr.write(sent.stderr || sent.stdout || 'Bus send failed'); process.exit(sent.status || 18); }
process.exit(0);
`;
  const script = join(bin, 'advance-agent.cjs');
  writeFileSync(script, source, 'utf8');
  if (process.platform === 'win32') {
    const command = join(bin, 'advance-agent.cmd');
    writeFileSync(command, `@"${process.execPath}" "${script}" %*\r\n`, 'utf8');
    return command;
  }
  const command = join(bin, 'advance-agent');
  writeFileSync(command, `#!${process.execPath}\n${source}`, 'utf8');
  chmodSync(command, 0o755);
  return command;
}

async function fixture(root, home, parentTaskId, options = {}) {
  const markers = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-advance-markers-'));
  process.env.COORDINATE_AGENTS_HOME = home;
  process.env.ADVANCE_MARKERS = markers;
  if (options.failSubtask) process.env.ADVANCE_FAIL_SUBTASK = options.failSubtask;
  else delete process.env.ADVANCE_FAIL_SUBTASK;
  await runtimeSetupConfigure({
    root,
    agent: 'antigravity',
    command: advanceImplementer(root),
    adapter: 'generic-cli',
    args: ['{prompt}'],
    role: 'implementer',
  });
  await runtimeTaskGraphCreate({ root, graph: graph(parentTaskId, options), intentMap: options.intentMap });
  return markers;
}

async function closeWaveSessions(waves = []) {
  for (const wave of waves) {
    for (const outcome of wave.outcomes) {
      const sessionId = outcome.session?.id || outcome.sessionId;
      const sessionRoot = outcome.worktree?.path || outcome.worktreePath;
      if (!sessionId || !sessionRoot) continue;
      try { await runtimeSessionClose({ root: sessionRoot, sessionId, graceful: false, timeoutMs: 1_000 }); } catch { /* Fixture cleanup only. */ }
    }
  }
}

function restoreEnvironment(previous) {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test('graph-advance executes only the authorized fresh waves and completed repeats are idempotent', async () => {
  const root = repository('coordinate-agents-advance-waves-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-advance-home-'));
  const previous = Object.fromEntries(['COORDINATE_AGENTS_HOME', 'ADVANCE_MARKERS', 'ADVANCE_FAIL_SUBTASK'].map(name => [name, process.env[name]]));
  let markers;
  const results = [];
  try {
    markers = await fixture(root, home, 'task-advance-waves');
    const dependencies = readTaskGraph(root, 'task-advance-waves').subtasks.map(item => item.dependsOn);
    const first = await runtimeTaskGraphAdvance({ root, taskId: 'task-advance-waves', maxWaves: 2, sessionWaitMs: 10_000 });
    results.push(first);
    assert.equal(first.command, 'task.graph-advance');
    assert.equal(first.wavesExecuted, 2);
    assert.deepEqual(first.waves.map(wave => wave.selected), [['alpha'], ['beta']]);
    assert.equal(first.stop.code, 'MAX_WAVES_REACHED');
    assert.deepEqual(first.frontier.ready, ['gamma']);
    assert.deepEqual(first.graph.subtasks.map(item => item.dependsOn), dependencies);

    const second = await runtimeTaskGraphAdvance({ root, taskId: 'task-advance-waves', maxWaves: 2, sessionWaitMs: 10_000 });
    results.push(second);
    assert.equal(second.wavesExecuted, 1);
    assert.deepEqual(second.waves[0].selected, ['gamma']);
    assert.equal(second.stop.code, 'COMPLETED');
    assert.equal(second.graph.integration, null);
    assert.equal(second.graph.review, null);
    assert.equal(second.boundaries.authorizesRelease, false);

    const repeated = await runtimeTaskGraphAdvance({ root, taskId: 'task-advance-waves', maxWaves: 2, sessionWaitMs: 10_000 });
    assert.equal(repeated.wavesExecuted, 0);
    assert.equal(repeated.stop.code, 'COMPLETED');
    assert.equal(['alpha', 'beta', 'gamma'].every(id => existsSync(join(markers, `${id}.started`))), true);
  } finally {
    for (const result of results) await closeWaveSessions(result.waves);
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (markers) rmSync(markers, { recursive: true, force: true });
    restoreEnvironment(previous);
  }
});

test('graph-advance stops before dispatch on intent conflict and never rewrites dependencies', async () => {
  const root = repository('coordinate-agents-advance-conflict-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-advance-home-'));
  const previous = Object.fromEntries(['COORDINATE_AGENTS_HOME', 'ADVANCE_MARKERS', 'ADVANCE_FAIL_SUBTASK'].map(name => [name, process.env[name]]));
  let markers;
  try {
    const parentTaskId = 'task-advance-conflict';
    markers = await fixture(root, home, parentTaskId, {
      parallel: true,
      intentMap: {
        schemaVersion: 1,
        parentTaskId,
        scopePolicy: 'warn',
        subtasks: [
          { id: 'alpha', writeIntent: ['src/shared/**'] },
          { id: 'beta', writeIntent: ['src/shared/file.js'] },
        ],
      },
    });
    const before = readTaskGraph(root, parentTaskId).subtasks.map(item => item.dependsOn);
    const result = await runtimeTaskGraphAdvance({ root, taskId: parentTaskId, maxWaves: 2, sessionWaitMs: 10_000 });
    assert.equal(result.wavesExecuted, 0);
    assert.equal(result.stop.code, 'WRITE_INTENT_CONFLICT');
    assert.deepEqual(result.stop.subtaskIds, ['beta']);
    assert.deepEqual(result.graph.subtasks.map(item => item.dependsOn), before);
    assert.equal(existsSync(join(root, '.agent-bus', 'worktrees')), false);
    assert.equal(existsSync(join(markers, 'alpha.started')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (markers) rmSync(markers, { recursive: true, force: true });
    restoreEnvironment(previous);
  }
});

test('graph-advance stops when strict scope policy rejects a completed wave', async () => {
  const root = repository('coordinate-agents-advance-scope-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-advance-home-'));
  const previous = Object.fromEntries(['COORDINATE_AGENTS_HOME', 'ADVANCE_MARKERS', 'ADVANCE_FAIL_SUBTASK'].map(name => [name, process.env[name]]));
  let markers;
  let result;
  try {
    const parentTaskId = 'task-advance-scope';
    markers = await fixture(root, home, parentTaskId, {
      parallel: true,
      intentMap: {
        schemaVersion: 1,
        parentTaskId,
        scopePolicy: 'strict',
        subtasks: [
          { id: 'alpha', writeIntent: ['allowed/alpha/**'] },
          { id: 'beta', writeIntent: ['allowed/beta/**'] },
        ],
      },
    });
    result = await runtimeTaskGraphAdvance({ root, taskId: parentTaskId, maxWaves: 3, sessionWaitMs: 10_000 });
    assert.equal(result.wavesExecuted, 1);
    assert.equal(result.stop.code, 'WAVE_FAILED');
    assert.equal(result.waves[0].outcomes.every(outcome => outcome.error?.code === 'INTENT_SCOPE_DRIFT'), true);
    assert.equal(result.graph.subtasks.every(item => item.state === 'FAILED' && item.scopeEvidence?.scopePolicy === 'strict'), true);
  } finally {
    await closeWaveSessions(result?.waves);
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (markers) rmSync(markers, { recursive: true, force: true });
    restoreEnvironment(previous);
  }
});

test('graph-advance stops on wave failure and does not retry failed work', async () => {
  const root = repository('coordinate-agents-advance-failure-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-advance-home-'));
  const previous = Object.fromEntries(['COORDINATE_AGENTS_HOME', 'ADVANCE_MARKERS', 'ADVANCE_FAIL_SUBTASK'].map(name => [name, process.env[name]]));
  let markers;
  let result;
  try {
    markers = await fixture(root, home, 'task-advance-failure', { parallel: true, failSubtask: 'beta' });
    result = await runtimeTaskGraphAdvance({ root, taskId: 'task-advance-failure', maxWaves: 3, sessionWaitMs: 10_000 });
    assert.equal(result.wavesExecuted, 1);
    assert.equal(result.stop.code, 'WAVE_FAILED');
    assert.deepEqual(result.stop.subtaskIds, ['beta']);
    const repeated = await runtimeTaskGraphAdvance({ root, taskId: 'task-advance-failure', maxWaves: 3, sessionWaitMs: 10_000 });
    assert.equal(repeated.wavesExecuted, 0);
    assert.equal(repeated.stop.code, 'SUBTASK_FAILED');
    assert.equal(readFileSync(join(markers, 'beta.started'), 'utf8').length > 0, true);
  } finally {
    await closeWaveSessions(result?.waves);
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (markers) rmSync(markers, { recursive: true, force: true });
    restoreEnvironment(previous);
  }
});

test('graph-advance validates bounds and CLI/MCP expose the same completed contract', async () => {
  const root = repository('coordinate-agents-advance-transport-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-advance-home-'));
  const previous = Object.fromEntries(['COORDINATE_AGENTS_HOME', 'ADVANCE_MARKERS', 'ADVANCE_FAIL_SUBTASK'].map(name => [name, process.env[name]]));
  try {
    process.env.COORDINATE_AGENTS_HOME = home;
    await runtimeTaskGraphCreate({ root, graph: graph('task-advance-transport', { parallel: true }) });
    setTaskGraphSubtaskState(root, 'task-advance-transport', 'alpha', 'SUCCEEDED', { evidence: [{ fixture: true }] });
    setTaskGraphSubtaskState(root, 'task-advance-transport', 'beta', 'SUCCEEDED', { evidence: [{ fixture: true }] });
    for (const maxWaves of [0, 33, 1.5, null]) {
      const error = await runtimeTaskGraphAdvance({ root, taskId: 'task-advance-transport', maxWaves }).catch(value => value);
      assert.equal(error.code, 'TASK_GRAPH_INVALID');
      assert.equal(error.stage, 'graph-advance');
    }

    const child = spawnSync(process.execPath, [
      cli, 'task', 'graph-advance', '--root', root, '--id', 'task-advance-transport', '--max-waves', '1', '--json',
    ], { encoding: 'utf8', windowsHide: true, env: { ...process.env, COORDINATE_AGENTS_HOME: home, PATH: '' } });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const cliResult = JSON.parse(child.stdout);
    assert.equal(cliResult.stop.code, 'COMPLETED');

    const server = createMcpServer();
    const mcp = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'coordinate_agents_task_graph_advance', arguments: { root, taskId: 'task-advance-transport', maxWaves: 1 } },
    });
    assert.equal(mcp.result.isError, false);
    assert.deepEqual(mcp.result.structuredContent.stop, cliResult.stop);
    assert.deepEqual(mcp.result.structuredContent.waves, cliResult.waves);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    restoreEnvironment(previous);
  }
});

test('graph-advance preserves a healthy running Session and worktree without redispatch', async () => {
  const root = repository('coordinate-agents-advance-session-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-advance-home-'));
  const previous = Object.fromEntries(['COORDINATE_AGENTS_HOME', 'ADVANCE_MARKERS', 'ADVANCE_FAIL_SUBTASK', 'ADVANCE_DELAY_MS'].map(name => [name, process.env[name]]));
  let markers;
  let first;
  try {
    process.env.ADVANCE_DELAY_MS = '5000';
    markers = await fixture(root, home, 'task-advance-session');
    first = await runtimeTaskGraphAdvance({ root, taskId: 'task-advance-session', maxWaves: 2, sessionWaitMs: 0 });
    assert.equal(first.wavesExecuted, 1);
    assert.equal(first.stop.code, 'SUBTASKS_RUNNING');
    const outcome = first.waves[0].outcomes[0];
    assert.equal(outcome.state, 'RUNNING');
    assert.equal(existsSync(outcome.worktree.path), true);
    const storedSessionId = readTaskGraph(root, 'task-advance-session').subtasks.find(item => item.id === 'alpha').sessionId;
    assert.equal(storedSessionId, outcome.session.id);

    const repeated = await runtimeTaskGraphAdvance({ root, taskId: 'task-advance-session', maxWaves: 2, sessionWaitMs: 0 });
    assert.equal(repeated.wavesExecuted, 0);
    assert.equal(repeated.stop.code, 'SUBTASKS_RUNNING');
    assert.equal(readTaskGraph(root, 'task-advance-session').subtasks.find(item => item.id === 'alpha').sessionId, storedSessionId);
  } finally {
    await closeWaveSessions(first?.waves);
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (markers) rmSync(markers, { recursive: true, force: true });
    restoreEnvironment(previous);
  }
});

test('graph-advance leaves running work intact and stops on integration conflict or requested changes', async () => {
  const root = repository('coordinate-agents-advance-boundaries-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-advance-home-'));
  const previous = process.env.COORDINATE_AGENTS_HOME;
  try {
    process.env.COORDINATE_AGENTS_HOME = home;
    await runtimeTaskGraphCreate({ root, graph: graph('task-advance-running') });
    setTaskGraphSubtaskState(root, 'task-advance-running', 'alpha', 'RUNNING');
    const running = await runtimeTaskGraphAdvance({ root, taskId: 'task-advance-running', maxWaves: 2 });
    assert.equal(running.wavesExecuted, 0);
    assert.equal(running.stop.code, 'SUBTASKS_RUNNING');
    assert.equal(readTaskGraph(root, 'task-advance-running').subtasks.find(item => item.id === 'alpha').state, 'RUNNING');

    await runtimeTaskGraphCreate({ root, graph: graph('task-advance-stopped', { parallel: true }) });
    setTaskGraphSubtaskState(root, 'task-advance-stopped', 'alpha', 'STOPPED');
    const stopped = await runtimeTaskGraphAdvance({ root, taskId: 'task-advance-stopped', maxWaves: 2 });
    assert.equal(stopped.wavesExecuted, 0);
    assert.equal(stopped.stop.code, 'GRAPH_STOPPED');

    await runtimeTaskGraphCreate({ root, graph: graph('task-advance-integration', { parallel: true }) });
    setTaskGraphIntegration(root, 'task-advance-integration', 'FAILED', { conflict: { state: 'CONFLICTED', files: ['shared.txt'] } });
    const conflict = await runtimeTaskGraphAdvance({ root, taskId: 'task-advance-integration', maxWaves: 2 });
    assert.equal(conflict.stop.code, 'INTEGRATION_CONFLICT');
    assert.equal(conflict.wavesExecuted, 0);

    await runtimeTaskGraphCreate({ root, graph: graph('task-advance-review', { parallel: true }) });
    setTaskGraphSubtaskState(root, 'task-advance-review', 'alpha', 'SUCCEEDED', { evidence: [{ fixture: true }] });
    setTaskGraphSubtaskState(root, 'task-advance-review', 'beta', 'SUCCEEDED', { evidence: [{ fixture: true }] });
    setTaskGraphIntegration(root, 'task-advance-review', 'SUCCEEDED');
    setTaskGraphReview(root, 'task-advance-review', 'CHANGES_REQUESTED', { feedback: 'Revise the aggregate.' });
    const review = await runtimeTaskGraphAdvance({ root, taskId: 'task-advance-review', maxWaves: 2 });
    assert.equal(review.stop.code, 'CHANGES_REQUESTED');
    assert.equal(review.wavesExecuted, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
    if (previous === undefined) delete process.env.COORDINATE_AGENTS_HOME;
    else process.env.COORDINATE_AGENTS_HOME = previous;
  }
});
