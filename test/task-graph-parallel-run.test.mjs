import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

import { createMcpServer } from '../mcp/server.mjs';
import {
  runtimeSetupConfigure,
  runtimeTaskGraphCreate,
  runtimeTaskGraphDispatch,
  runtimeTaskGraphRun,
} from '../bin/coordinate-agents.mjs';
import { runtimeSessionClose } from '../skills/coordinate-agents/scripts/session-service.mjs';
import {
  captureGraphBaseCommit,
  readTaskGraph,
  setTaskGraphSubtaskState,
} from '../skills/coordinate-agents/scripts/task-graph-runtime.mjs';
import { readRuntimeEvents } from '../skills/coordinate-agents/scripts/runtime-events.mjs';

const canonicalTmpdir = realpathSync(tmpdir());
const cli = resolve('bin/coordinate-agents.mjs');
const busTool = resolve('skills/coordinate-agents/scripts/agent-bus.mjs');

function repository(prefix = 'coordinate-agents-parallel-') {
  const root = mkdtempSync(join(canonicalTmpdir, prefix));
  execFileSync('git', ['init', root], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Coordinate Test'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root, stdio: 'ignore', windowsHide: true });
  writeFileSync(join(root, 'README.md'), '# Parallel fixture\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: root, stdio: 'ignore', windowsHide: true });
  return root;
}

async function removeTree(path) {
  let error = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      if (!existsSync(path)) return;
    } catch (value) { error = value; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  if (error) throw error;
}

async function closeOutcomes(outcomes = []) {
  for (const outcome of outcomes) {
    const sessionId = outcome.session?.id || outcome.sessionId;
    const root = outcome.worktree?.path || outcome.worktreePath;
    if (!sessionId || !root) continue;
    try { await runtimeSessionClose({ root, sessionId, graceful: false, timeoutMs: 1_000 }); } catch { /* Best effort fixture cleanup. */ }
  }
}

function graph(parentTaskId, maxConcurrency = 2) {
  return {
    schemaVersion: 1,
    parentTask: {
      id: parentTaskId,
      title: 'Run independent subtasks concurrently',
      planner: 'codex',
      reviewer: 'codex',
    },
    subtasks: [
      { id: 'alpha', implementer: 'antigravity', spec: 'Implement alpha.' },
      { id: 'beta', implementer: 'antigravity', spec: 'Implement beta.' },
      { id: 'gamma', implementer: 'antigravity', spec: 'Implement gamma.' },
      { id: 'dependent', implementer: 'antigravity', spec: 'Integrate alpha and beta.', dependsOn: ['alpha', 'beta'] },
    ],
    maxConcurrency,
  };
}

function parallelImplementer(repository) {
  const bin = join(repository, 'fixture bin');
  mkdirSync(bin, { recursive: true });
  const source = `const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('parallel-fixture 1.0.0'); process.exit(0); }
const prompt = args.join(' ');
const parentTaskId = (prompt.match(/Parent Task ID:\\s*(task-[A-Za-z0-9_-]+)/) || [])[1];
const subtaskId = (prompt.match(/Subtask ID:\\s*([a-z0-9_-]+)/) || [])[1];
if (!parentTaskId || !subtaskId) process.exit(10);
const shared = process.env.PARALLEL_SHARED;
fs.mkdirSync(shared, { recursive: true });
const marker = path.join(shared, subtaskId + '.started');
try { fs.writeFileSync(marker, String(Date.now()), { encoding: 'utf8', flag: 'wx' }); }
catch { process.stderr.write('duplicate launch: ' + subtaskId); process.exit(11); }
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const deadline = Date.now() + 8000;
while (Date.now() < deadline && fs.readdirSync(shared).filter(name => name.endsWith('.started')).length < 2) sleep(25);
if (fs.readdirSync(shared).filter(name => name.endsWith('.started')).length < 2) {
  process.stderr.write('parallel barrier was not reached');
  process.exit(12);
}
const graphPath = path.join(process.env.PARALLEL_PARENT_ROOT, '.agent-bus', 'task-graphs', parentTaskId + '.json');
const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
const dependent = graph.subtasks.find(item => item.id === 'dependent');
if (!dependent || dependent.state !== 'WAITING') {
  process.stderr.write('dependent subtask escaped WAITING during prerequisites');
  process.exit(13);
}
fs.writeFileSync(path.join(shared, subtaskId + '.waiting-ok'), dependent.state, 'utf8');
// Both agents must observe the prerequisite state before either one is
// allowed to fail or commit.  Without this second barrier, a deliberately
// failing sibling can transition the dependent to BLOCKED while the healthy
// sibling is still reading the graph, making the concurrency fixture flaky on
// slower Node/runner combinations.
const observationDeadline = Date.now() + 8000;
while (Date.now() < observationDeadline && fs.readdirSync(shared).filter(name => name.endsWith('.waiting-ok')).length < 2) sleep(25);
if (fs.readdirSync(shared).filter(name => name.endsWith('.waiting-ok')).length < 2) {
  process.stderr.write('prerequisite observation barrier was not reached');
  process.exit(14);
}
if (process.env.PARALLEL_FAIL_SUBTASK === subtaskId) {
  process.stderr.write('fixture failure for ' + subtaskId);
  process.exit(17);
}
const product = 'product-' + subtaskId + '.txt';
fs.writeFileSync(product, 'Implemented ' + subtaskId + '\\n', 'utf8');
cp.execFileSync('git', ['add', product], { stdio: 'ignore', windowsHide: true });
cp.execFileSync('git', ['commit', '-m', 'Implement ' + subtaskId], { stdio: 'ignore', windowsHide: true });
const commit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
const sent = cp.spawnSync(process.execPath, [
  ${JSON.stringify(busTool)}, 'send', '--root', process.cwd(),
  '--from', 'antigravity', '--to', 'codex',
  '--type', 'IMPLEMENTATION_DONE', '--subject', 'Completed ' + subtaskId,
  '--dedupe-key', 'task:' + parentTaskId + ':subtask:' + subtaskId + ':done',
  '--related-commit', commit,
  '--body', 'Parent Task ID: ' + parentTaskId + '\\nSubtask ID: ' + subtaskId + '\\nimplementationCommit: ' + commit + '\\nEvidence: parallel fixture passed',
], { encoding: 'utf8', windowsHide: true });
if (sent.status !== 0) {
  process.stderr.write(sent.stderr || sent.stdout || 'Bus send failed');
  process.exit(sent.status || 18);
}
process.exit(0);
`;
  const script = join(bin, 'parallel-agent.cjs');
  writeFileSync(script, source, 'utf8');
  if (process.platform === 'win32') {
    const command = join(bin, 'parallel-agent.cmd');
    writeFileSync(command, `@"${process.execPath}" "${script}" %*\r\n`, 'utf8');
    return command;
  }
  const command = join(bin, 'parallel-agent');
  writeFileSync(command, `#!${process.execPath}\n${source}`, 'utf8');
  chmodSync(command, 0o755);
  return command;
}

async function configuredFixture(root, home, parentTaskId, { failSubtask = '', intentMap = null } = {}) {
  const shared = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-parallel-shared-'));
  process.env.COORDINATE_AGENTS_HOME = home;
  process.env.PARALLEL_SHARED = shared;
  process.env.PARALLEL_PARENT_ROOT = root;
  if (failSubtask) process.env.PARALLEL_FAIL_SUBTASK = failSubtask;
  else delete process.env.PARALLEL_FAIL_SUBTASK;
  const command = parallelImplementer(root);
  await runtimeSetupConfigure({
    root,
    agent: 'antigravity',
    command,
    adapter: 'generic-cli',
    args: ['{prompt}'],
    role: 'implementer',
  });
  await runtimeTaskGraphCreate({ root, graph: graph(parentTaskId), intentMap });
  return shared;
}

test('graph-run executes only the bounded READY prefix in distinct worktrees and Sessions', async () => {
  const root = repository('coordinate-agents-parallel-happy-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-parallel-home-'));
  const old = {
    home: process.env.COORDINATE_AGENTS_HOME,
    shared: process.env.PARALLEL_SHARED,
    parent: process.env.PARALLEL_PARENT_ROOT,
    fail: process.env.PARALLEL_FAIL_SUBTASK,
  };
  let shared;
  let result;
  try {
    shared = await configuredFixture(root, home, 'task-parallel-happy');
    const baseCommit = captureGraphBaseCommit(root);
    result = await runtimeTaskGraphRun({ root, taskId: 'task-parallel-happy', sessionWaitMs: 10_000 });

    assert.equal(result.command, 'task.graph-run');
    assert.equal(result.baseCommit, baseCommit);
    assert.deepEqual(result.selected, ['alpha', 'beta']);
    assert.equal(result.summary.selected, 2);
    assert.equal(result.summary.succeeded, 2);
    assert.equal(result.summary.failed, 0);
    assert.equal(result.outcomes.every(outcome => outcome.ok && outcome.state === 'SUCCEEDED'), true);
    assert.equal(new Set(result.outcomes.map(outcome => outcome.worktree.path)).size, 2);
    assert.equal(new Set(result.outcomes.map(outcome => outcome.worktree.branch)).size, 2);
    assert.equal(new Set(result.outcomes.map(outcome => outcome.worktree.ref)).size, 2);
    assert.equal(new Set(result.outcomes.map(outcome => outcome.session.id)).size, 2);
    assert.equal(new Set(result.outcomes.map(outcome => outcome.agent.resolvedCommand)).size, 1);
    assert.equal(result.outcomes.every(outcome => outcome.worktree.baseCommit === baseCommit), true);
    assert.deepEqual(result.frontier.ready, ['dependent', 'gamma']);
    assert.deepEqual(result.frontier.succeeded, ['alpha', 'beta']);
    assert.equal(existsSync(join(shared, 'alpha.waiting-ok')), true);
    assert.equal(existsSync(join(shared, 'beta.waiting-ok')), true);
    assert.equal(existsSync(join(shared, 'gamma.started')), false);

    for (const outcome of result.outcomes) {
      const events = readRuntimeEvents(outcome.worktree.path, {
        taskId: 'task-parallel-happy',
        subtaskId: outcome.subtaskId,
        sessionId: outcome.session.id,
        limit: 20,
      });
      assert.ok(events.some(event => event.type === 'SESSION_STARTING'));
      assert.equal(events.every(event => event.taskId === 'task-parallel-happy'), true);
      assert.equal(events.every(event => event.subtaskId === outcome.subtaskId), true);
      assert.match(outcome.evidence[0].path, new RegExp(outcome.subtaskId));
    }
    const transitions = readRuntimeEvents(root, { taskId: 'task-parallel-happy', limit: 50 })
      .filter(event => event.type === 'TASK_GRAPH_SUBTASK_STATE_CHANGED');
    assert.ok(transitions.some(event => event.subtaskId === 'alpha' && event.data.to === 'RUNNING'));
    assert.ok(transitions.some(event => event.subtaskId === 'beta' && event.data.to === 'RUNNING'));
    assert.ok(transitions.some(event => event.subtaskId === 'dependent' && event.data.to === 'READY'));
  } finally {
    await closeOutcomes(result?.outcomes);
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
    if (shared) rmSync(shared, { recursive: true, force: true });
    for (const [key, value] of Object.entries(old)) {
      const name = ({ home: 'COORDINATE_AGENTS_HOME', shared: 'PARALLEL_SHARED', parent: 'PARALLEL_PARENT_ROOT', fail: 'PARALLEL_FAIL_SUBTASK' })[key];
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('graph-run launches one deterministic non-conflicting write-intent wave', async () => {
  const root = repository('coordinate-agents-parallel-intent-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-parallel-home-'));
  const oldHome = process.env.COORDINATE_AGENTS_HOME;
  let shared;
  let result;
  try {
    const parentTaskId = 'task-parallel-intent';
    shared = await configuredFixture(root, home, parentTaskId, {
      intentMap: {
        schemaVersion: 1,
        parentTaskId,
        scopePolicy: 'warn',
        subtasks: [
          { id: 'alpha', writeIntent: ['src/shared/**'] },
          { id: 'beta', writeIntent: ['src/shared/file.js'] },
          { id: 'gamma', writeIntent: ['docs/**'] },
          { id: 'dependent', writeIntent: [] },
        ],
      },
    });
    result = await runtimeTaskGraphRun({ root, taskId: parentTaskId, sessionWaitMs: 10_000 });
    assert.deepEqual(result.selected, ['alpha', 'gamma']);
    assert.deepEqual(result.initialPlan.wave.selected, ['alpha', 'gamma']);
    assert.deepEqual(result.initialPlan.wave.conflictDeferred, ['beta']);
    assert.equal(result.initialPlan.conflicts[0].code, 'WRITE_INTENT_CONFLICT');
    assert.equal(result.summary.selected, 2);
    assert.equal(result.summary.succeeded, 2);
    assert.equal(existsSync(join(shared, 'alpha.started')), true);
    assert.equal(existsSync(join(shared, 'gamma.started')), true);
    assert.equal(existsSync(join(shared, 'beta.started')), false);
    assert.deepEqual(
      readTaskGraph(root, parentTaskId).subtasks.find(item => item.id === 'dependent').dependsOn,
      ['alpha', 'beta'],
    );
  } finally {
    await closeOutcomes(result?.outcomes);
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
    if (shared) rmSync(shared, { recursive: true, force: true });
    delete process.env.PARALLEL_SHARED;
    delete process.env.PARALLEL_PARENT_ROOT;
    delete process.env.PARALLEL_FAIL_SUBTASK;
    if (oldHome === undefined) delete process.env.COORDINATE_AGENTS_HOME;
    else process.env.COORDINATE_AGENTS_HOME = oldHome;
  }
});

test('graph-run isolates one failing subtask while preserving its successful sibling and blocking only dependents', async () => {
  const root = repository('coordinate-agents-parallel-failure-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-parallel-home-'));
  const oldHome = process.env.COORDINATE_AGENTS_HOME;
  let shared;
  let result;
  try {
    shared = await configuredFixture(root, home, 'task-parallel-failure', { failSubtask: 'beta' });
    result = await runtimeTaskGraphRun({ root, taskId: 'task-parallel-failure', sessionWaitMs: 10_000 });
    const outcomes = Object.fromEntries(result.outcomes.map(outcome => [outcome.subtaskId, outcome]));
    assert.equal(outcomes.alpha.ok, true);
    assert.equal(outcomes.alpha.state, 'SUCCEEDED');
    assert.equal(outcomes.beta.ok, false);
    assert.equal(outcomes.beta.state, 'FAILED');
    assert.equal(outcomes.beta.error.code, 'AGENT_EXIT_NONZERO');
    const stored = readTaskGraph(root, 'task-parallel-failure');
    assert.equal(stored.subtasks.find(item => item.id === 'alpha').state, 'SUCCEEDED');
    assert.equal(stored.subtasks.find(item => item.id === 'beta').state, 'FAILED');
    assert.equal(stored.subtasks.find(item => item.id === 'dependent').state, 'BLOCKED');
    assert.equal(stored.subtasks.find(item => item.id === 'gamma').state, 'READY');
    assert.equal(existsSync(join(shared, 'gamma.started')), false);
  } finally {
    await closeOutcomes(result?.outcomes);
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
    if (shared) rmSync(shared, { recursive: true, force: true });
    delete process.env.PARALLEL_SHARED;
    delete process.env.PARALLEL_PARENT_ROOT;
    delete process.env.PARALLEL_FAIL_SUBTASK;
    if (oldHome === undefined) delete process.env.COORDINATE_AGENTS_HOME;
    else process.env.COORDINATE_AGENTS_HOME = oldHome;
  }
});

test('atomic graph dispatch rejects a third RUNNING subtask at maxConcurrency before launch', async () => {
  const root = repository('coordinate-agents-parallel-capacity-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-parallel-home-'));
  const oldHome = process.env.COORDINATE_AGENTS_HOME;
  try {
    process.env.COORDINATE_AGENTS_HOME = home;
    await runtimeTaskGraphCreate({ root, graph: graph('task-parallel-capacity') });
    setTaskGraphSubtaskState(root, 'task-parallel-capacity', 'alpha', 'RUNNING');
    setTaskGraphSubtaskState(root, 'task-parallel-capacity', 'beta', 'RUNNING');
    const error = await runtimeTaskGraphDispatch({
      root,
      taskId: 'task-parallel-capacity',
      subtaskId: 'gamma',
      sessionWaitMs: 0,
    }).catch(value => value);
    assert.equal(error.code, 'TASK_STATE_CONFLICT');
    assert.equal(error.stage, 'graph-scheduling');
    assert.equal(readTaskGraph(root, 'task-parallel-capacity').subtasks.find(item => item.id === 'gamma').state, 'READY');
    assert.equal(existsSync(join(root, '.agent-bus', 'worktrees')), false);
  } finally {
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
    if (oldHome === undefined) delete process.env.COORDINATE_AGENTS_HOME;
    else process.env.COORDINATE_AGENTS_HOME = oldHome;
  }
});

test('atomic graph dispatch rejects a running write-intent conflict before worktree or Session launch', async () => {
  const root = repository('coordinate-agents-parallel-conflict-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-parallel-home-'));
  const oldHome = process.env.COORDINATE_AGENTS_HOME;
  try {
    process.env.COORDINATE_AGENTS_HOME = home;
    const parentTaskId = 'task-parallel-conflict';
    await runtimeTaskGraphCreate({
      root,
      graph: graph(parentTaskId),
      intentMap: {
        schemaVersion: 1,
        parentTaskId,
        subtasks: [
          { id: 'alpha', writeIntent: ['src/shared/**'] },
          { id: 'beta', writeIntent: ['src/shared/file.js'] },
          { id: 'gamma', writeIntent: ['docs/**'] },
          { id: 'dependent', writeIntent: [] },
        ],
      },
    });
    setTaskGraphSubtaskState(root, parentTaskId, 'alpha', 'RUNNING', {
      expectedState: 'READY',
      requireAvailableSlot: true,
      requireIntentCompatible: true,
    });
    const error = await runtimeTaskGraphDispatch({
      root,
      taskId: parentTaskId,
      subtaskId: 'beta',
      sessionWaitMs: 0,
    }).catch(value => value);
    assert.equal(error.code, 'TASK_STATE_CONFLICT');
    assert.equal(error.stage, 'graph-scheduling');
    assert.equal(error.details.conflict.code, 'WRITE_INTENT_CONFLICT');
    const stored = readTaskGraph(root, parentTaskId);
    assert.equal(stored.subtasks.find(item => item.id === 'alpha').state, 'RUNNING');
    assert.equal(stored.subtasks.find(item => item.id === 'beta').state, 'READY');
    assert.equal(stored.subtasks.find(item => item.id === 'gamma').state, 'READY');
    assert.equal(existsSync(join(root, '.agent-bus', 'worktrees', parentTaskId, 'beta')), false);
    const sessionsPath = join(root, '.agent-bus', 'sessions');
    assert.equal(!existsSync(sessionsPath) || readdirSync(sessionsPath).length === 0, true);
    assert.deepEqual(stored.subtasks.find(item => item.id === 'dependent').dependsOn, ['alpha', 'beta']);
  } finally {
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
    if (oldHome === undefined) delete process.env.COORDINATE_AGENTS_HOME;
    else process.env.COORDINATE_AGENTS_HOME = oldHome;
  }
});

test('CLI and MCP expose graph-run without changing the single-Task command surface', async () => {
  const root = repository('coordinate-agents-parallel-transport-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-parallel-home-'));
  const oldHome = process.env.COORDINATE_AGENTS_HOME;
  try {
    process.env.COORDINATE_AGENTS_HOME = home;
    await runtimeTaskGraphCreate({ root, graph: {
      ...graph('task-parallel-transport'),
      subtasks: [{ id: 'done', implementer: 'antigravity', spec: 'Already done.' }],
      maxConcurrency: 1,
    } });
    setTaskGraphSubtaskState(root, 'task-parallel-transport', 'done', 'SUCCEEDED', { evidence: [{ fixture: true }] });
    const server = createMcpServer();
    const mcp = await server.handle({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'coordinate_agents_task_graph_run', arguments: { root, taskId: 'task-parallel-transport' } },
    });
    assert.equal(mcp.result.isError, false);
    assert.deepEqual(mcp.result.structuredContent.selected, []);

    const child = spawnSync(process.execPath, [
      cli, 'task', 'graph-run', '--root', root, '--id', 'task-parallel-transport', '--json',
    ], { encoding: 'utf8', windowsHide: true, env: { ...process.env, COORDINATE_AGENTS_HOME: home, PATH: '' } });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    assert.deepEqual(JSON.parse(child.stdout).selected, []);
  } finally {
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
    if (oldHome === undefined) delete process.env.COORDINATE_AGENTS_HOME;
    else process.env.COORDINATE_AGENTS_HOME = oldHome;
  }
});
