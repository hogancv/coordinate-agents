import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
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
import { basename, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { createTask, setTaskStatus } from '../skills/coordinate-agents/scripts/task-runtime.mjs';
import { createTaskGraph } from '../skills/coordinate-agents/scripts/task-graph-runtime.mjs';
import { startWorkspace } from '../inspector/server/server.mjs';
import { COMPOSER_TITLE_MAX, deriveComposerParams } from '../inspector/web-workspace/composer-model.mjs';

const root = process.cwd();
const cli = join(root, 'bin', 'coordinate-agents.mjs');
const busTool = join(root, 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');

function git(repositoryRoot, args) {
  const result = spawnSync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function repository() {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'coordinate-agents-workspace-'));
  git(repositoryRoot, ['init', '-q']);
  git(repositoryRoot, ['config', 'user.email', 'workspace-test@example.com']);
  git(repositoryRoot, ['config', 'user.name', 'Workspace Test']);
  writeFileSync(join(repositoryRoot, 'README.md'), '# Workspace fixture\n', 'utf8');
  git(repositoryRoot, ['add', '-A']);
  git(repositoryRoot, ['commit', '-qm', 'chore: workspace fixture baseline']);
  const init = spawnSync(process.execPath, [busTool, 'init', '--root', repositoryRoot], { encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return realpathSync(repositoryRoot);
}

function taskFixture(repositoryRoot) {
  const task = createTask(repositoryRoot, {
    id: 'task-workspace',
    title: 'Build Workspace fixture',
    spec: 'Show the local control plane without changing Runtime state.',
  });
  setTaskStatus(repositoryRoot, task.id, 'PLANNING');
  setTaskStatus(repositoryRoot, task.id, 'SPEC_READY');
  return repositoryRoot;
}

function graphFixture(repositoryRoot) {
  createTaskGraph(repositoryRoot, {
    schemaVersion: 1,
    parentTask: {
      id: 'task-workspace-graph',
      title: 'Build Graph Workspace fixture',
      spec: 'Demonstrate persisted Task Graph readability in the Workspace.',
      planner: 'codex',
      reviewer: 'codex',
    },
    subtasks: [
      { id: 'sub-a', implementer: 'antigravity', spec: 'Implement component A.', dependsOn: [] },
      { id: 'sub-b', implementer: 'codex', spec: 'Implement component B.', dependsOn: ['sub-a'] },
    ],
    maxConcurrency: 1,
  }, {
    configuredAgents: [{ id: 'codex', adapter: 'codex-cli' }, { id: 'antigravity', adapter: 'generic-cli' }],
  });
  return repositoryRoot;
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const port = server.address().port;
  await new Promise(resolvePromise => server.close(resolvePromise));
  return port;
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise(resolvePromise => server.close(resolvePromise));
}

test('Web Workspace renders the bound Git repository identity and the read-only project overview', async () => {
  const repositoryRoot = taskFixture(repository());
  graphFixture(repositoryRoot);
  const expectedBranch = git(repositoryRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const started = await startWorkspace({ root: repositoryRoot, port: 0 });
  try {
    assert.equal(started.server.address().address, '127.0.0.1');
    assert.equal(started.url, `http://localhost:${started.port}`);

    const page = await (await fetch(`${started.url}/`)).text();
    assert.match(page, /Coordinate Agents Workspace/);
    assert.match(page, /BOUND REPOSITORY/);
    assert.match(page, /id="repository"/);
    assert.match(page, /id="repo-name"/);
    assert.match(page, /id="repo-branch"/);
    assert.match(page, /Task Graph topology/);

    const repositoryFacts = await (await fetch(`${started.url}/api/repository`)).json();
    assert.equal(repositoryFacts.root, repositoryRoot);
    assert.equal(repositoryFacts.name, basename(repositoryRoot));
    assert.equal(repositoryFacts.branch, expectedBranch);
    assert.equal(repositoryFacts.detached, false);
    assert.ok(repositoryFacts.head);
    assert.match(repositoryFacts.head.short, /^[0-9a-f]{4,}$/);
    assert.equal(repositoryFacts.head.subject, 'chore: workspace fixture baseline');
    assert.equal(repositoryFacts.remoteUrl, null);
    assert.equal(repositoryFacts.error, undefined);

    const tasks = await (await fetch(`${started.url}/api/tasks`)).json();
    assert.equal(tasks.length, 2);
    assert.ok(tasks.some(item => item.id === 'task-workspace' && item.graph === false));
    const graphParent = tasks.find(item => item.graph === true);
    assert.ok(graphParent, 'Task Graph parent must appear in the Workspace overview');
    assert.equal(graphParent.id, 'task-workspace-graph');
    assert.equal(graphParent.subtaskCount, 2);

    // Persisted #36 Task Graph records remain readable through the Workspace.
    const graphDetail = await (await fetch(`${started.url}/api/tasks/task-workspace-graph`)).json();
    assert.equal(graphDetail.graph, true);
    assert.equal(graphDetail.subtasks.length, 2);
    assert.deepEqual(graphDetail.subtasks.find(item => item.id === 'sub-b').dependsOn, ['sub-a']);

    const js = await (await fetch(`${started.url}/app.js`)).text();
    assert.match(js, /renderRepository/);
    assert.match(js, /\/api\/repository/);
    const css = await (await fetch(`${started.url}/styles.css`)).text();
    assert.match(css, /\.repository-panel/);
    assert.match(css, /\.repo-facts/);

    const mutation = await fetch(`${started.url}/api/repository`, { method: 'POST' });
    assert.equal(mutation.status, 405);
    assert.equal(mutation.headers.get('allow'), 'GET');
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('coordinate-agents web CLI starts the localhost Workspace on a selected port', async () => {
  const repositoryRoot = taskFixture(repository());
  const port = await freePort();
  const child = spawn(process.execPath, [cli, 'web', '--root', repositoryRoot, '--port', `${port}`], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  const started = new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Workspace CLI did not start. stdout=${stdout} stderr=${stderr}`)), 8_000);
    child.stdout.on('data', chunk => {
      stdout += `${chunk}`;
      if (stdout.includes(`http://localhost:${port}`)) {
        clearTimeout(timeout);
        resolvePromise();
      }
    });
    child.stderr.on('data', chunk => { stderr += `${chunk}`; });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  try {
    await started;
    const page = await (await fetch(`http://localhost:${port}/`)).text();
    assert.match(page, /Coordinate Agents Workspace/);
    const repositoryFacts = await (await fetch(`http://localhost:${port}/api/repository`)).json();
    assert.equal(repositoryFacts.root, repositoryRoot);
    const tasks = await (await fetch(`http://localhost:${port}/api/tasks`)).json();
    assert.equal(tasks[0].id, 'task-workspace');
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Web Workspace page loads, task selection, and event reads stay strictly read-only', async () => {
  const repositoryRoot = taskFixture(repository());
  graphFixture(repositoryRoot);
  const started = await startWorkspace({ root: repositoryRoot, port: 0 });
  try {
    function snapshotDir(directory) {
      const entries = [];
      function walk(current) {
        if (!existsSync(current)) return;
        for (const name of readdirSync(current).sort()) {
          const full = join(current, name);
          entries.push(full.slice(directory.length));
          try {
            const stat = readFileSync(full);
            entries.push(stat.byteLength);
          } catch {
            walk(full);
          }
        }
      }
      walk(directory);
      return entries;
    }

    const before = snapshotDir(join(repositoryRoot, '.agent-bus'));

    await fetch(`${started.url}/api/repository`);
    await fetch(`${started.url}/api/tasks`);
    await fetch(`${started.url}/api/tasks/task-workspace`);
    await fetch(`${started.url}/api/tasks/task-workspace-graph`);
    await fetch(`${started.url}/api/agents`);
    await fetch(`${started.url}/api/sessions`);
    await fetch(`${started.url}/api/events?limit=100`);
    await fetch(`${started.url}/api/events/stream`, { signal: AbortSignal.timeout(150) }).catch(() => {});

    const after = snapshotDir(join(repositoryRoot, '.agent-bus'));
    assert.deepEqual(before, after, 'Workspace reads must not create Bus files, Sessions, events, or state transitions');

    const porcelain = spawnSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
    assert.equal(porcelain.status, 0);
    assert.equal(porcelain.stdout.trim(), '', 'Workspace reads must not dirty the Git worktree');
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Web Workspace fails closed for non-Git, missing, and uncommitted-unsafe entry points', async () => {
  const repositoryRoot = taskFixture(repository());
  const plainDirectory = mkdtempSync(join(tmpdir(), 'coordinate-agents-workspace-plain-'));
  try {
    // Direct server entry requires an initialized Git repository.
    assert.throws(() => startWorkspace({ root: plainDirectory, port: 0 }), /initialized Git repository/);
    assert.throws(() => startWorkspace({ root: join(plainDirectory, 'missing'), port: 0 }), /initialized Git repository/);

    // CLI entry fails closed with the documented repository error.
    for (const badRoot of [plainDirectory, join(plainDirectory, 'missing')]) {
      const result = spawnSync(process.execPath, [cli, 'web', '--root', badRoot], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      });
      assert.equal(result.status, 1, badRoot);
      assert.match(result.stderr || result.stdout, /Not a Git repository/);
    }
  } finally {
    rmSync(repositoryRoot, { recursive: true, force: true });
    rmSync(plainDirectory, { recursive: true, force: true });
  }
});

test('Web Workspace ships the interactive Task Graph map over authoritative graph facts (#47)', async () => {
  const repositoryRoot = graphFixture(taskFixture(repository()));
  const started = await startWorkspace({ root: repositoryRoot, port: 0 });
  try {
    const page = await (await fetch(`${started.url}/`)).text();
    assert.match(page, /id="graph-map-region"/);
    assert.match(page, /id="graph-map"/);
    assert.match(page, /id="graph-map-note"/);
    assert.match(page, /id="graph-legend"/);
    assert.match(page, /id="graph-node-detail"/);
    assert.match(page, /Interactive Task Graph dependency map/);

    const js = await (await fetch(`${started.url}/app.js`)).text();
    for (const expected of ['renderGraphMap', 'graphNodeLevels', 'renderGraphNodeDetail', 'renderGraphLegend',
      'GRAPH_MAP_MAX_NODES', 'data-subtask', 'graph-map-edge', 'graph-map-node']) {
      assert.ok(js.includes(expected), `Workspace app.js must expose graph map support: ${expected}`);
    }

    const css = await (await fetch(`${started.url}/styles.css`)).text();
    for (const expected of ['.graph-map-region', '.graph-map-canvas', '.graph-map-node', '.graph-map-edge', '.graph-node-detail', '.graph-legend']) {
      assert.ok(css.includes(expected), `Workspace styles.css must style graph map elements: ${expected}`);
    }

    // The map consumes the bounded authoritative graph detail API; facts are
    // not invented in the browser.
    const detail = await (await fetch(`${started.url}/api/graphs/task-workspace-graph`)).json();
    assert.equal(detail.graph, true);
    assert.ok(detail.subtasks.length >= 2);
    for (const subtask of detail.subtasks) {
      assert.ok(typeof subtask.implementer === 'string');
      assert.ok(subtask.agent && typeof subtask.agent.adapter === 'string');
    }
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Workspace metadata ships in the package payload, CLI help, and web assets directory', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(packageJson.files.includes('inspector'));
  assert.ok(existsSync(join(root, 'inspector', 'web-workspace', 'index.html')));
  assert.ok(existsSync(join(root, 'inspector', 'web-workspace', 'app.js')));
  assert.ok(existsSync(join(root, 'inspector', 'web-workspace', 'styles.css')));
  const help = spawnSync(process.execPath, [cli, 'help', '--lang', 'en'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /web\s+Launch the local Web Workspace over the selected Git repository/);
  assert.match(help.stdout, /inspector\s+Start the local read-only Web UI Inspector/);
});

test('chat composer keeps the full single-line input as the Task spec', () => {
  // Regression: a single-line prompt previously lost its spec entirely.
  const single = deriveComposerParams('Fix the login redirect');
  assert.equal(single.title, 'Fix the login redirect');
  assert.equal(single.spec, 'Fix the login redirect');
  assert.equal(single.firstLine, single.title);
});

test('chat composer writes multi-line input whole and truncates only the title safely', () => {
  const multi = deriveComposerParams('  First line title\n\nSecond paragraph with details.\nThird line.  ');
  assert.equal(multi.title, 'First line title');
  assert.equal(multi.spec, 'First line title\n\nSecond paragraph with details.\nThird line.');
  assert.equal(multi.firstLine, 'First line title');
  assert.ok(multi.spec.length > multi.title.length, 'the spec is never truncated');

  const longLine = 'x'.repeat(COMPOSER_TITLE_MAX + 40);
  const truncated = deriveComposerParams(longLine);
  assert.equal(truncated.title.length, COMPOSER_TITLE_MAX);
  assert.equal(truncated.spec, longLine, 'spec must stay intact when the title is shortened');
  assert.equal(truncated.title, longLine.slice(0, COMPOSER_TITLE_MAX));

  assert.equal(deriveComposerParams('   \n  '), null, 'blank composer input creates nothing');
});

test('Workspace serves the composer model module for the browser bundle', async () => {
  const repositoryRoot = taskFixture(repository());
  const started = await startWorkspace({ root: repositoryRoot, port: 0 });
  try {
    const response = await fetch(`${started.url}/composer-model.mjs`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/javascript/);
    const body = await response.text();
    assert.match(body, /export function deriveComposerParams/);
    assert.match(body, /COMPOSER_TITLE_MAX/);
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});
