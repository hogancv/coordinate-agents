import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  createTask,
  recordReviewDecision,
  setTaskStatus,
} from '../skills/coordinate-agents/scripts/task-runtime.mjs';
import { startInspector } from '../inspector/server/server.mjs';
import { appendRuntimeEvent } from '../skills/coordinate-agents/scripts/runtime-events.mjs';

const root = process.cwd();
const cli = join(root, 'bin', 'coordinate-agents.mjs');
const busTool = join(root, 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');

function repository() {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'coordinate-agents-inspector-'));
  const git = spawnSync('git', ['init', repositoryRoot], { encoding: 'utf8', windowsHide: true });
  assert.equal(git.status, 0, git.stderr || git.stdout);
  const init = spawnSync(process.execPath, [busTool, 'init', '--root', repositoryRoot], { encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return realpathSync(repositoryRoot);
}

function writeAgentState(repositoryRoot, agent, state, details, timestamp) {
  const directory = join(repositoryRoot, '.agent-bus', 'state', agent);
  writeFileSync(join(directory, `${timestamp.replace(/[-:TZ.]/g, '')}-inspector.json`), `${JSON.stringify({
    agent,
    state,
    details,
    related_commit: 'abc1234',
    updated_at: timestamp,
    process_id: 42,
    machine_name: 'fixture',
  }, null, 2)}\n`, 'utf8');
}

function writeBusMessage(repositoryRoot) {
  const directory = join(repositoryRoot, '.agent-bus', 'inbox', 'codex', 'processed');
  writeFileSync(join(directory, '20260823000000000-IMPLEMENTATION_DONE-inspector.md'), [
    '---',
    'id: inspector-message',
    'from: antigravity',
    'to: codex',
    'type: IMPLEMENTATION_DONE',
    'created_at: 2026-08-23T00:03:00.000Z',
    'related_commit: abc1234',
    'dedupe_key: task:task-inspector:round:1:done',
    'subject: "Implementation evidence"',
    '---',
    '',
    'Task ID: task-inspector',
    'Tests: passed',
  ].join('\n') + '\n', 'utf8');
}

function writeSession(repositoryRoot, taskId) {
  const sessionId = 'session_fixture123';
  const createdAt = '2026-08-23T00:01:00.000Z';
  mkdirSync(join(repositoryRoot, '.agent-bus', 'sessions'), { recursive: true });
  writeFileSync(join(repositoryRoot, '.agent-bus', 'sessions', `${sessionId}.json`), `${JSON.stringify({
    schemaVersion: 1,
    id: sessionId,
    agent: 'antigravity',
    command: 'fixture-agent',
    resolvedCommand: 'fixture-agent',
    args: [],
    cwd: repositoryRoot,
    pid: null,
    state: 'exited',
    createdAt,
    lastActivityAt: '2026-08-23T00:04:00.000Z',
    exitCode: 0,
    signal: null,
    error: null,
    endpoint: 'fixture-endpoint',
    hostPid: null,
  }, null, 2)}\n`, 'utf8');
  return { sessionId, taskId };
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

function fixture() {
  const repositoryRoot = repository();
  const session = writeSession(repositoryRoot, 'task-inspector');
  const task = createTask(repositoryRoot, {
    id: 'task-inspector',
    title: 'Build Inspector fixture',
    spec: 'Show the coordination loop without changing runtime state.',
    sessionId: session.sessionId,
  });
  setTaskStatus(repositoryRoot, task.id, 'PLANNING');
  setTaskStatus(repositoryRoot, task.id, 'SPEC_READY');
  setTaskStatus(repositoryRoot, task.id, 'IMPLEMENTING');
  setTaskStatus(repositoryRoot, task.id, 'REVIEWING', {
    implementationCommit: 'abc1234',
    evidence: [{
      type: 'TESTS',
      id: 'evidence-1',
      relatedCommit: 'abc1234',
      details: 'npm test passed',
      createdAt: '2026-08-23T00:03:30.000Z',
    }],
  });
  recordReviewDecision(repositoryRoot, task.id, 'REVIEW_APPROVED', {
    feedback: 'Evidence is complete.',
    evidence: { tests: 'passed' },
  });
  writeAgentState(repositoryRoot, 'codex', 'APPROVED', 'Task task-inspector reviewed.', '2026-08-23T00:05:00.000Z');
  writeAgentState(repositoryRoot, 'antigravity', 'WAITING', 'Task task-inspector implementation complete.', '2026-08-23T00:04:00.000Z');
  writeBusMessage(repositoryRoot);
  return repositoryRoot;
}

test('Inspector API reads fixture Tasks, Sessions, Agent topology, events, and dashboard assets', async () => {
  const repositoryRoot = fixture();
  const started = await startInspector({ root: repositoryRoot, port: 0 });
  try {
    assert.equal(started.host, '127.0.0.1');
    assert.equal(started.url, `http://localhost:${started.port}`);
    assert.equal(started.server.address().address, '127.0.0.1');

    const tasksResponse = await fetch(`${started.url}/api/tasks`);
    assert.equal(tasksResponse.status, 200);
    const tasks = await tasksResponse.json();
    assert.equal(tasks.length, 1);
    assert.deepEqual(tasks[0], {
      id: 'task-inspector',
      title: 'Build Inspector fixture',
      status: 'APPROVED',
      round: 1,
      updatedAt: tasks[0].updatedAt,
      createdAt: tasks[0].createdAt,
      planner: 'codex',
      implementer: 'antigravity',
      reviewer: 'codex',
      sessionId: 'session_fixture123',
      reviewDecision: 'REVIEW_APPROVED',
    });

    const detail = await (await fetch(`${started.url}/api/tasks/task-inspector`)).json();
    assert.equal(detail.status, 'APPROVED');
    assert.equal(detail.implementationCommit, 'abc1234');
    assert.equal(detail.evidence.length, 1);
    assert.equal(detail.reviewHistory.length, 1);
    assert.ok(detail.timeline.some(item => item.status === 'APPROVED'));

    const agents = await (await fetch(`${started.url}/api/agents`)).json();
    assert.deepEqual(agents.map(agent => agent.id), ['codex', 'antigravity']);
    assert.equal(agents[0].role, 'planner / reviewer');
    assert.equal(agents[0].status, 'APPROVED');
    assert.equal(agents[1].status, 'WAITING');

    const sessions = await (await fetch(`${started.url}/api/sessions`)).json();
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].sessionId, 'session_fixture123');
    assert.equal(sessions[0].status, 'exited');
    assert.deepEqual(sessions[0].taskIds, ['task-inspector']);

    const events = await (await fetch(`${started.url}/api/events?taskId=task-inspector&limit=50`)).json();
    assert.ok(events.some(event => event.event === 'TASK_CREATED'));
    assert.ok(events.some(event => event.event === 'REVIEW_APPROVED'));
    assert.ok(events.every(event => event.taskId === 'task-inspector'));
    assert.ok(events.every(event => event.recorded === true));
    assert.deepEqual(events.map(event => event.sequence), [...events.map(event => event.sequence)].sort((a, b) => b - a));

    const page = await (await fetch(started.url)).text();
    assert.match(page, /Coordinate Agents Inspector/);
    assert.match(page, /Event timeline/);
    assert.match(page, /Sessions/);

    const mutation = await fetch(`${started.url}/api/tasks`, { method: 'POST' });
    assert.equal(mutation.status, 405);
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('coordinate-agents inspector starts the localhost server on a selected port', async () => {
  const repositoryRoot = fixture();
  const port = await freePort();
  const child = spawn(process.execPath, [cli, 'inspector', '--root', repositoryRoot, '--port', `${port}`], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  const started = new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Inspector CLI did not start. stdout=${stdout} stderr=${stderr}`)), 5_000);
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
    const response = await fetch(`http://localhost:${port}/api/tasks`);
    assert.equal(response.status, 200);
    assert.equal((await response.json())[0].id, 'task-inspector');
  } finally {
    child.kill('SIGTERM');
    await once(child, 'exit');
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Inspector uses explicit legacy history only when a Task has no recorded events', async () => {
  const repositoryRoot = fixture();
  rmSync(join(repositoryRoot, '.agent-bus', 'events'), { recursive: true, force: true });
  const started = await startInspector({ root: repositoryRoot, port: 0 });
  try {
    const legacy = await (await fetch(`${started.url}/api/tasks/task-inspector`)).json();
    assert.equal(legacy.historySource, 'derived-legacy');
    assert.ok(legacy.events.length > 0);
    assert.ok(legacy.events.every(event => event.recorded === false));
    assert.ok(legacy.events.every(event => event.source.startsWith('derived-legacy:')));

    createTask(repositoryRoot, { id: 'task-after-journal', title: 'New recorded task' });
    const recorded = await (await fetch(`${started.url}/api/tasks/task-after-journal`)).json();
    assert.equal(recorded.historySource, 'recorded');
    assert.deepEqual(recorded.events.map(event => event.event), ['TASK_CREATED']);
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Inspector SSE delivers recorded events and resumes from Last-Event-ID', async () => {
  const repositoryRoot = fixture();
  const first = appendRuntimeEvent(repositoryRoot, { type: 'RUNTIME_ERROR', taskId: 'task-inspector', data: { message: 'first' } });
  const second = appendRuntimeEvent(repositoryRoot, { type: 'TASK_RESUMED', taskId: 'task-inspector', data: { round: 2 } });
  const started = await startInspector({ root: repositoryRoot, port: 0 });
  const controller = new AbortController();
  try {
    const response = await fetch(`${started.url}/api/events/stream`, {
      headers: { 'Last-Event-ID': `${first.sequence}` },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = '';
    const third = appendRuntimeEvent(repositoryRoot, { type: 'TASK_STOPPED', taskId: 'task-inspector', data: { reason: 'fixture' } });
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline && (!body.includes(`id: ${second.sequence}\n`) || !body.includes(`id: ${third.sequence}\n`))) {
      const result = await Promise.race([
        reader.read(),
        new Promise(resolvePromise => setTimeout(() => resolvePromise({ timeout: true }), 700)),
      ]);
      if (result.timeout) continue;
      if (result.done) break;
      body += decoder.decode(result.value, { stream: true });
    }
    assert.match(body, new RegExp(`id: ${second.sequence}\\n`));
    assert.match(body, new RegExp(`id: ${third.sequence}\\n`));
    assert.equal(body.includes(`id: ${first.sequence}\n`), false);
    assert.match(body, /event: runtime-event/);
  } finally {
    controller.abort();
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Inspector metadata is included in the package payload and CLI help', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.ok(packageJson.files.includes('inspector'));
  assert.ok(packageJson.files.includes('docs/inspector.md'));
  const help = spawnSync(process.execPath, [cli, 'help', '--lang', 'en'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /inspector\s+Start the local read-only Web UI Inspector/);
  assert.match(help.stdout, /--port <port>/);
  assert.equal(existsSync(join(root, 'inspector', 'web', 'index.html')), true);
});
