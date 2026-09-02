import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { startWorkspace } from '../inspector/server/server.mjs';
import { ACTION_ENDPOINT } from '../inspector/server/action-gateway.mjs';

const root = process.cwd();
const cli = join(root, 'bin', 'coordinate-agents.mjs');
const busTool = join(root, 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');
const canonicalTmpdir = realpathSync(tmpdir());

function git(directory, args) {
  const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function repository() {
  const repo = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-web-gate-'));
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.name', 'Web Gate']);
  git(repo, ['config', 'user.email', 'gate@example.invalid']);
  writeFileSync(join(repo, 'tracked.txt'), 'committed baseline\n', 'utf8');
  git(repo, ['add', 'tracked.txt']);
  git(repo, ['commit', '-qm', 'web gate baseline']);
  const init = spawnSync(process.execPath, [busTool, 'init', '--root', repo], { encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return repo;
}

function graph(parentTaskId) {
  return {
    schemaVersion: 1,
    parentTask: {
      id: parentTaskId,
      title: 'Web acceptance graph',
      spec: 'Prove the complete local browser workflow over the guarded gateway.',
      planner: 'codex',
      reviewer: 'codex',
    },
    subtasks: [
      { id: 'alpha', implementer: 'antigravity', spec: 'Implement alpha slice.', dependsOn: [] },
      { id: 'beta', implementer: 'antigravity', spec: 'Implement beta slice.', dependsOn: [] },
    ],
    maxConcurrency: 2,
  };
}

function implementerScript(repositoryRoot) {
  const bin = join(repositoryRoot, 'fixture-bin');
  mkdirSync(bin, { recursive: true });
  const source = String.raw`const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('web-gate-fixture 1.0.0'); process.exit(0); }
const prompt = args.join(' ');
const parentTaskId = (prompt.match(/Parent Task ID:\s*(task-[A-Za-z0-9_-]+)/) || [])[1];
const subtaskId = (prompt.match(/Subtask ID:\s*([a-z0-9_-]+)/) || [])[1];
if (!parentTaskId || !subtaskId) { process.stderr.write('missing graph identity in prompt'); process.exit(10); }
const product = 'product-' + subtaskId + '.txt';
fs.writeFileSync(product, 'Implemented ' + subtaskId + '\n', 'utf8');
cp.execFileSync('git', ['add', product], { stdio: 'ignore', windowsHide: true });
cp.execFileSync('git', ['commit', '-m', 'Implement ' + subtaskId], { stdio: 'ignore', windowsHide: true });
const commit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
const sent = cp.spawnSync(process.execPath, [
  ${JSON.stringify(busTool)}, 'send', '--root', process.cwd(),
  '--from', 'antigravity', '--to', 'codex',
  '--type', 'IMPLEMENTATION_DONE', '--subject', 'Completed ' + subtaskId,
  '--dedupe-key', 'web-gate:' + parentTaskId + ':' + subtaskId,
  '--related-commit', commit,
  '--body', 'Parent Task ID: ' + parentTaskId + '\nSubtask ID: ' + subtaskId + '\nimplementationCommit: ' + commit + '\nEvidence: web gate passed',
], { encoding: 'utf8', windowsHide: true });
if (sent.status !== 0) { process.stderr.write(sent.stderr || sent.stdout || 'completion handoff failed'); process.exit(sent.status || 17); }
process.exit(0);
`;
  const script = join(bin, 'web-gate-agent.cjs');
  writeFileSync(script, source, 'utf8');
  if (process.platform === 'win32') {
    const command = join(bin, 'web-gate-agent.cmd');
    writeFileSync(command, '@"' + process.execPath + '" "' + script + '" %*\r\n', 'utf8');
    return command;
  }
  const command = join(bin, 'web-gate-agent');
  writeFileSync(command, '#!' + process.execPath + '\n' + source, 'utf8');
  chmodSync(command, 0o755);
  return command;
}

async function safeRm(directory) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(directory, { recursive: true, force: true });
      return;
    } catch {
      await new Promise(resolvePromise => setTimeout(resolvePromise, 250));
    }
  }
}

function checkoutState(repo) {
  return {
    head: git(repo, ['rev-parse', 'HEAD']),
    status: git(repo, ['status', '--porcelain']),
    tracked: readFileSync(join(repo, 'tracked.txt'), 'utf8'),
    remotes: git(repo, ['remote']),
    tags: git(repo, ['tag', '--list']),
  };
}

async function capabilityFromPage(url) {
  const page = await (await fetch(url)).text();
  return (page.match(/name="coordinate-agents-capability" content="([^"]+)"/) || [])[1];
}

test('Web acceptance gate: complete local browser workflow over the guarded gateway (#53)', { timeout: 90_000 }, async () => {
  const repo = repository();
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-web-gate-home-'));
  const previous = {
    home: process.env.COORDINATE_AGENTS_HOME,
    path: process.env.PATH,
  };
  let started = null;
  try {
    mkdirSync(join(home, '.coordinate-agents'), { recursive: true });
    writeFileSync(join(home, '.coordinate-agents', 'config.json'), JSON.stringify({ version: 1, agents: {} }), 'utf8');
    const command = implementerScript(repo);
    process.env.COORDINATE_AGENTS_HOME = home;
    const originalPath = process.env.PATH || '';
    process.env.PATH = [join(repo, 'fixture-bin'), originalPath].filter(Boolean).join(delimiter);

    started = await startWorkspace({ root: repo, port: 0 });
    const base = started.url;
    const capability = await capabilityFromPage(base);
    assert.ok(capability, 'Workspace serves its per-launch capability without a Plugin or network call');
    const post = payload => fetch(base + ACTION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-coordinate-agents-capability': capability },
      body: JSON.stringify(payload),
    });
    const read = async response => ({ status: response.status, payload: await response.json() });
    const ensureOk = async (action, params) => {
      const result = await read(await post({ action, params }));
      assert.equal(result.payload.ok, true, action + ' must succeed: ' + JSON.stringify(result.payload.error || {}));
      return result.payload;
    };

    // Authoring: create the graph through the guarded gateway.
    const parentTaskId = 'task-web-gate-graph';
    await ensureOk('taskGraphCreate', { graph: graph(parentTaskId) });

    // Guarded configuration of a fake local Agent over generic-cli.
    const configure = await ensureOk('setupConfigure', {
      agent: 'antigravity',
      command,
      adapter: 'generic-cli',
      role: 'implementer',
      args: ['{prompt}'],
    });
    assert.equal(configure.agent.commandSource, 'user');

    // Side-effect-free preflight.
    const eventsBeforePlan = readdirSync(join(repo, '.agent-bus', 'events')).length;
    const plan = await ensureOk('taskGraphPlan', { taskId: parentTaskId });
    assert.deepEqual(plan.plan.eligible.map(item => item.subtaskId).sort(), ['alpha', 'beta']);
    assert.equal(readdirSync(join(repo, '.agent-bus', 'events')).length, eventsBeforePlan, 'Preflight must not emit events');
    assert.equal(existsSync(join(repo, '.agent-bus', 'worktrees')), false, 'Preflight must not create worktrees');

    // Explicit run executes the eligible wave with the fake Agent and returns
    // durable identity facts; Sessions and the Event Journal update.
    const checkoutBefore = checkoutState(repo);
    const run = await ensureOk('taskGraphRun', { taskId: parentTaskId, sessionWaitMs: 10_000 });
    assert.ok(run.wavesExecuted >= 1 || Array.isArray(run.selected), 'Run reports executed waves');
    const detailAfterRun = await (await fetch(base + '/api/graphs/' + parentTaskId)).json();
    assert.equal(detailAfterRun.state, 'REVIEWING', 'Completed work parks the graph in REVIEWING until review');
    assert.deepEqual(detailAfterRun.subtasks.map(item => item.state), ['SUCCEEDED', 'SUCCEEDED']);
    assert.ok(detailAfterRun.subtasks.every(item => item.implementationCommit), 'Subtasks expose implementation commits');
    const sessions = await (await fetch(base + '/api/sessions')).json();
    assert.ok(Array.isArray(sessions), 'Sessions are observable after work');

    // The user checkout is untouched while Runtime-owned worktrees exist.
    const worktrees = join(repo, '.agent-bus', 'worktrees');
    assert.equal(existsSync(worktrees), true, 'Runtime worktrees exist after execution');
    const checkoutAfterRun = checkoutState(repo);
    assert.deepEqual(checkoutAfterRun, checkoutBefore, 'Execution must not mutate the user checkout or refs');

    // Explicit integration into the Runtime-owned aggregate review worktree.
    const integrate = await ensureOk('taskGraphIntegrate', { taskId: parentTaskId });
    assert.ok(integrate.integration && integrate.integration.aggregateCommit, 'Integration records the aggregate commit');
    assert.deepEqual(checkoutState(repo), checkoutBefore, 'Integration must not touch the user checkout');

    // Record review; durable and visible after a refresh of the authoritative record.
    await ensureOk('taskGraphReview', { taskId: parentTaskId, decision: 'REVIEW_APPROVED', feedback: 'Web gate evidence verified.' });
    const reviewed = await (await fetch(base + '/api/graphs/' + parentTaskId)).json();
    assert.equal(reviewed.review.decision, 'REVIEW_APPROVED');
    assert.equal(reviewed.status, 'APPROVED');

    // Runtime-owned cleanup removes only owned worktrees; user state stays intact.
    await ensureOk('taskGraphCleanup', { taskId: parentTaskId });
    const worktreeBase = join(repo, '.agent-bus', 'worktrees', parentTaskId);
    for (const subtaskId of ['alpha', 'beta']) {
      assert.equal(existsSync(join(worktreeBase, subtaskId)), false, 'Cleanup removes each Runtime-owned subtask worktree');
    }
    assert.equal(existsSync(join(worktreeBase, '__integration__')), false, 'Cleanup removes the Runtime-owned integration worktree');
    assert.deepEqual(checkoutState(repo), checkoutBefore, 'Cleanup must not mutate the user checkout or refs');

    // GET/read/SSE surfaces stay side-effect free through the whole run.
    const journal = readFileSync(join(repo, '.agent-bus', 'events', 'runtime.jsonl'), 'utf8');
    assert.ok(journal.includes('TASK_GRAPH_CREATED'));
    assert.ok(journal.includes('IMPLEMENTATION_DONE'));
    const fresh = await (await fetch(base + '/api/repository')).json();
    assert.ok(fresh.root);

    // Release-boundary guard: no remote, tag, push, or release artifact exists.
    assert.equal(checkoutState(repo).remotes, '', 'No remote must be configured or pushed by the Workspace');
    assert.equal(checkoutState(repo).tags, '', 'No tags may be created by the Workspace');
  } finally {
    if (started) {
      started.server.closeAllConnections?.();
      await new Promise(resolvePromise => started.server.close(resolvePromise));
    }
    process.env.COORDINATE_AGENTS_HOME = previous.home;
    process.env.PATH = previous.path;
    await safeRm(repo);
    await safeRm(home);
  }
});

test('Web acceptance gate: incompatible roots and read-only guarantees stay closed (#53)', async () => {
  const plain = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-web-gate-plain-'));
  try {
    assert.throws(() => startWorkspace({ root: plain, port: 0 }), /initialized Git repository/);
    const repo = repository();
    try {
      const started = await startWorkspace({ root: repo, port: 0 });
      try {
        // Capability-less actions and non-loopback origins are rejected.
        const capability = await capabilityFromPage(started.url);
        const attempt = await fetch(started.url + ACTION_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'taskCreate', params: { title: 'x' } }),
        });
        assert.equal(attempt.status, 401);
        const originAttempt = await fetch(started.url + ACTION_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-coordinate-agents-capability': capability, Origin: 'https://evil.example' },
          body: JSON.stringify({ action: 'taskCreate', params: { title: 'x' } }),
        });
        assert.equal(originAttempt.status, 403);

        // Read paths remain side-effect free after the rejections.
        const tasksDir = join(repo, '.agent-bus', 'tasks');
        const before = existsSync(tasksDir) ? readdirSync(tasksDir).length : 0;
        await fetch(started.url + '/api/tasks');
        await fetch(started.url + '/api/events?limit=50');
        const after = existsSync(tasksDir) ? readdirSync(tasksDir).length : 0;
        assert.equal(before, after);
      } finally {
        started.server.closeAllConnections?.();
        await new Promise(resolvePromise => started.server.close(resolvePromise));
      }
    } finally {
      await safeRm(repo);
    }
  } finally {
    await safeRm(plain);
  }
});

test('Web acceptance gate: CLI entry remains documented and help-consistent (#53)', () => {
  const help = spawnSync(process.execPath, [cli, 'help', '--lang', 'en'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /web\s+Launch the local Web Workspace over the selected Git repository/);
  assert.match(help.stdout, /inspector\s+Start the local read-only Web UI Inspector/);
});
