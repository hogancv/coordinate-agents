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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeRm(directory) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      rmSync(directory, { recursive: true, force: true });
      return;
    } catch {
      // Windows may briefly hold a handle on a fixture after a dispatch/run
      // probe; retry, then leave the temp directory for OS cleanup.
      await sleep(250);
    }
  }
}

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

      // Workspace no longer exposes setup as a page-level panel; setup stays
      // available through the guarded backend contract while the page is the
      // focused dual-terminal workbench.
      const page = await (await fetch(`${base}/`)).text();
      for (const expected of ['id="workspace-task-list"', 'id="agent-terminal-grid"', 'id="new-task-button"', 'id="terminal-settings-button"', 'id="terminal-settings-dialog"', 'id="restart-task-button"', 'id="close-task-button"']) {
        assert.match(page, new RegExp(expected));
      }
      assert.doesNotMatch(page, /agents-panel|discover-agents|agent-configure|chat-feed|composer|graph-map|execution-panel/);
      const js = await (await fetch(`${base}/app.js`)).text();
      for (const expected of ['workspaceTaskCreate', 'workspaceTaskClose', 'workspaceTaskRestart', 'workspace-settings', 'setupConfigure', 'sessionResize', 'onData', 'onBinary']) {
        assert.ok(js.includes(expected), `Workspace app.js must expose dual-terminal support: ${expected}`);
      }
      const css = await (await fetch(`${base}/styles.css`)).text();
      for (const expected of ['.terminal-grid', '.terminal-screen', '.workspace-task-list', 'overflow-x: hidden']) {
        assert.ok(css.includes(expected), `Workspace styles.css must style the dual-terminal UI: ${expected}`);
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

test('Task and Task Graph authoring with preflight stays side-effect free until an explicit create (#49)', async () => {
  const repositoryRoot = repository();
  const started = await startWorkspace({ root: repositoryRoot, port: 0 });
  const base = started.url;
  try {
    const capability = await capabilityFromPage(base);
    const post = payload => fetch(`${base}${ACTION_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-coordinate-agents-capability': capability },
      body: JSON.stringify(payload),
    });
    const read = async response => ({ status: response.status, payload: await response.json() });

    const graph = {
      schemaVersion: 1,
      parentTask: { id: 'task-author-parent', title: 'Author graph', spec: 'Build the authoring flow.', planner: 'codex', reviewer: 'codex' },
      subtasks: [
        { id: 'fe', implementer: 'antigravity', spec: 'Frontend.', dependsOn: [] },
        { id: 'be', implementer: 'codex', spec: 'Backend.', dependsOn: ['fe'] },
      ],
      maxConcurrency: 1,
    };
    const intentMap = {
      schemaVersion: 1,
      parentTaskId: 'task-author-parent',
      scopePolicy: 'strict',
      subtasks: [
        { id: 'fe', writeIntent: ['src/front/**'] },
        { id: 'be', writeIntent: ['src/back/**'] },
      ],
    };

    // Validate is side-effect free for valid and invalid inputs.
    const validated = await read(await post({ action: 'taskGraphValidate', params: { graph, intentMap } }));
    assert.equal(validated.status, 200);
    assert.equal(validated.payload.ok, true, JSON.stringify(validated.payload.error || {}));
    assert.equal(existsSync(join(repositoryRoot, '.agent-bus', 'task-graphs', 'task-author-parent.json')), false);

    // Cyclic and unknown-agent graphs are rejected before any persistence.
    const cyclic = await read(await post({
      action: 'taskGraphValidate',
      params: { graph: { ...graph, parentTask: { ...graph.parentTask, id: 'task-cyclic' }, subtasks: [
        { id: 'a', implementer: 'antigravity', spec: 'a', dependsOn: ['b'] },
        { id: 'b', implementer: 'codex', spec: 'b', dependsOn: ['a'] },
      ] } },
    }));
    assert.equal(cyclic.payload.ok, false);
    assert.equal(cyclic.payload.error.code, 'TASK_GRAPH_INVALID');
    const unknown = await read(await post({
      action: 'taskGraphValidate',
      params: { graph: { ...graph, parentTask: { ...graph.parentTask, id: 'task-unknown-agent' }, subtasks: [
        { id: 'x', implementer: 'ghost-agent', spec: 'x' },
      ] } },
    }));
    assert.equal(unknown.payload.ok, false);
    assert.equal(existsSync(join(repositoryRoot, '.agent-bus', 'task-graphs', 'task-cyclic.json')), false);
    assert.equal(existsSync(join(repositoryRoot, '.agent-bus', 'task-graphs', 'task-unknown-agent.json')), false);

    // Explicit empty write intent and missing Intent Map both validate.
    const emptyIntent = await read(await post({
      action: 'taskGraphValidate',
      params: { graph, intentMap: { schemaVersion: 1, parentTaskId: 'task-author-parent', scopePolicy: 'strict', subtasks: [{ id: 'fe', writeIntent: [] }, { id: 'be', writeIntent: [] }] } },
    }));
    assert.equal(emptyIntent.payload.ok, true);
    const noIntent = await read(await post({ action: 'taskGraphValidate', params: { graph } }));
    assert.equal(noIntent.payload.ok, true);

    // Create is an explicit action that persists the Runtime-owned record and
    // dispatches nothing (no Session, worktree, Bus handoff, or dispatch event).
    const eventLog = join(repositoryRoot, '.agent-bus', 'events', 'runtime.jsonl');
    const eventsBefore = existsSync(eventLog) ? readFileSync(eventLog, 'utf8').split('\n').filter(Boolean).length : 0;
    const created = await read(await post({ action: 'taskGraphCreate', params: { graph, intentMap } }));
    assert.equal(created.status, 200);
    assert.equal(created.payload.ok, true, JSON.stringify(created.payload.error || {}));
    assert.equal(created.payload.command, 'task.graph-create');
    assert.ok(created.payload.parentTaskId === 'task-author-parent' || created.payload.graphId === 'task-author-parent');
    const eventsAfterCreate = readFileSync(eventLog, 'utf8').split('\n').filter(Boolean).length;
    assert.ok(eventsAfterCreate > eventsBefore, 'Create records a TASK_GRAPH_CREATED journal event');
    assert.equal(existsSync(join(repositoryRoot, '.agent-bus', 'task-graphs', 'task-author-parent.json')), true);
    assert.equal(existsSync(join(repositoryRoot, '.agent-bus', 'sessions')), false, 'Create must not open a Session');
    assert.equal(existsSync(join(repositoryRoot, '.agent-bus', 'worktrees')), false, 'Create must not create a worktree');
    const journal = readFileSync(eventLog, 'utf8');
    assert.equal(journal.includes('TASK_GRAPH_DISPATCH'), false, 'Create must not emit a dispatch event');

    // A duplicate create is rejected without a second record.
    const duplicate = await read(await post({ action: 'taskGraphCreate', params: { graph, intentMap } }));
    assert.equal(duplicate.payload.ok, false);

    // Preflight reads the persisted record and is side-effect free.
    const eventsMid = readFileSync(eventLog, 'utf8').split('\n').filter(Boolean).length;
    const preflight = await read(await post({ action: 'taskGraphPlan', params: { taskId: 'task-author-parent' } }));
    assert.equal(preflight.status, 200);
    assert.equal(preflight.payload.ok, true, JSON.stringify(preflight.payload.error || {}));
    assert.equal(preflight.payload.frontier.ready.includes('fe'), true, 'fe is the dependency-free READY subtask');
    assert.equal(preflight.payload.frontier.waiting.includes('be'), true, 'be waits on fe');
    assert.ok(preflight.payload.plan && (preflight.payload.plan.wave || preflight.payload.plan.conflicts !== undefined));
    const eventsAfterPlan = readFileSync(eventLog, 'utf8').split('\n').filter(Boolean).length;
    assert.equal(eventsAfterPlan, eventsMid, 'Graph Preflight must be side-effect free');

    // Single-Task create through the same authoring surface.
    const singleTask = await read(await post({ action: 'taskCreate', params: { title: 'Single authored task', id: 'task-author-single' } }));
    assert.equal(singleTask.payload.ok, true);
    assert.equal(singleTask.payload.command, 'task.create');
    assert.equal(existsSync(join(repositoryRoot, '.agent-bus', 'tasks', 'task-author-single.json')), true);

    // The Workspace intentionally exposes only the dual-terminal surface;
    // standard Task/Graph authoring remains a backend compatibility contract.
    const page = await (await fetch(`${base}/`)).text();
    for (const expected of ['id="workspace-task-list"', 'id="agent-terminal-grid"', 'id="new-task-button"', 'id="restart-task-button"', 'id="close-task-button"']) {
      assert.ok(page.includes(expected), `Workspace page must include dual-terminal surface: ${expected}`);
    }
    assert.doesNotMatch(page, /author-panel|graph-create-form|task-create-form|chat-feed|composer/);
    const js = await (await fetch(`${base}/app.js`)).text();
    for (const expected of ['workspaceTaskCreate', 'workspaceTaskClose', 'workspaceTaskRestart', 'sessionWrite', 'sessionResize']) {
      assert.ok(js.includes(expected), `Workspace app.js must expose dual-terminal support: ${expected}`);
    }
    assert.doesNotMatch(js, /taskGraphCreate|taskGraphPlan|renderGraphMap|\/api\/tasks/);
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('execution controls are explicit, bounded, and fail closed without auto-dispatch (#50)', async () => {
  const repositoryRoot = repository();
  const isolatedHome = mkdtempSync(join(tmpdir(), 'coordinate-agents-exec-home-'));
  const missingCommand = join(isolatedHome, 'definitely-missing-agent-cmd');
  const originalHome = process.env.COORDINATE_AGENTS_HOME;
  try {
    // Isolate the machine user configuration so concurrent suites cannot leak
    // a real executable into dispatch/run/advance probes; a user command that
    // points at a missing absolute path fails deterministically.
    mkdirSync(join(isolatedHome, '.coordinate-agents'), { recursive: true });
    writeFileSync(join(isolatedHome, '.coordinate-agents', 'config.json'), `${JSON.stringify({
      version: 1,
      agents: {
        codex: { command: missingCommand },
        antigravity: { command: missingCommand },
      },
    }, null, 2)}\n`, 'utf8');
    process.env.COORDINATE_AGENTS_HOME = isolatedHome;
    const started = await startWorkspace({ root: repositoryRoot, port: 0 });
    const base = started.url;
    try {
    const capability = await capabilityFromPage(base);
    const post = payload => fetch(`${base}${ACTION_ENDPOINT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-coordinate-agents-capability': capability },
      body: JSON.stringify(payload),
    });
    const read = async response => ({ status: response.status, payload: await response.json() });
    const taskRuntime = await import('../skills/coordinate-agents/scripts/task-runtime.mjs');
    const graphRuntime = await import('../skills/coordinate-agents/scripts/task-graph-runtime.mjs');

    // Dispatch without an approved specification returns a conflict and creates no Session.
    const noSpec = taskRuntime.createTask(repositoryRoot, { id: 'task-exec-nospec', title: 'No spec yet' });
    const conflict = await read(await post({ action: 'taskDispatch', params: { taskId: noSpec.id } }));
    assert.equal(conflict.payload.ok, false);
    assert.equal(conflict.payload.error.code, 'TASK_STATE_CONFLICT');
    assert.match(conflict.payload.error.message, /specification/i);
    assert.equal(existsSync(join(repositoryRoot, '.agent-bus', 'sessions')), false);

    // A reviewed/APPROVED Task is not dispatchable (stale state): the Runtime
    // returns a conflict and refreshes from the authoritative record.
    const approvedTask = taskRuntime.createTask(repositoryRoot, { id: 'task-exec-approved', title: 'Dispatch fixture', spec: 'Implement the dispatch surface.' });
    taskRuntime.setTaskStatus(repositoryRoot, approvedTask.id, 'PLANNING');
    taskRuntime.setTaskStatus(repositoryRoot, approvedTask.id, 'SPEC_READY');
    taskRuntime.setTaskStatus(repositoryRoot, approvedTask.id, 'IMPLEMENTING');
    taskRuntime.setTaskStatus(repositoryRoot, approvedTask.id, 'REVIEWING', { evidence: [{ type: 'TESTS', id: 'e-1', relatedCommit: 'abc1234', details: 'ok' }] });
    taskRuntime.recordReviewDecision(repositoryRoot, approvedTask.id, 'REVIEW_APPROVED', { feedback: 'approved' });
    const stale = await read(await post({ action: 'taskDispatch', params: { taskId: approvedTask.id } }));
    assert.equal(stale.payload.ok, false);
    assert.equal(stale.payload.error.code, 'TASK_STATE_CONFLICT');
    assert.match(stale.payload.error.message, /cannot be dispatched from APPROVED/);

    // A SPEC_READY Task with a specification attempts dispatch and fails fast
    // and recoverably on the missing executable, before any Session side effect.
    const readyTask = taskRuntime.createTask(repositoryRoot, { id: 'task-exec-ready', title: 'Ready fixture', spec: 'Implement the ready surface.' });
    taskRuntime.setTaskStatus(repositoryRoot, readyTask.id, 'SPEC_READY');
    const missingExe = await read(await post({ action: 'taskDispatch', params: { taskId: readyTask.id } }));
    assert.equal(missingExe.payload.ok, false, JSON.stringify(missingExe.payload.error || {}));
    assert.equal(missingExe.payload.error.code, 'EXECUTABLE_NOT_FOUND');
    assert.equal(missingExe.payload.error.recoverable, true);

    // Advance bounds are enforced at the gateway before any Runtime call.
    const graphId = 'task-exec-graph';
    const createdGraph = await read(await post({
      action: 'taskGraphCreate',
      params: { graph: {
        schemaVersion: 1,
        parentTask: { id: graphId, title: 'Exec graph', spec: 'Run it.', planner: 'codex', reviewer: 'codex' },
        subtasks: [{ id: 'w', implementer: 'antigravity', spec: 'Do w.', dependsOn: [] }],
        maxConcurrency: 1,
      } },
    }));
    assert.equal(createdGraph.payload.ok, true, JSON.stringify(createdGraph.payload.error || {}));
    for (const maxWaves of [0, 33]) {
      const outOfBounds = await read(await post({ action: 'taskGraphAdvance', params: { taskId: graphId, maxWaves } }));
      assert.equal(outOfBounds.status, 400, `maxWaves ${maxWaves} must be rejected at the gateway`);
      assert.equal(outOfBounds.payload.error.code, 'ACTION_PARAMS_INVALID');
    }
    // Advance executes as a bounded Runtime operation: wavesExecuted and a
    // stop fact are returned and nothing spawns a Session or worktree when
    // the Implementer executable is missing.
    const advance = await read(await post({ action: 'taskGraphAdvance', params: { taskId: graphId, maxWaves: 1 } }));
    assert.equal(advance.payload.ok, true, JSON.stringify(advance.payload.error || {}));
    assert.equal(typeof advance.payload.wavesExecuted, 'number');
    assert.ok('stop' in advance.payload);
    assert.equal(existsSync(join(repositoryRoot, '.agent-bus', 'sessions')), false);
    assert.equal(existsSync(join(repositoryRoot, '.agent-bus', 'worktrees')), false);

    // Graph run on a CREATED graph is a bounded Runtime operation; with a
    // missing executable it stops without spawning a Session or worktree.
    const run = await read(await post({ action: 'taskGraphRun', params: { taskId: graphId, sessionWaitMs: 0 } }));
    assert.equal(run.payload.ok, true, JSON.stringify(run.payload.error || {}));
    assert.equal(existsSync(join(repositoryRoot, '.agent-bus', 'sessions')), false);
    assert.equal(existsSync(join(repositoryRoot, '.agent-bus', 'worktrees')), false);

    // Standard execution remains a backend compatibility contract; the
    // Workspace page exposes only the dual-terminal task controls.
    const page = await (await fetch(`${base}/`)).text();
    assert.match(page, /id="agent-terminal-grid"/);
    assert.match(page, /id="new-task-button"/);
    assert.doesNotMatch(page, /execution-panel|execution-confirm|chat-feed|composer|graph-map/);
    const js = await (await fetch(`${base}/app.js`)).text();
    for (const expected of ['workspaceTaskCreate', 'workspaceTaskClose', 'workspaceTaskRestart', 'sessionWrite', 'sessionResize']) {
      assert.ok(js.includes(expected), `Workspace app.js must expose terminal task support: ${expected}`);
    }
    const css = await (await fetch(`${base}/styles.css`)).text();
    for (const expected of ['.terminal-grid', '.task-toolbar', '.danger-button']) {
      assert.ok(css.includes(expected), `Workspace styles.css must style task controls: ${expected}`);
    }
    } finally {
      await closeServer(started.server);
      await safeRm(repositoryRoot);
    }
  } finally {
    process.env.COORDINATE_AGENTS_HOME = originalHome;
    await safeRm(isolatedHome);
  }
});

test('Session console and recovery controls stay explicit, owned, and idempotent (#51)', async () => {
  const repositoryRoot = repository();
  const isolatedHome = mkdtempSync(join(tmpdir(), 'coordinate-agents-recovery-home-'));
  const missingCommand = join(isolatedHome, 'definitely-missing-agent-cmd');
  const originalHome = process.env.COORDINATE_AGENTS_HOME;
  try {
    mkdirSync(join(isolatedHome, '.coordinate-agents'), { recursive: true });
    const userConfigBody = JSON.stringify({
      version: 1,
      agents: { codex: { command: missingCommand }, antigravity: { command: missingCommand } },
    }, null, 2) + "\n";
    writeFileSync(join(isolatedHome, '.coordinate-agents', 'config.json'), userConfigBody, 'utf8');
    process.env.COORDINATE_AGENTS_HOME = isolatedHome;
    const started = await startWorkspace({ root: repositoryRoot, port: 0 });
    const base = started.url;
    try {
      const capability = await capabilityFromPage(base);
      const post = payload => fetch(base + ACTION_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-coordinate-agents-capability': capability },
        body: JSON.stringify(payload),
      });
      const read = async response => ({ status: response.status, payload: await response.json() });
      const taskRuntime = await import('../skills/coordinate-agents/scripts/task-runtime.mjs');

      const graphId = 'task-recovery-graph';
      const createdGraph = await read(await post({
        action: 'taskGraphCreate',
        params: { graph: {
          schemaVersion: 1,
          parentTask: { id: graphId, title: 'Recovery graph', spec: 's', planner: 'codex', reviewer: 'codex' },
          subtasks: [{ id: 'a', implementer: 'antigravity', spec: 'do', dependsOn: [] }],
          maxConcurrency: 1,
        } },
      }));
      assert.equal(createdGraph.payload.ok, true, JSON.stringify(createdGraph.payload.error || {}));

      // Recovery/cleanup controls are idempotent and facts-first on a graph
      // that has never run: no Session or worktree is created.
      for (const action of ['taskGraphRecover', 'taskGraphResume', 'taskGraphStop', 'taskGraphCleanup']) {
        const result = await read(await post({ action, params: { taskId: graphId } }));
        assert.equal(result.payload.ok, true, action + ' must be idempotent-safe on a fresh graph: ' + JSON.stringify(result.payload.error || {}));
      }
      assert.equal(existsSync(join(repositoryRoot, '.agent-bus', 'sessions')), false);
      assert.equal(existsSync(join(repositoryRoot, '.agent-bus', 'worktrees')), false);

      // Single-Task stop on a fresh Task is conflict-aware.
      const freshTask = taskRuntime.createTask(repositoryRoot, { id: 'task-recovery-single', title: 'Fresh', spec: 's' });
      const stopResult = await read(await post({ action: 'taskStop', params: { taskId: freshTask.id } }));
      assert.equal(stopResult.payload.ok, true, JSON.stringify(stopResult.payload.error || {}));
      const stoppedRecord = taskRuntime.readTask(repositoryRoot, freshTask.id);
      assert.equal(stoppedRecord.status, 'STOPPED', 'Stop marks the owned Task STOPPED without auto retry');

      // Session controls reject unknown Sessions with canonical errors and
      // never write or spawn anything.
      const sessionProbes = [
        ['sessionStatus', {}],
        ['sessionInspect', {}],
        ['sessionRead', { limit: 50 }],
        ['sessionClose', {}],
      ];
      for (const entry of sessionProbes) {
        const action = entry[0];
        const extra = entry[1];
        const result = await read(await post({ action, params: Object.assign({ sessionId: 'session_never_owned' }, extra) }));
        assert.equal(result.payload.ok, false, action + ' must reject an unknown Session');
        assert.equal(result.payload.error.code, 'SESSION_NOT_FOUND', action + ' must report SESSION_NOT_FOUND');
      }
      const writeProbe = await read(await post({ action: 'sessionWrite', params: { sessionId: 'session_never_owned', input: 'hi' } }));
      assert.equal(writeProbe.payload.ok, false);
      assert.equal(writeProbe.payload.error.code, 'SESSION_NOT_FOUND');
      const sessionsDir = join(repositoryRoot, '.agent-bus', 'sessions');
      const sessionRecords = existsSync(sessionsDir) ? readdirSync(sessionsDir).filter(name => name.endsWith('.json')) : [];
      assert.equal(sessionRecords.length, 0, 'Rejected Session input must not create any Session record');

      // The new Workspace renders the selected pair only; recovery and the
      // standard Task Graph remain backend compatibility capabilities.
      const page = await (await fetch(base + '/')).text();
      assert.match(page, /id="agent-terminal-grid"/);
      assert.doesNotMatch(page, /id="sessions"|session-input-form|recovery/);
      const js = await (await fetch(base + '/app.js')).text();
      for (const expected of ['sessionWrite', 'sessionResize', 'enqueueRawInput', 'workspaceTaskClose', 'workspaceTaskRestart']) {
        assert.ok(js.includes(expected), 'Workspace app.js must expose direct terminal support: ' + expected);
      }
      assert.doesNotMatch(js, /recoveryControls|submitSessionInput|taskGraphCleanup|taskResume|session-card/);
      const css = await (await fetch(base + '/styles.css')).text();
      for (const expected of ['.terminal-grid', '.terminal-screen', '.terminal-card-footer']) {
        assert.ok(css.includes(expected), 'Workspace styles.css must style direct terminals: ' + expected);
      }
      assert.doesNotMatch(css, /session-input-form|recovery-sep/);
      } finally {
        await closeServer(started.server);
        await safeRm(repositoryRoot);
      }
  } finally {
    process.env.COORDINATE_AGENTS_HOME = originalHome;
    await safeRm(isolatedHome);
  }
});

test('review and integrate controls are explicit, conflict-aware, and never release (#52)', async () => {
  const repositoryRoot = repository();
  const isolatedHome = mkdtempSync(join(tmpdir(), 'coordinate-agents-review-home-'));
  const missingCommand = join(isolatedHome, 'definitely-missing-agent-cmd');
  const originalHome = process.env.COORDINATE_AGENTS_HOME;
  try {
    mkdirSync(join(isolatedHome, '.coordinate-agents'), { recursive: true });
    const body = JSON.stringify({ version: 1, agents: { codex: { command: missingCommand }, antigravity: { command: missingCommand } } }, null, 2) + "\n";
    writeFileSync(join(isolatedHome, '.coordinate-agents', 'config.json'), body, 'utf8');
    process.env.COORDINATE_AGENTS_HOME = isolatedHome;
    const started = await startWorkspace({ root: repositoryRoot, port: 0 });
    const base = started.url;
    try {
      const capability = await capabilityFromPage(base);
      const post = payload => fetch(base + ACTION_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-coordinate-agents-capability': capability },
        body: JSON.stringify(payload),
      });
      const read = async response => ({ status: response.status, payload: await response.json() });
      const taskRuntime = await import('../skills/coordinate-agents/scripts/task-runtime.mjs');

      const graphId = 'task-review-graph';
      const created = await read(await post({
        action: 'taskGraphCreate',
        params: { graph: {
          schemaVersion: 1,
          parentTask: { id: graphId, title: 'Review graph', spec: 's', planner: 'codex', reviewer: 'codex' },
          subtasks: [{ id: 'a', implementer: 'antigravity', spec: 'do', dependsOn: [] }],
          maxConcurrency: 1,
        } },
      }));
      assert.equal(created.payload.ok, true, JSON.stringify(created.payload.error || {}));

      // Unsupported review decisions are rejected by the gateway before any Runtime call.
      for (const decision of ['NOPE', 'APPROVE', '']) {
        const bad = await read(await post({ action: 'taskReview', params: { taskId: 'task-x', decision } }));
        assert.equal(bad.status, 400, 'decision ' + decision + ' must be rejected at the gateway');
        assert.equal(bad.payload.error.code, 'ACTION_PARAMS_INVALID');
      }

      // Integration on a graph without verified subtask completion is a conflict,
      // and review of that graph fails with the same Runtime gate; no user
      // checkout or remote ref is touched.
      const integrate = await read(await post({ action: 'taskGraphIntegrate', params: { taskId: graphId } }));
      assert.equal(integrate.payload.ok, false, JSON.stringify(integrate.payload.error || {}));
      assert.equal(integrate.payload.error.code, 'TASK_STATE_CONFLICT');
      const review = await read(await post({ action: 'taskGraphReview', params: { taskId: graphId, decision: 'REVIEW_APPROVED', feedback: 'ok' } }));
      assert.equal(review.payload.ok, false);
      const porcelain = spawnSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
      assert.equal(porcelain.stdout.trim(), '', 'Integration/review attempts must not touch the user checkout');
      const gitBranch = spawnSync('git', ['branch', '--list', '--remote'], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
      assert.equal(gitBranch.stdout.trim(), '', 'No remote refs are created by review controls');

      // Single-Task review is state-aware: a fresh Task is not reviewable.
      const freshTask = taskRuntime.createTask(repositoryRoot, { id: 'task-review-single', title: 'Fresh', spec: 's' });
      const taskReview = await read(await post({ action: 'taskReview', params: { taskId: freshTask.id, decision: 'REVIEW_APPROVED', feedback: 'looks good' } }));
      assert.equal(taskReview.payload.ok, false);
      assert.ok(taskReview.payload.error.code, 'Single-Task review must be gated by Runtime state');

      // Review UI is intentionally absent from the new terminal Workspace;
      // review remains a backend contract for the standard Task/Graph flows.
      const page = await (await fetch(base + '/')).text();
      assert.match(page, /id="agent-terminal-grid"/);
      assert.doesNotMatch(page, /id="review-panel"|RELEASE_APPROVED/);
      const js = await (await fetch(base + '/app.js')).text();
      assert.doesNotMatch(js, /renderReview|integrateGraph|submitReview|taskGraphIntegrate|taskGraphReview|taskReview/);
      const htmlLower = (await (await fetch(base + '/')).text()).toLowerCase();
      for (const forbidden of ['>merge<', '>push<', '>publish<', '>deploy<', '>release<', '>tag<']) {
        assert.equal(htmlLower.includes(forbidden), false, 'Review UI must not offer release-like controls: ' + forbidden);
      }
      const css = await (await fetch(base + '/styles.css')).text();
      assert.doesNotMatch(css, /\.review-panel|\.review-form|\.review-confirm-row|\.review-result/);
      } finally {
        await closeServer(started.server);
        await safeRm(repositoryRoot);
      }
  } finally {
    process.env.COORDINATE_AGENTS_HOME = originalHome;
    await safeRm(isolatedHome);
  }
});
