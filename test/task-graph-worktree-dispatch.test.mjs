import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createMcpServer } from '../mcp/server.mjs';
import {
  runtimeSetupConfigure,
  runtimeTaskGraphCreate,
  runtimeTaskGraphDispatch,
  runtimeTaskGraphStatus,
} from '../bin/coordinate-agents.mjs';
import {
  runtimeSessionClose,
} from '../skills/coordinate-agents/scripts/session-service.mjs';
import {
  captureGraphBaseCommit,
  readTaskGraph,
  taskGraphBranchName,
  taskGraphBranchRef,
  taskGraphWorktreePath,
} from '../skills/coordinate-agents/scripts/task-graph-runtime.mjs';
import { readRuntimeEvents } from '../skills/coordinate-agents/scripts/runtime-events.mjs';
import { getExecutionSessionManager } from '../skills/coordinate-agents/scripts/session-manager.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(packageRoot, 'bin', 'coordinate-agents.mjs');
const busTool = join(packageRoot, 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');
const canonicalTmpdir = realpathSync(tmpdir());

async function closeQuietly(root, sessionId) {
  if (!sessionId) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await runtimeSessionClose({ root, sessionId, graceful: false, timeoutMs: 1_000 });
      if (!['starting', 'running', 'idle', 'busy'].includes(result?.session?.state)) return;
    } catch { /* Cleanup is best effort */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function removeTree(path) {
  let lastError = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      if (!existsSync(path)) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (lastError) throw lastError;
}

function tempRepository(prefix = 'coordinate-agents-graph-dispatch-') {
  const root = mkdtempSync(join(canonicalTmpdir, prefix));
  execFileSync('git', ['init', root], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Coordinate Test'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root, stdio: 'ignore', windowsHide: true });
  writeFileSync(join(root, 'README.md'), '# Initial Repository\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: root, stdio: 'ignore', windowsHide: true });
  return root;
}

function fixtureImplementer(repository, name, { exitCode = 0, commitMessage = 'Subtask product commit', sendCompletion = true } = {}) {
  const bin = join(repository, 'fixture bin');
  mkdirSync(bin, { recursive: true });
  const source = `const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('subtask-fixture 1.0.0'); process.exit(0); }
const prompt = args.join(' ');
const taskIdMatch = prompt.match(/Parent Task ID:\\s*(task-[A-Za-z0-9_-]+)/) || prompt.match(/Task ID:\\s*(task-[A-Za-z0-9_-]+)/);
const subtaskIdMatch = prompt.match(/Subtask ID:\\s*([a-z0-9_-]+)/);
const parentTaskId = taskIdMatch ? taskIdMatch[1] : 'task-default';
const subtaskId = subtaskIdMatch ? subtaskIdMatch[1] : 'backend';

if (${exitCode} !== 0) {
  process.stderr.write('Simulated implementer failure with exit code ${exitCode}\\n');
  process.exit(${exitCode});
}

// Write a file in the worktree
fs.writeFileSync('product-output.txt', 'Implemented ' + subtaskId + ' for ' + parentTaskId + '\\n', 'utf8');
cp.execFileSync('git', ['add', 'product-output.txt'], { stdio: 'ignore', windowsHide: true });
cp.execFileSync('git', ['commit', '-m', ${JSON.stringify(commitMessage)}], { stdio: 'ignore', windowsHide: true });
const commit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();

const busTool = ${JSON.stringify(busTool)};
if (${sendCompletion ? 'true' : 'false'} && busTool && fs.existsSync(busTool)) {
  const result = cp.spawnSync(process.execPath, [
    busTool, 'send', '--root', process.cwd(),
    '--from', process.env.FIXTURE_AGENT || 'antigravity', '--to', 'codex',
    '--type', 'IMPLEMENTATION_DONE', '--subject', 'Subtask ' + subtaskId + ' completed',
    '--dedupe-key', 'task:' + parentTaskId + ':subtask:' + subtaskId + ':done',
    '--related-commit', commit,
    '--body', 'Parent Task ID: ' + parentTaskId + '\\nSubtask ID: ' + subtaskId + '\\nTask ID: ' + parentTaskId + '\\nimplementationCommit: ' + commit + '\\nEvidence: all tests passed',
  ], { encoding: 'utf8', windowsHide: true });
  fs.writeFileSync('fixture-debug.json', JSON.stringify({ status: result.status, stderr: result.stderr, stdout: result.stdout, cwd: process.cwd() }), 'utf8');
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || 'fixture bus send failed');
    process.exit(result.status || 9);
  }
}
process.exit(0);
`;
  if (process.platform === 'win32') {
    const script = join(bin, `${name}.cjs`);
    writeFileSync(script, source, 'utf8');
    const cmd = join(bin, `${name}.cmd`);
    writeFileSync(cmd, `@"${process.execPath}" "${script}" %*\r\n`, 'utf8');
    return cmd;
  }
  const cmd = join(bin, name);
  writeFileSync(cmd, `#!${process.execPath}\n${source}`, 'utf8');
  chmodSync(cmd, 0o755);
  return cmd;
}

function sampleGraph(parentTaskId = 'task-graph-dispatch-1') {
  return {
    schemaVersion: 1,
    parentTask: {
      id: parentTaskId,
      title: 'Sample graph dispatch task',
      planner: 'codex',
      reviewer: 'codex',
    },
    subtasks: [
      { id: 'backend', implementer: 'antigravity', spec: 'Implement backend service.' },
      { id: 'frontend', implementer: 'codex', spec: 'Implement frontend UI.', dependsOn: ['backend'] },
    ],
    maxConcurrency: 2,
  };
}

test('Happy path: Dispatch one selected READY subtask in an isolated Git worktree', async () => {
  const root = tempRepository('coordinate-graph-happy-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-graph-home-'));
  const originalHome = process.env.COORDINATE_AGENTS_HOME;
  process.env.COORDINATE_AGENTS_HOME = home;
  const cmd = fixtureImplementer(root, 'agent-antigravity');
  let dispatched = null;

  try {
    // Configure implementer
    const configured = await runtimeSetupConfigure({
      root,
      agent: 'antigravity',
      command: cmd,
      adapter: 'generic-cli',
      args: ['{prompt}'],
      role: 'implementer',
    });
    assert.equal(configured.ok, true);

    // Create graph
    const initialCommit = captureGraphBaseCommit(root);
    const created = await runtimeTaskGraphCreate({ root, graph: sampleGraph('task-happy-1') });
    assert.equal(created.ok, true);
    assert.deepEqual(created.frontier.ready, ['backend']);
    assert.deepEqual(created.frontier.waiting, ['frontend']);

    // Dispatch READY subtask 'backend'
    dispatched = await runtimeTaskGraphDispatch({
      root,
      taskId: 'task-happy-1',
      subtaskId: 'backend',
      sessionWaitMs: 3000,
    });

    assert.equal(dispatched.ok, true);
    assert.equal(dispatched.command, 'task.graph-dispatch');
    assert.equal(dispatched.parentTaskId, 'task-happy-1');
    assert.equal(dispatched.subtaskId, 'backend');
    assert.equal(dispatched.subtask.state, 'SUCCEEDED');
    assert.equal(dispatched.worktree.baseCommit, initialCommit);
    assert.ok(dispatched.worktree.path.includes(join('.agent-bus', 'worktrees', 'task-happy-1', 'backend')));
    assert.equal(dispatched.worktree.branch, 'coordinate-agents/task-happy-1/backend');
    assert.equal(dispatched.worktree.ref, 'refs/heads/coordinate-agents/task-happy-1/backend');
    assert.ok(dispatched.implementationCommit);
    assert.notEqual(dispatched.implementationCommit, initialCommit);
    assert.equal(dispatched.evidence.length, 1);
    assert.equal(dispatched.evidence[0].type, 'IMPLEMENTATION_DONE');

    // Frontier now unlocks dependent subtask 'frontend'
    assert.deepEqual(dispatched.frontier.ready, ['frontend']);
    assert.deepEqual(dispatched.frontier.waiting, []);
    assert.deepEqual(dispatched.frontier.succeeded, ['backend']);

    // Check durable graph status
    const status = await runtimeTaskGraphStatus({ root, taskId: 'task-happy-1' });
    assert.equal(status.ok, true);
    const backendSubtask = status.subtasks.find(s => s.id === 'backend');
    assert.equal(backendSubtask.state, 'SUCCEEDED');
    assert.equal(backendSubtask.worktreePath, dispatched.worktree.path);
    assert.equal(backendSubtask.branch, 'coordinate-agents/task-happy-1/backend');
    assert.equal(backendSubtask.ref, 'refs/heads/coordinate-agents/task-happy-1/backend');
    assert.equal(backendSubtask.baseCommit, initialCommit);
    assert.equal(backendSubtask.implementationCommit, dispatched.implementationCommit);

    // Check event journal
    const events = readRuntimeEvents(root, { taskId: 'task-happy-1', limit: 20 });
    const types = events.map(e => e.type);
    assert.ok(types.includes('TASK_GRAPH_CREATED'));
    assert.ok(types.includes('TASK_GRAPH_SUBTASK_STATE_CHANGED'));
    const transitionEvents = events.filter(e => e.type === 'TASK_GRAPH_SUBTASK_STATE_CHANGED');
    assert.ok(transitionEvents.some(e => e.subtaskId === 'backend' && e.data.to === 'RUNNING'));
    assert.ok(transitionEvents.some(e => e.subtaskId === 'backend' && e.data.to === 'SUCCEEDED'));
    assert.ok(transitionEvents.some(e => e.subtaskId === 'frontend' && e.data.from === 'WAITING' && e.data.to === 'READY'));
  } finally {
    if (dispatched?.session?.id && dispatched?.worktree?.path) {
      await closeQuietly(dispatched.worktree.path, dispatched.session.id);
    }
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
    if (originalHome !== undefined) process.env.COORDINATE_AGENTS_HOME = originalHome;
    else delete process.env.COORDINATE_AGENTS_HOME;
  }
});

test('Unchanged user worktree: Captures exact base commit without touching uncommitted files', async () => {
  const root = tempRepository('coordinate-graph-uncommitted-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-graph-home-'));
  const originalHome = process.env.COORDINATE_AGENTS_HOME;
  process.env.COORDINATE_AGENTS_HOME = home;
  const cmd = fixtureImplementer(root, 'agent-antigravity');
  let dispatched = null;

  try {
    await runtimeSetupConfigure({
      root,
      agent: 'antigravity',
      command: cmd,
      adapter: 'generic-cli',
      args: ['{prompt}'],
      role: 'implementer',
    });

    const initialCommit = captureGraphBaseCommit(root);

    // Create uncommitted modified tracked file and untracked file in user repository
    writeFileSync(join(root, 'README.md'), '# Modified uncommitted user file\n', 'utf8');
    writeFileSync(join(root, 'untracked.txt'), 'Untracked user scratch file\n', 'utf8');

    await runtimeTaskGraphCreate({ root, graph: sampleGraph('task-uncommitted-1') });

    dispatched = await runtimeTaskGraphDispatch({
      root,
      taskId: 'task-uncommitted-1',
      subtaskId: 'backend',
      sessionWaitMs: 3000,
    });

    assert.equal(dispatched.ok, true);
    assert.equal(dispatched.worktree.baseCommit, initialCommit);

    // Verify user repository uncommitted files were NOT modified, staged, or reset
    assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '# Modified uncommitted user file\n');
    assert.equal(readFileSync(join(root, 'untracked.txt'), 'utf8'), 'Untracked user scratch file\n');
    const statusOutput = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.match(statusOutput, / M README.md/);
    assert.match(statusOutput, /\?\? untracked.txt/);

    // Verify uncommitted user files were NOT copied into the subtask worktree
    const worktreePath = dispatched.worktree.path;
    assert.equal(existsSync(join(worktreePath, 'untracked.txt')), false);
    assert.equal(readFileSync(join(worktreePath, 'README.md'), 'utf8').replace(/\r\n/g, '\n'), '# Initial Repository\n');
  } finally {
    if (dispatched?.session?.id && dispatched?.worktree?.path) {
      await closeQuietly(dispatched.worktree.path, dispatched.session.id);
    }
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
    if (originalHome !== undefined) process.env.COORDINATE_AGENTS_HOME = originalHome;
    else delete process.env.COORDINATE_AGENTS_HOME;
  }
});

test('Worktree paths with spaces and shell metacharacters', async () => {
  const root = tempRepository('coordinate graph spaces & $meta (test)-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-graph-home-'));
  const originalHome = process.env.COORDINATE_AGENTS_HOME;
  process.env.COORDINATE_AGENTS_HOME = home;
  const cmd = fixtureImplementer(root, 'agent-antigravity');
  let dispatched = null;

  try {
    await runtimeSetupConfigure({
      root,
      agent: 'antigravity',
      command: cmd,
      adapter: 'generic-cli',
      args: ['{prompt}'],
      role: 'implementer',
    });

    await runtimeTaskGraphCreate({ root, graph: sampleGraph('task-spaces-1') });

    dispatched = await runtimeTaskGraphDispatch({
      root,
      taskId: 'task-spaces-1',
      subtaskId: 'backend',
      sessionWaitMs: 3000,
    });

    assert.equal(dispatched.ok, true);
    assert.equal(dispatched.subtask.state, 'SUCCEEDED');
    assert.ok(existsSync(dispatched.worktree.path));
    assert.ok(existsSync(join(dispatched.worktree.path, 'product-output.txt')));
  } finally {
    if (dispatched?.session?.id && dispatched?.worktree?.path) {
      await closeQuietly(dispatched.worktree.path, dispatched.session.id);
    }
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
    if (originalHome !== undefined) process.env.COORDINATE_AGENTS_HOME = originalHome;
    else delete process.env.COORDINATE_AGENTS_HOME;
  }
});

test('Validation & Safety: Rejects invalid subtask IDs, path escapes, and non-READY subtasks', async () => {
  const root = tempRepository('coordinate-graph-safety-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-graph-home-'));
  const originalHome = process.env.COORDINATE_AGENTS_HOME;
  process.env.COORDINATE_AGENTS_HOME = home;
  const cmd = fixtureImplementer(root, 'agent-antigravity');

  try {
    await runtimeSetupConfigure({
      root,
      agent: 'antigravity',
      command: cmd,
      adapter: 'generic-cli',
      args: ['{prompt}'],
      role: 'implementer',
    });

    await runtimeTaskGraphCreate({ root, graph: sampleGraph('task-safety-1') });

    // Reject missing subtask
    await assert.rejects(
      async () => runtimeTaskGraphDispatch({ root, taskId: 'task-safety-1', subtaskId: 'non-existent' }),
      /Task Graph subtask not found/
    );

    // Reject non-READY subtask (frontend is WAITING)
    await assert.rejects(
      async () => runtimeTaskGraphDispatch({ root, taskId: 'task-safety-1', subtaskId: 'frontend' }),
      /only READY subtasks can be dispatched/
    );

    // Helper functions reject unsafe subtask and parent IDs
    assert.throws(
      () => taskGraphWorktreePath(root, 'task-safety-1', '../escape'),
      /Invalid Task Graph subtask identifier/
    );
    assert.throws(
      () => taskGraphBranchName('task-safety-1', 'INVALID/ID'),
      /Invalid Task Graph subtask identifier/
    );
    assert.throws(
      () => taskGraphBranchRef('invalid parent', 'backend'),
      /Invalid Task Graph parent Task identifier/
    );
  } finally {
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
    if (originalHome !== undefined) process.env.COORDINATE_AGENTS_HOME = originalHome;
    else delete process.env.COORDINATE_AGENTS_HOME;
  }
});

test('Worktree boundary: Rejects a symlinked or junction graph worktree root before claiming the subtask', async t => {
  const root = tempRepository('coordinate-graph-symlink-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-graph-home-'));
  const originalHome = process.env.COORDINATE_AGENTS_HOME;
  process.env.COORDINATE_AGENTS_HOME = home;
  const outside = mkdtempSync(join(canonicalTmpdir, 'coordinate-graph-outside-'));

  try {
    const cmd = fixtureImplementer(root, 'agent-antigravity');
    await runtimeSetupConfigure({
      root,
      agent: 'antigravity',
      command: cmd,
      adapter: 'generic-cli',
      args: ['{prompt}'],
      role: 'implementer',
    });
    await runtimeTaskGraphCreate({ root, graph: sampleGraph('task-symlink-1') });

    try {
      symlinkSync(outside, join(root, '.agent-bus', 'worktrees'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      t.skip(`symlinks/junctions are unavailable on this platform: ${error.code || error.message}`);
      return;
    }

    await assert.rejects(
      async () => runtimeTaskGraphDispatch({ root, taskId: 'task-symlink-1', subtaskId: 'backend' }),
      /symbolic link|junction/i,
    );
    const graph = readTaskGraph(root, 'task-symlink-1');
    assert.equal(graph.state, 'CREATED');
    assert.equal(graph.baseCommit ?? null, null);
    assert.equal(graph.subtasks.find(subtask => subtask.id === 'backend').state, 'READY');
    assert.equal(existsSync(join(outside, 'task-symlink-1')), false);
  } finally {
    await removeTree(root);
    await removeTree(outside);
    rmSync(home, { recursive: true, force: true });
    if (originalHome !== undefined) process.env.COORDINATE_AGENTS_HOME = originalHome;
    else delete process.env.COORDINATE_AGENTS_HOME;
  }
});

test('Session isolation: Session is rooted in worktree and isolated from main root sessions', async () => {
  const root = tempRepository('coordinate-graph-session-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-graph-home-'));
  const originalHome = process.env.COORDINATE_AGENTS_HOME;
  process.env.COORDINATE_AGENTS_HOME = home;
  const cmd = fixtureImplementer(root, 'agent-antigravity');
  let dispatched = null;

  try {
    await runtimeSetupConfigure({
      root,
      agent: 'antigravity',
      command: cmd,
      adapter: 'generic-cli',
      args: ['{prompt}'],
      role: 'implementer',
    });

    await runtimeTaskGraphCreate({ root, graph: sampleGraph('task-session-1') });

    dispatched = await runtimeTaskGraphDispatch({
      root,
      taskId: 'task-session-1',
      subtaskId: 'backend',
      sessionWaitMs: 3000,
    });

    const worktreePath = dispatched.worktree.path;
    const sessionManager = getExecutionSessionManager();

    // Verify session was recorded in worktree/.agent-bus/sessions
    assert.ok(existsSync(join(worktreePath, '.agent-bus', 'sessions')));

    // Session status probe at worktree succeeds
    const sessionStatus = await sessionManager.status(worktreePath, dispatched.session.id);
    assert.ok(sessionStatus);
    assert.equal(sessionStatus.agent, 'antigravity');
  } finally {
    if (dispatched?.session?.id && dispatched?.worktree?.path) {
      await closeQuietly(dispatched.worktree.path, dispatched.session.id);
    }
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
    if (originalHome !== undefined) process.env.COORDINATE_AGENTS_HOME = originalHome;
    else delete process.env.COORDINATE_AGENTS_HOME;
  }
});

test('Failure isolation: Executable failure fails closed, marks subtask FAILED, and leaves sibling untouched', async () => {
  const root = tempRepository('coordinate-graph-failure-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-graph-home-'));
  const originalHome = process.env.COORDINATE_AGENTS_HOME;
  process.env.COORDINATE_AGENTS_HOME = home;
  const failingCmd = fixtureImplementer(root, 'agent-failing', { exitCode: 7 });

  try {
    await runtimeSetupConfigure({
      root,
      agent: 'antigravity',
      command: failingCmd,
      adapter: 'generic-cli',
      args: ['{prompt}'],
      role: 'implementer',
    });

    const multiGraph = {
      schemaVersion: 1,
      parentTask: {
        id: 'task-fail-1',
        title: 'Multi-subtask failure test',
        planner: 'codex',
        reviewer: 'codex',
      },
      subtasks: [
        { id: 'backend', implementer: 'antigravity', spec: 'Failing backend subtask.' },
        { id: 'independent', implementer: 'antigravity', spec: 'Independent sibling subtask.' },
        { id: 'frontend', implementer: 'codex', spec: 'Dependent subtask.', dependsOn: ['backend'] },
      ],
      maxConcurrency: 2,
    };

    await runtimeTaskGraphCreate({ root, graph: multiGraph });

    // Dispatch failing subtask 'backend'
    await assert.rejects(
      async () => runtimeTaskGraphDispatch({ root, taskId: 'task-fail-1', subtaskId: 'backend', sessionWaitMs: 3000 }),
      /failed after dispatch/
    );

    // Verify graph status after failure
    const status = await runtimeTaskGraphStatus({ root, taskId: 'task-fail-1' });
    assert.equal(status.state, 'ERROR');
    const backend = status.subtasks.find(s => s.id === 'backend');
    const independent = status.subtasks.find(s => s.id === 'independent');
    const frontend = status.subtasks.find(s => s.id === 'frontend');

    assert.equal(backend.state, 'FAILED');
    // Independent sibling remains untouched and READY
    assert.equal(independent.state, 'READY');
    // Downstream dependent subtask becomes BLOCKED
    assert.equal(frontend.state, 'BLOCKED');
  } finally {
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
    if (originalHome !== undefined) process.env.COORDINATE_AGENTS_HOME = originalHome;
    else delete process.env.COORDINATE_AGENTS_HOME;
  }
});

test('Completion requires a matching IMPLEMENTATION_DONE commit message and does not infer success from HEAD', async () => {
  const root = tempRepository('coordinate-graph-no-report-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-graph-home-'));
  const originalHome = process.env.COORDINATE_AGENTS_HOME;
  process.env.COORDINATE_AGENTS_HOME = home;
  const cmd = fixtureImplementer(root, 'agent-antigravity', { sendCompletion: false });

  try {
    await runtimeSetupConfigure({
      root,
      agent: 'antigravity',
      command: cmd,
      adapter: 'generic-cli',
      args: ['{prompt}'],
      role: 'implementer',
    });
    await runtimeTaskGraphCreate({ root, graph: sampleGraph('task-no-report-1') });

    await assert.rejects(
      async () => runtimeTaskGraphDispatch({ root, taskId: 'task-no-report-1', subtaskId: 'backend', sessionWaitMs: 3000 }),
      /without an IMPLEMENTATION_DONE message/
    );
    const status = await runtimeTaskGraphStatus({ root, taskId: 'task-no-report-1' });
    const backend = status.subtasks.find(subtask => subtask.id === 'backend');
    const frontend = status.subtasks.find(subtask => subtask.id === 'frontend');
    assert.equal(backend.state, 'FAILED');
    assert.equal(backend.implementationCommit ?? null, null);
    assert.equal(backend.evidence.length, 0);
    assert.equal(frontend.state, 'BLOCKED');
  } finally {
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
    if (originalHome !== undefined) process.env.COORDINATE_AGENTS_HOME = originalHome;
    else delete process.env.COORDINATE_AGENTS_HOME;
  }
});

test('MCP Tool coordinate_agents_task_graph_dispatch and CLI graph-dispatch operation', async () => {
  const root = tempRepository('coordinate-graph-mcp-cli-');
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-graph-home-'));
  const originalHome = process.env.COORDINATE_AGENTS_HOME;
  process.env.COORDINATE_AGENTS_HOME = home;
  const cmd = fixtureImplementer(root, 'agent-antigravity');
  let mcpResponse = null;

  try {
    await runtimeSetupConfigure({
      root,
      agent: 'antigravity',
      command: cmd,
      adapter: 'generic-cli',
      args: ['{prompt}'],
      role: 'implementer',
    });

    await runtimeTaskGraphCreate({ root, graph: sampleGraph('task-mcp-cli-1') });

    // 1. MCP Tool dispatch
    const server = createMcpServer({ root });
    mcpResponse = await server.handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'coordinate_agents_task_graph_dispatch',
        arguments: {
          root,
          taskId: 'task-mcp-cli-1',
          subtaskId: 'backend',
        },
      },
    });

    assert.equal(mcpResponse.result.isError, false);
    assert.equal(mcpResponse.result.structuredContent.ok, true);
    assert.equal(mcpResponse.result.structuredContent.command, 'task.graph-dispatch');
    assert.equal(mcpResponse.result.structuredContent.subtask.state, 'SUCCEEDED');
    assert.deepEqual(mcpResponse.result.structuredContent.frontier.ready, ['frontend']);

    // 2. CLI graph-dispatch verification on next task
    await runtimeTaskGraphCreate({ root, graph: sampleGraph('task-cli-dispatch-2') });

    const cliResult = spawnSync(process.execPath, [
      cli, 'task', 'graph-dispatch',
      '--root', root,
      '--id', 'task-cli-dispatch-2',
      '--subtask', 'backend',
      '--json',
    ], {
      cwd: packageRoot,
      encoding: 'utf8',
      env: { ...process.env, COORDINATE_AGENTS_HOME: home, BUS_TOOL: busTool },
      windowsHide: true,
    });

    assert.equal(cliResult.status, 0, cliResult.stderr || cliResult.stdout);
    const cliParsed = JSON.parse(cliResult.stdout);
    assert.equal(cliParsed.ok, true);
    assert.equal(cliParsed.command, 'task.graph-dispatch');
    assert.equal(cliParsed.subtask.state, 'SUCCEEDED');
    assert.deepEqual(cliParsed.frontier.ready, ['frontend']);
  } finally {
    if (mcpResponse?.result?.structuredContent?.session?.id && mcpResponse?.result?.structuredContent?.worktree?.path) {
      await closeQuietly(mcpResponse.result.structuredContent.worktree.path, mcpResponse.result.structuredContent.session.id);
    }
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
    if (originalHome !== undefined) process.env.COORDINATE_AGENTS_HOME = originalHome;
    else delete process.env.COORDINATE_AGENTS_HOME;
  }
});
