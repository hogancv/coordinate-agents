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
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  runtimeSetupConfigure,
  runtimeTaskGraphCleanup,
  runtimeTaskGraphCreate,
  runtimeTaskGraphInspect,
  runtimeTaskGraphIntegrate,
  runtimeTaskGraphPlan,
  runtimeTaskGraphReview,
  runtimeTaskGraphRun,
} from '../bin/coordinate-agents.mjs';
import {
  captureGraphBaseCommit,
  readTaskGraph,
  taskGraphBranchRef,
  taskGraphIntegrationBranchRef,
  taskGraphIntegrationWorktreePath,
  taskGraphWorktreePath,
} from '../skills/coordinate-agents/scripts/task-graph-runtime.mjs';
import { readRuntimeEvents } from '../skills/coordinate-agents/scripts/runtime-events.mjs';

const canonicalTmpdir = realpathSync(tmpdir());
const busTool = resolve('skills/coordinate-agents/scripts/agent-bus.mjs');

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
}

function repository() {
  const root = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-graph-gate-'));
  execFileSync('git', ['init', root], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Coordinate Test'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root, stdio: 'ignore', windowsHide: true });
  writeFileSync(join(root, 'tracked.txt'), 'committed baseline\n', 'utf8');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['commit', '-m', 'Initial acceptance fixture'], { cwd: root, stdio: 'ignore', windowsHide: true });
  return root;
}

function graph(parentTaskId) {
  return {
    schemaVersion: 1,
    parentTask: {
      id: parentTaskId,
      title: 'Prove the complete Task Graph acceptance path',
      planner: 'codex',
      reviewer: 'codex',
    },
    subtasks: [
      { id: 'alpha', implementer: 'antigravity', spec: 'Implement the alpha acceptance slice.' },
      { id: 'beta', implementer: 'antigravity', spec: 'Implement the beta acceptance slice.' },
      {
        id: 'dependent',
        implementer: 'antigravity',
        spec: 'Implement the dependency-gated acceptance slice.',
        dependsOn: ['alpha', 'beta'],
      },
    ],
    maxConcurrency: 2,
  };
}

function acceptanceImplementer(repositoryRoot) {
  const bin = join(repositoryRoot, 'fixture bin');
  mkdirSync(bin, { recursive: true });
  const source = String.raw`const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('graph-gate-fixture 1.0.0'); process.exit(0); }
const prompt = args.join(' ');
const parentTaskId = (prompt.match(/Parent Task ID:\s*(task-[A-Za-z0-9_-]+)/) || [])[1];
const subtaskId = (prompt.match(/Subtask ID:\s*([a-z0-9_-]+)/) || [])[1];
if (!parentTaskId || !subtaskId) { process.stderr.write('missing graph identity'); process.exit(10); }
const shared = process.env.GRAPH_GATE_SHARED;
const parentRoot = process.env.GRAPH_GATE_ROOT;
if (!shared || !parentRoot) { process.stderr.write('missing fixture scope'); process.exit(11); }
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const waitFor = (predicate, message) => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    sleep(25);
  }
  process.stderr.write(message);
  process.exit(12);
};
const marker = name => path.join(shared, name);
try { fs.writeFileSync(marker(subtaskId + '.started'), String(Date.now()), { encoding: 'utf8', flag: 'wx' }); }
catch { process.stderr.write('duplicate launch: ' + subtaskId); process.exit(13); }
const graphPath = path.join(parentRoot, '.agent-bus', 'task-graphs', parentTaskId + '.json');
if (subtaskId === 'alpha' || subtaskId === 'beta') {
  waitFor(
    () => fs.existsSync(marker('alpha.started')) && fs.existsSync(marker('beta.started')),
    'parallel start barrier was not reached',
  );
  const stored = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const dependent = stored.subtasks.find(item => item.id === 'dependent');
  if (!dependent || dependent.state !== 'WAITING') {
    process.stderr.write('dependent escaped WAITING during prerequisites');
    process.exit(14);
  }
  fs.writeFileSync(marker(subtaskId + '.observed'), dependent.state, 'utf8');
  waitFor(
    () => fs.existsSync(marker('alpha.observed')) && fs.existsSync(marker('beta.observed')),
    'parallel observation barrier was not reached',
  );
} else if (subtaskId === 'dependent') {
  const stored = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
  const prerequisites = stored.subtasks.filter(item => item.id === 'alpha' || item.id === 'beta');
  if (prerequisites.length !== 2 || prerequisites.some(item => item.state !== 'SUCCEEDED')) {
    process.stderr.write('dependent launched before durable prerequisite success');
    process.exit(15);
  }
  if (!fs.existsSync(marker('alpha.done')) || !fs.existsSync(marker('beta.done'))) {
    process.stderr.write('dependent launched before prerequisite evidence markers');
    process.exit(16);
  }
}
const product = 'product-' + subtaskId + '.txt';
fs.writeFileSync(product, 'Implemented ' + subtaskId + '\n', 'utf8');
cp.execFileSync('git', ['add', product], { stdio: 'ignore', windowsHide: true });
cp.execFileSync('git', ['commit', '-m', 'Implement ' + subtaskId], { stdio: 'ignore', windowsHide: true });
const commit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
const sent = cp.spawnSync(process.execPath, [
  ${JSON.stringify(busTool)}, 'send', '--root', process.cwd(),
  '--from', 'antigravity', '--to', 'codex',
  '--type', 'IMPLEMENTATION_DONE', '--subject', 'Completed ' + subtaskId,
  '--dedupe-key', 'gate:' + parentTaskId + ':' + subtaskId,
  '--related-commit', commit,
  '--body', 'Parent Task ID: ' + parentTaskId + '\nSubtask ID: ' + subtaskId + '\nimplementationCommit: ' + commit + '\nEvidence: acceptance fixture passed',
], { encoding: 'utf8', windowsHide: true });
if (sent.status !== 0) {
  process.stderr.write(sent.stderr || sent.stdout || 'completion handoff failed');
  process.exit(sent.status || 17);
}
fs.writeFileSync(marker(subtaskId + '.done'), commit, 'utf8');
process.exit(0);
`;
  const script = join(bin, 'graph-gate-agent.cjs');
  writeFileSync(script, source, 'utf8');
  if (process.platform === 'win32') {
    const command = join(bin, 'graph-gate-agent.cmd');
    writeFileSync(command, `@"${process.execPath}" "${script}" %*\r\n`, 'utf8');
    return command;
  }
  const command = join(bin, 'graph-gate-agent');
  writeFileSync(command, `#!${process.execPath}\n${source}`, 'utf8');
  chmodSync(command, 0o755);
  return command;
}

async function removeTree(path) {
  let lastError = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      if (!existsSync(path)) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }
  if (lastError) throw lastError;
}

function checkoutSnapshot(root) {
  return {
    head: git(root, ['rev-parse', 'HEAD']),
    branch: git(root, ['branch', '--show-current']),
    status: git(root, ['status', '--porcelain']),
    tracked: readFileSync(join(root, 'tracked.txt'), 'utf8'),
    untracked: readFileSync(join(root, 'user-untracked.txt'), 'utf8'),
    remotes: git(root, ['remote']),
    tags: git(root, ['tag', '--list']),
  };
}

test('Task Graph v2.3 gate proves bounded parallel execution, dependency gating, integration, review, and checkout isolation', { timeout: 60_000 }, async () => {
  const root = repository();
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-graph-gate-home-'));
  const shared = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-graph-gate-shared-'));
  const parentTaskId = 'task-graph-gate';
  const previous = {
    home: process.env.COORDINATE_AGENTS_HOME,
    shared: process.env.GRAPH_GATE_SHARED,
    root: process.env.GRAPH_GATE_ROOT,
  };
  let cleanupAttempted = false;
  try {
    process.env.COORDINATE_AGENTS_HOME = home;
    process.env.GRAPH_GATE_SHARED = shared;
    process.env.GRAPH_GATE_ROOT = root;
    const command = acceptanceImplementer(root);
    await runtimeSetupConfigure({
      root,
      agent: 'antigravity',
      command,
      adapter: 'generic-cli',
      args: ['{prompt}'],
      role: 'implementer',
    });
    await runtimeTaskGraphCreate({ root, graph: graph(parentTaskId) });
    const baseCommit = captureGraphBaseCommit(root);
    writeFileSync(join(root, 'tracked.txt'), 'user tracked modification\n', 'utf8');
    writeFileSync(join(root, 'user-untracked.txt'), 'user untracked work\n', 'utf8');
    const checkout = checkoutSnapshot(root);

    const beforePlanEvents = readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length;
    const firstPlan = await runtimeTaskGraphPlan({ root, taskId: parentTaskId });
    const repeatedPlan = await runtimeTaskGraphPlan({ root, taskId: parentTaskId });
    assert.deepEqual(repeatedPlan, firstPlan);
    assert.deepEqual(firstPlan.plan.eligible.map(item => item.subtaskId), ['alpha', 'beta']);
    assert.equal(firstPlan.plan.decisions.find(item => item.subtaskId === 'dependent').decision, 'WAITING');
    assert.equal(readRuntimeEvents(root, { taskId: parentTaskId, limit: 100 }).length, beforePlanEvents);
    assert.equal(existsSync(join(root, '.agent-bus', 'worktrees')), false);
    assert.deepEqual(checkoutSnapshot(root), checkout);

    const firstRun = await runtimeTaskGraphRun({ root, taskId: parentTaskId, sessionWaitMs: 10_000 });
    assert.deepEqual(firstRun.selected, ['alpha', 'beta']);
    assert.deepEqual(firstRun.summary, { selected: 2, succeeded: 2, running: 0, failed: 0 });
    assert.equal(firstRun.outcomes.every(outcome => outcome.ok && outcome.state === 'SUCCEEDED'), true);
    assert.equal(new Set(firstRun.outcomes.map(outcome => outcome.worktree.path)).size, 2);
    assert.equal(new Set(firstRun.outcomes.map(outcome => outcome.worktree.ref)).size, 2);
    assert.equal(new Set(firstRun.outcomes.map(outcome => outcome.session.id)).size, 2);
    assert.equal(firstRun.outcomes.every(outcome => outcome.worktree.baseCommit === baseCommit), true);
    assert.equal(existsSync(join(shared, 'alpha.observed')), true);
    assert.equal(existsSync(join(shared, 'beta.observed')), true);
    assert.equal(existsSync(join(shared, 'dependent.started')), false);
    assert.deepEqual(firstRun.frontier.ready, ['dependent']);
    assert.deepEqual(checkoutSnapshot(root), checkout);

    const secondPlan = await runtimeTaskGraphPlan({ root, taskId: parentTaskId });
    assert.deepEqual(secondPlan.plan.eligible.map(item => item.subtaskId), ['dependent']);
    const secondRun = await runtimeTaskGraphRun({ root, taskId: parentTaskId, sessionWaitMs: 10_000 });
    assert.deepEqual(secondRun.selected, ['dependent']);
    assert.deepEqual(secondRun.summary, { selected: 1, succeeded: 1, running: 0, failed: 0 });
    assert.equal(existsSync(join(shared, 'dependent.done')), true);
    const completed = readTaskGraph(root, parentTaskId);
    assert.equal(completed.subtasks.every(subtask => subtask.state === 'SUCCEEDED'), true);
    for (const subtask of completed.subtasks) {
      assert.match(subtask.implementationCommit, /^[0-9a-f]{40}$/);
      assert.ok(subtask.evidence.some(item => item.relatedCommit === subtask.implementationCommit));
      assert.equal(git(root, ['rev-parse', taskGraphBranchRef(parentTaskId, subtask.id)]), subtask.implementationCommit);
    }
    assert.deepEqual(checkoutSnapshot(root), checkout);

    const integrated = await runtimeTaskGraphIntegrate({ root, taskId: parentTaskId });
    assert.equal(integrated.integration.state, 'SUCCEEDED');
    assert.deepEqual(integrated.integration.appliedSubtasks, ['alpha', 'beta', 'dependent']);
    assert.deepEqual(integrated.integration.diff.files, [
      'product-alpha.txt',
      'product-beta.txt',
      'product-dependent.txt',
    ]);
    assert.equal(integrated.integration.baseCommit, baseCommit);
    assert.equal(git(root, ['rev-parse', taskGraphIntegrationBranchRef(parentTaskId)]), integrated.integration.aggregateCommit);
    assert.equal((await runtimeTaskGraphIntegrate({ root, taskId: parentTaskId })).idempotent, true);
    assert.deepEqual(checkoutSnapshot(root), checkout);

    const reviewed = await runtimeTaskGraphReview({
      root,
      taskId: parentTaskId,
      decision: 'REVIEW_APPROVED',
      evidence: { checks: ['aggregate diff inspected', 'checkout unchanged'] },
    });
    assert.equal(reviewed.command, 'task.graph-review');
    assert.equal(reviewed.review.decision, 'REVIEW_APPROVED');
    assert.equal(reviewed.graph.state, 'APPROVED');
    assert.equal(reviewed.review.integrationCommit, integrated.integration.aggregateCommit);
    const inspected = await runtimeTaskGraphInspect({ root, taskId: parentTaskId });
    assert.equal(inspected.graph.review.decision, 'REVIEW_APPROVED');
    assert.equal(inspected.integrationFacts.clean, true);
    assert.deepEqual(checkoutSnapshot(root), checkout);

    const cleaned = await runtimeTaskGraphCleanup({ root, taskId: parentTaskId });
    cleanupAttempted = true;
    assert.equal(cleaned.integrationCleanup.status, 'CLEANED');
    assert.equal(cleaned.outcomes.every(outcome => outcome.status === 'CLEANED'), true);
    for (const id of ['alpha', 'beta', 'dependent']) {
      assert.equal(existsSync(taskGraphWorktreePath(root, parentTaskId, id)), false);
    }
    assert.equal(existsSync(taskGraphIntegrationWorktreePath(root, parentTaskId)), false);
    assert.equal(git(root, ['rev-parse', taskGraphIntegrationBranchRef(parentTaskId)]), integrated.integration.aggregateCommit);
    const repeatedCleanup = await runtimeTaskGraphCleanup({ root, taskId: parentTaskId });
    assert.equal(repeatedCleanup.integrationCleanup.idempotent, true);
    assert.equal(repeatedCleanup.outcomes.every(outcome => outcome.idempotent), true);
    assert.deepEqual(checkoutSnapshot(root), checkout);
  } finally {
    if (!cleanupAttempted) {
      try { await runtimeTaskGraphCleanup({ root, taskId: parentTaskId, timeoutMs: 1_000 }); } catch { /* Best effort fixture cleanup. */ }
    }
    try { execFileSync('git', ['worktree', 'prune'], { cwd: root, stdio: 'ignore', windowsHide: true }); } catch { /* Best effort fixture cleanup. */ }
    await removeTree(root);
    await removeTree(home);
    await removeTree(shared);
    if (previous.home === undefined) delete process.env.COORDINATE_AGENTS_HOME;
    else process.env.COORDINATE_AGENTS_HOME = previous.home;
    if (previous.shared === undefined) delete process.env.GRAPH_GATE_SHARED;
    else process.env.GRAPH_GATE_SHARED = previous.shared;
    if (previous.root === undefined) delete process.env.GRAPH_GATE_ROOT;
    else process.env.GRAPH_GATE_ROOT = previous.root;
  }
});
