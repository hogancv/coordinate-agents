import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import http from 'node:http';
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
import { startWorkspace, startInspector } from '../inspector/server/server.mjs';
import { ACTION_ENDPOINT } from '../inspector/server/action-gateway.mjs';

const root = process.cwd();
const cli = join(root, 'bin', 'coordinate-agents.mjs');
const busTool = join(root, 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');

function git(repositoryRoot, args) {
  const result = spawnSync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function repository() {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'coordinate-agents-gateway-'));
  git(repositoryRoot, ['init', '-q']);
  git(repositoryRoot, ['config', 'user.email', 'gateway-test@example.com']);
  git(repositoryRoot, ['config', 'user.name', 'Gateway Test']);
  writeFileSync(join(repositoryRoot, 'README.md'), '# Gateway fixture\n', 'utf8');
  git(repositoryRoot, ['add', '-A']);
  git(repositoryRoot, ['commit', '-qm', 'chore: gateway fixture baseline']);
  const init = spawnSync(process.execPath, [busTool, 'init', '--root', repositoryRoot], { encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return realpathSync(repositoryRoot);
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

function snapshotTasks(directory) {
  const tasks = join(directory, '.agent-bus', 'tasks');
  if (!existsSync(tasks)) return [];
  return readdirSync(tasks).filter(name => name.endsWith('.json')).sort();
}

function rawPost(port, { path = ACTION_ENDPOINT, body = '', headers = {} }) {
  return new Promise((resolvePromise, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolvePromise({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function capabilityFromPage(url) {
  const page = await (await fetch(url)).text();
  const meta = page.match(/name="coordinate-agents-capability" content="([^"]+)"/);
  return meta ? meta[1] : null;
}

test('action gateway rejects unauthorized, malformed, disallowed, and unsafe requests before Runtime side effects', async () => {
  const repositoryRoot = repository();
  const started = await startWorkspace({ root: repositoryRoot, port: 0, maxBodyBytes: 4096 });
  const { url, port, capability } = started;
  try {
    assert.ok(capability);
    const base = url;
    const endpoint = `${base}${ACTION_ENDPOINT}`;
    const post = (body, headers = {}) => fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const readError = async response => {
      const payload = await response.json();
      return { status: response.status, ...payload };
    };

    // Missing and incorrect capability.
    let result = await readError(await post({ action: 'taskCreate', params: { title: 'x' } }));
    assert.equal(result.status, 401);
    assert.equal(result.error.code, 'ACTION_CAPABILITY_REQUIRED');
    result = await readError(await post({ action: 'taskCreate', params: { title: 'x' } }, { 'x-coordinate-agents-capability': 'wrong-capability' }));
    assert.equal(result.status, 401);

    // Disallowed cross-origin request.
    result = await readError(await post({ action: 'taskCreate', params: { title: 'x' } }, {
      'x-coordinate-agents-capability': capability,
      Origin: 'https://evil.example',
    }));
    assert.equal(result.status, 403);
    assert.equal(result.error.code, 'ACTION_ORIGIN_DISALLOWED');

    // Disallowed Host header.
    const raw = await rawPost(port, {
      body: JSON.stringify({ action: 'taskCreate', params: { title: 'x' } }),
      headers: { 'x-coordinate-agents-capability': capability, Host: 'evil.example' },
    });
    assert.equal(raw.status, 403);
    assert.match(raw.body, /ACTION_HOST_DISALLOWED/);

    // Non-JSON content type.
    result = await readError(await fetch(endpoint, {
      method: 'POST',
      headers: { 'x-coordinate-agents-capability': capability, 'Content-Type': 'text/plain' },
      body: 'hello',
    }));
    assert.equal(result.status, 415);
    assert.equal(result.error.code, 'ACTION_CONTENT_TYPE_INVALID');

    // Oversized body.
    const oversized = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-coordinate-agents-capability': capability },
      body: JSON.stringify({ action: 'taskCreate', params: { title: 'x'.repeat(8192) } }),
    });
    assert.equal(oversized.status, 413);

    // Malformed and empty JSON bodies.
    result = await readError(await post('{not json', { 'x-coordinate-agents-capability': capability }));
    assert.equal(result.status, 400);
    assert.equal(result.error.code, 'ACTION_BODY_INVALID');
    result = await readError(await post('', { 'x-coordinate-agents-capability': capability }));
    assert.equal(result.status, 400);

    // Unknown action and unknown parameters.
    result = await readError(await post({ action: 'noSuchAction', params: {} }, { 'x-coordinate-agents-capability': capability }));
    assert.equal(result.status, 404);
    assert.equal(result.error.code, 'ACTION_NOT_ALLOWED');
    result = await readError(await post({ action: 'taskCreate', params: { title: 'x', sneaky: true } }, { 'x-coordinate-agents-capability': capability }));
    assert.equal(result.status, 400);
    assert.equal(result.error.code, 'ACTION_PARAMS_INVALID');

    // Mismatched root is rejected; the bound root is accepted and honored.
    result = await readError(await post({ action: 'taskCreate', params: { title: 'x', root: 'C:/somewhere/else' } }, { 'x-coordinate-agents-capability': capability }));
    assert.equal(result.status, 403);
    assert.equal(result.error.code, 'ACTION_ROOT_MISMATCH');
    result = await readError(await post({ action: 'taskCreate', params: { title: 'Bound root ok', root: repositoryRoot } }, { 'x-coordinate-agents-capability': capability }));
    assert.equal(result.status, 200);
    assert.equal(result.ok, true);

    // Every rejection above is side-effect free: only the one deliberate
    // bound-root action may have created a durable Task record.
    const tasks = snapshotTasks(repositoryRoot);
    assert.equal(tasks.length, 1, 'Rejected gateway requests must not create Tasks');
    assert.match(tasks[0], /^task-[0-9a-f-]+\.json$/);
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('guarded actions preserve Runtime identity, correlation, canonical errors, and deterministic-id replay safety', async () => {
  const repositoryRoot = repository();
  const started = await startWorkspace({ root: repositoryRoot, port: 0 });
  const base = started.url;
  try {
    const capability = await capabilityFromPage(base);
    assert.ok(capability, 'Workspace page must carry the server-issued capability');
    const post = (payload, correlationId) => fetch(`${base}${ACTION_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-coordinate-agents-capability': capability, ...(correlationId ? { 'x-correlation-id': correlationId } : {}) },
      body: JSON.stringify(payload),
    });

    // Deterministic-id create is idempotent: the Runtime rejects replays with
    // TASK_STATE_CONFLICT and a single durable Task record remains.
    const first = await (await post({ action: 'taskCreate', params: { title: 'Replay safe', id: 'task-gateway-replay' } }, 'corr-1')).json();
    assert.equal(first.ok, true);
    assert.equal(first.command, 'task.create');
    assert.equal(first.action, 'taskCreate');
    assert.equal(first.correlation, 'corr-1');
    assert.equal(first.task?.id || first.id, 'task-gateway-replay');

    const replay = await (await post({ action: 'taskCreate', params: { title: 'Replay safe', id: 'task-gateway-replay' } }, 'corr-1')).json();
    assert.equal(replay.ok, false);
    assert.equal(replay.command, 'task.create');
    assert.equal(replay.error.code, 'TASK_STATE_CONFLICT');
    assert.equal(replay.error.recoverable, true);
    assert.equal(replay.correlation, 'corr-1');

    const tasks = snapshotTasks(repositoryRoot);
    assert.deepEqual(tasks, ['task-gateway-replay.json']);

    // Concurrent replays serialize through the Runtime: exactly one Task is
    // durably created and one of the two calls reports the conflict.
    const [concurrentA, concurrentB] = await Promise.all([
      post({ action: 'taskCreate', params: { title: 'Concurrent', id: 'task-gateway-concurrent' } }, 'corr-2'),
      post({ action: 'taskCreate', params: { title: 'Concurrent', id: 'task-gateway-concurrent' } }, 'corr-2'),
    ]);
    const results = [await concurrentA.json(), await concurrentB.json()];
    const okCount = results.filter(item => item.ok === true).length;
    const conflictCount = results.filter(item => item.ok === false && item.error?.code === 'TASK_STATE_CONFLICT').length;
    assert.equal(okCount + conflictCount, 2);
    assert.equal(okCount, 1, 'Exactly one concurrent create may succeed');
    assert.ok(snapshotTasks(repositoryRoot).includes('task-gateway-concurrent.json'));

    // Read actions expose the Runtime identity fields and canonical results.
    const status = await (await post({ action: 'taskStatus', params: { taskId: 'task-gateway-replay' } }, 'corr-3')).json();
    assert.equal(status.ok, true);
    assert.equal(status.correlation, 'corr-3');

    const inspect = await (await post({ action: 'taskInspect', params: { taskId: 'task-gateway-replay' } }, 'corr-4')).json();
    assert.equal(inspect.ok, true);
    assert.equal(inspect.command, 'task.inspect');

    // Unknown Task ids surface canonical Runtime errors, not gateway noise.
    const missing = await (await post({ action: 'taskStatus', params: { taskId: 'task-gateway-missing' } })).json();
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, 'TASK_NOT_FOUND');

    // Graph validation routes to the shared Runtime contract: a valid DAG is
    // accepted and an invalid DAG returns the canonical validation error
    // without creating a graph, worktree, or event.
    const validGraph = {
      schemaVersion: 1,
      parentTask: { id: 'task-gateway-parent', title: 'Parent', planner: 'codex', reviewer: 'codex' },
      subtasks: [{ id: 'sub', implementer: 'antigravity', spec: 'Do it.', dependsOn: [] }],
      maxConcurrency: 1,
    };
    const validated = await (await post({ action: 'taskGraphValidate', params: { graph: validGraph } }, 'corr-5')).json();
    assert.equal(validated.ok, true);
    const invalid = await (await post({ action: 'taskGraphValidate', params: { graph: { ...validGraph, subtasks: [] } } })).json();
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, 'TASK_GRAPH_INVALID');
    assert.equal(existsSync(join(repositoryRoot, '.agent-bus', 'task-graphs', 'task-gateway-parent.json')), false);

    // GET and SSE read paths stay compatible and side-effect free.
    const tasksBefore = readdirSync(join(repositoryRoot, '.agent-bus', 'tasks')).sort();
    await fetch(`${base}/api/tasks`);
    await fetch(`${base}/api/events?limit=20`);
    const tasksAfter = readdirSync(join(repositoryRoot, '.agent-bus', 'tasks')).sort();
    assert.deepEqual(tasksBefore, tasksAfter);
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('action gateway results match the CLI JSON contract for the same operation', async () => {
  const repositoryRoot = repository();
  const started = await startWorkspace({ root: repositoryRoot, port: 0 });
  const base = started.url;
  try {
    const capability = await capabilityFromPage(base);
    const cliResult = spawnSync(process.execPath, [cli, 'task', 'create', '--root', repositoryRoot, '--title', 'CLI parity', '--id', 'task-gateway-cli', '--json'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(cliResult.status, 0, cliResult.stderr);
    const cliPayload = JSON.parse(cliResult.stdout);
    assert.equal(cliPayload.ok, true);
    assert.equal(cliPayload.command, 'task.create');

    const gatewayResponse = await fetch(`${base}${ACTION_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-coordinate-agents-capability': capability },
      body: JSON.stringify({ action: 'taskCreate', params: { title: 'CLI parity', id: 'task-gateway-gw' } }),
    });
    const gatewayPayload = await gatewayResponse.json();
    assert.equal(gatewayPayload.ok, true);
    assert.equal(gatewayPayload.command, cliPayload.command);
    assert.equal(typeof gatewayPayload.ok, typeof cliPayload.ok);
    assert.equal(typeof gatewayPayload.error, typeof cliPayload.error);
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('inspector compatibility mode keeps all non-GET traffic rejected with Allow: GET', async () => {
  const repositoryRoot = repository();
  const started = await startInspector({ root: repositoryRoot, port: 0 });
  try {
    assert.equal(started.actionEndpoint, null);
    for (const endpoint of ['/api/tasks', '/api/repository', ACTION_ENDPOINT]) {
      const response = await fetch(`${started.url}${endpoint}`, { method: 'POST' });
      assert.equal(response.status, 405, `${endpoint} must stay read-only in Inspector mode`);
      assert.equal(response.headers.get('allow'), 'GET');
    }
    const page = await (await fetch(started.url)).text();
    assert.match(page, /Coordinate Agents Inspector/);
    assert.equal(page.includes('coordinate-agents-capability'), false);
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

function writeFakeExecutable(directory, name) {
  if (process.platform === 'win32') {
    // A .cmd wrapper is only a safe entrypoint with a .js/.cjs sibling; tests
    // configure the absolute .cmd path so detection does not depend on where.exe.
    writeFileSync(join(directory, `${name}.cmd`), '@echo off\r\nnode "%~dp0${name}.js" %*\r\n', 'utf8');
    writeFileSync(join(directory, `${name}.js`), 'console.log("1.0.0");\n', 'utf8');
    return join(directory, `${name}.cmd`);
  }
  const path = join(directory, name);
  writeFileSync(path, '#!/bin/sh\necho 1.0.0\n', 'utf8');
  chmodSync(path, 0o755);
  return path;
}

test('setup discovery and transactional Agent configuration work through the guarded gateway (#48)', async () => {
  const repositoryRoot = repository();
  const fakeBin = mkdtempSync(join(tmpdir(), 'coordinate-agents-gateway-bin-'));
  const isolatedHome = mkdtempSync(join(tmpdir(), 'coordinate-agents-gateway-home-'));
  const systemPath = process.platform === 'win32' ? join(process.env.SystemRoot || 'C://Windows', 'System32') : '';
  const originalPath = process.env.PATH;
  const originalHome = process.env.COORDINATE_AGENTS_HOME;
  try {
    writeFakeExecutable(fakeBin, 'claude');
    writeFakeExecutable(fakeBin, 'agy');
    const claudeCommand = process.platform === 'win32' ? join(fakeBin, 'claude.cmd') : join(fakeBin, 'claude');
    const agyProxyCommand = process.platform === 'win32' ? join(fakeBin, 'agy-proxy.cmd') : join(fakeBin, 'agy-proxy');
    process.env.COORDINATE_AGENTS_HOME = isolatedHome;
    process.env.PATH = [fakeBin, originalPath].filter(Boolean).join(delimiter);

    const started = await startWorkspace({ root: repositoryRoot, port: 0 });
    const base = started.url;
    try {
      const capability = await capabilityFromPage(base);
      const post = payload => fetch(`${base}${ACTION_ENDPOINT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-coordinate-agents-capability': capability },
        body: JSON.stringify(payload),
      });

      // Read-only discovery exposes the shared setup snapshot without side effects.
      const discoveryResponse = await (await post({ action: 'setupDiscover', params: {} })).json();
      assert.equal(discoveryResponse.ok, true);
      assert.equal(discoveryResponse.command, 'setup');
      assert.ok(Array.isArray(discoveryResponse.agents));
      assert.ok(Array.isArray(discoveryResponse.adapters));
      assert.ok(discoveryResponse.agents.some(agent => typeof agent.command === 'string'));
      const configBefore = readFileSync(join(repositoryRoot, '.agent-bus', 'config.json'), 'utf8');

      // Transactional configure: exact command is preserved, role assigned,
      // user command source reported, project config registers the adapter.
      const configureResponse = await (await post({
        action: 'setupConfigure',
        params: { agent: 'claude', command: claudeCommand, adapter: 'generic-cli', role: 'implementer', args: ['--print', '{prompt}'] },
      })).json();
      assert.equal(configureResponse.ok, true, JSON.stringify(configureResponse.error || {}));
      assert.equal(configureResponse.command, 'setup.configure');
      assert.equal(configureResponse.agent.id, 'claude');
      assert.equal(configureResponse.agent.command, claudeCommand);
      assert.equal(configureResponse.agent.adapter, 'generic-cli');
      assert.equal(configureResponse.agent.commandSource, 'user');
      assert.deepEqual(configureResponse.workflow, { implementer: 'claude' });

      const projectConfig = JSON.parse(readFileSync(join(repositoryRoot, '.agent-bus', 'config.json'), 'utf8'));
      assert.ok(projectConfig.agents.some(agent => agent.id === 'claude' && agent.adapter === 'generic-cli'));
      assert.equal(projectConfig.workflow.implementer, 'claude');
      const userConfig = JSON.parse(readFileSync(join(isolatedHome, '.coordinate-agents', 'config.json'), 'utf8'));
      assert.equal(userConfig.agents.claude.command, claudeCommand);

      // Discovery after configure reflects the new registration.
      const rediscovery = await (await post({ action: 'setupDiscover', params: {} })).json();
      assert.equal(rediscovery.ok, true);
      assert.ok(rediscovery.adapters.some(adapter => adapter.configuredAgents?.some(item => item.id === 'claude')));

      // A failed configure rolls back both project and user configuration.
      const projectBeforeRollback = readFileSync(join(repositoryRoot, '.agent-bus', 'config.json'), 'utf8');
      const rollback = await (await post({
        action: 'setupConfigure',
        params: { agent: 'antigravity', command: agyProxyCommand, adapter: 'antigravity-cli', role: 'planner' },
      })).json();
      assert.equal(rollback.ok, false);
      assert.equal(rollback.error.code, 'EXECUTABLE_NOT_FOUND');
      assert.equal(rollback.error.recoverable, true);
      const projectAfterRollback = readFileSync(join(repositoryRoot, '.agent-bus', 'config.json'), 'utf8');
      assert.equal(projectAfterRollback, projectBeforeRollback, 'Failed configuration must not mutate project config');
      assert.equal(existsSync(join(isolatedHome, '.coordinate-agents', 'config.json')), true);

      // Failed detection leaves an existing user config unchanged.
      const userBefore = readFileSync(join(isolatedHome, '.coordinate-agents', 'config.json'), 'utf8');
      const badConfigure = await (await post({
        action: 'setupConfigure',
        params: { agent: 'codex', command: 'definitely-missing-command-xyz', adapter: 'generic-cli', role: 'reviewer' },
      })).json();
      assert.equal(badConfigure.ok, false);
      const userAfter = readFileSync(join(isolatedHome, '.coordinate-agents', 'config.json'), 'utf8');
      assert.equal(userAfter, userBefore, 'Failed configuration must not mutate user config');
      assert.equal(readFileSync(join(repositoryRoot, '.agent-bus', 'config.json'), 'utf8'), projectBeforeRollback);

      // No credential or environment secret is echoed in any response.
      const serialized = JSON.stringify([discoveryResponse, configureResponse, rollback, badConfigure]);
      for (const secret of ['token=', 'Authorization', process.env.PATH]) {
        assert.equal(serialized.includes(secret), false, `Gateway responses must not echo secrets: ${secret}`);
      }

      // Workspace ships the Agents panel assets.
      const page = await (await fetch(`${base}/`)).text();
      assert.match(page, /id="agents-panel"/);
      assert.match(page, /id="discover-agents"/);
      assert.match(page, /id="agent-configure"/);
      const js = await (await fetch(`${base}/app.js`)).text();
      for (const expected of ['renderAgentsDiscovery', 'renderConfiguredAgents', 'discoverAgents', 'applyAgentConfigure', 'setupDiscover', 'setupConfigure', 'configured-agent-row', 'source-badge']) {
        assert.ok(js.includes(expected), `Workspace app.js must expose Agents setup support: ${expected}`);
      }
      const css = await (await fetch(`${base}/styles.css`)).text();
      for (const expected of ['.agents-panel', '.agent-form', '.agent-row', '.adapter-card', '.source-badge', '.configured-agent']) {
        assert.ok(css.includes(expected), `Workspace styles.css must style Agents setup: ${expected}`);
      }
    } finally {
      await closeServer(started.server);
    }
  } finally {
    process.env.PATH = originalPath;
    process.env.COORDINATE_AGENTS_HOME = originalHome;
    rmSync(repositoryRoot, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
    rmSync(isolatedHome, { recursive: true, force: true });
  }
});
