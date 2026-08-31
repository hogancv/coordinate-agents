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
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  createTask,
  recordReviewDecision,
  setTaskStatus,
} from '../skills/coordinate-agents/scripts/task-runtime.mjs';
import {
  createTaskGraph,
  setTaskGraphIntegration,
  setTaskGraphReview,
  setTaskGraphState,
  setTaskGraphSubtaskState,
  taskGraphPath,
} from '../skills/coordinate-agents/scripts/task-graph-runtime.mjs';
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
  appendRuntimeEvent(repositoryRoot, {
    type: 'SESSION_EXITED',
    sessionId,
    agentId: 'antigravity',
    taskId,
    data: { state: 'exited', exitCode: 0 },
  });
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
  const task = createTask(repositoryRoot, {
    id: 'task-inspector',
    title: 'Build Inspector fixture',
    spec: 'Show the coordination loop without changing runtime state.',
    sessionId: 'session_fixture123',
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
  writeSession(repositoryRoot, 'task-inspector');
  writeAgentState(repositoryRoot, 'codex', 'APPROVED', 'Task task-inspector reviewed.', '2026-08-23T00:05:00.000Z');
  writeAgentState(repositoryRoot, 'antigravity', 'WAITING', 'Task task-inspector implementation complete.', '2026-08-23T00:04:00.000Z');
  writeBusMessage(repositoryRoot);
  return repositoryRoot;
}

function graphFixture(repositoryRoot) {
  const baseCommit = '1111111111111111111111111111111111111111';
  const implCommit1 = '2222222222222222222222222222222222222222';
  const aggCommit = '3333333333333333333333333333333333333333';

  const graphInput = {
    schemaVersion: 1,
    parentTask: {
      id: 'task-graph-inspector',
      title: 'Build Graph Inspector fixture',
      spec: 'Demonstrate Task Graph visualization with subtasks and topology.',
      planner: 'codex',
      reviewer: 'codex',
    },
    subtasks: [
      { id: 'backend', implementer: 'antigravity', spec: 'Implement backend service.', dependsOn: [] },
      { id: 'frontend', implementer: 'codex', spec: 'Implement frontend UI.', dependsOn: ['backend'] },
      { id: 'docs', implementer: 'codex', spec: 'Write documentation.', dependsOn: ['backend'] },
    ],
    maxConcurrency: 2,
  };

  const intentMap = {
    schemaVersion: 1,
    parentTaskId: 'task-graph-inspector',
    scopePolicy: 'strict',
    subtasks: [
      { id: 'backend', writeIntent: ['src/server/**'] },
      { id: 'frontend', writeIntent: ['src/client/**'] },
      { id: 'docs', writeIntent: ['docs/**'] },
    ],
  };

  createTaskGraph(repositoryRoot, graphInput, {
    configuredAgents: [{ id: 'codex', adapter: 'codex-cli' }, { id: 'antigravity', adapter: 'generic-cli' }],
    intentMap,
  });

  setTaskGraphSubtaskState(repositoryRoot, 'task-graph-inspector', 'backend', 'RUNNING', {
    sessionId: 'session_backend123',
    worktreePath: join(repositoryRoot, '.agent-bus', 'worktrees', 'task-graph-inspector', 'backend'),
    branch: 'coordinate-agents/task-graph-inspector/backend',
    ref: 'refs/heads/coordinate-agents/task-graph-inspector/backend',
    baseCommit,
  });

  setTaskGraphSubtaskState(repositoryRoot, 'task-graph-inspector', 'backend', 'SUCCEEDED', {
    implementationCommit: implCommit1,
    evidence: [{
      type: 'IMPLEMENTATION_DONE',
      relatedCommit: implCommit1,
      details: 'Backend implementation complete with unit tests.',
      createdAt: '2026-08-23T00:03:00.000Z',
    }],
    scopeEvidence: {
      schemaVersion: 1,
      parentTaskId: 'task-graph-inspector',
      subtaskId: 'backend',
      graphBaseCommit: baseCommit,
      implementationCommit: implCommit1,
      scopePolicy: 'strict',
      coverage: 'declared',
      writeIntent: ['src/server/**'],
      actualPathCount: 1,
      actualPaths: ['src/server/index.js'],
      actualPathsTruncated: false,
      outsideIntentPathCount: 0,
      outsideIntentPaths: [],
      outsideIntentPathsTruncated: false,
      committedChangeCount: 1,
      committedChanges: [{ status: 'A', path: 'src/server/index.js' }],
      committedChangesTruncated: false,
      dirtyChangeCount: 0,
      dirtyChanges: [],
      dirtyChangesTruncated: false,
      dirtyWorktreeAvailable: false,
      hasDirty: false,
      drift: false,
      driftEvidence: null,
    },
  });

  setTaskGraphState(repositoryRoot, 'task-graph-inspector', 'RUNNING');

  setTaskGraphIntegration(repositoryRoot, 'task-graph-inspector', 'SUCCEEDED', {
    aggregateCommit: aggCommit,
    worktreePath: join(repositoryRoot, '.agent-bus', 'worktrees', 'task-graph-inspector', '__integration__'),
    branch: 'coordinate-agents/task-graph-inspector/__integration__',
    ref: 'refs/heads/coordinate-agents/task-graph-inspector/__integration__',
    appliedCommits: [implCommit1],
    appliedSubtasks: ['backend'],
  });

  setTaskGraphReview(repositoryRoot, 'task-graph-inspector', 'REVIEW_APPROVED', {
    feedback: 'Graph topology executed correctly and integration verified.',
  });

  return { baseCommit, implCommit1, aggCommit };
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
      kind: 'task',
      graph: false,
      id: 'task-inspector',
      title: 'Build Inspector fixture',
      status: 'APPROVED',
      round: 1,
      createdAt: tasks[0].createdAt,
      updatedAt: tasks[0].updatedAt,
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

test('Inspector mixed listing discovers both ordinary Tasks and Task Graph parents with distinct summaries and sorting', async () => {
  const repositoryRoot = fixture();
  graphFixture(repositoryRoot);
  const started = await startInspector({ root: repositoryRoot, port: 0 });
  try {
    const tasksResponse = await fetch(`${started.url}/api/tasks`);
    assert.equal(tasksResponse.status, 200);
    const tasks = await tasksResponse.json();
    assert.equal(tasks.length, 2);

    const graphEntry = tasks.find(item => item.graph === true);
    assert.ok(graphEntry, 'Task Graph parent must appear in tasks list');
    assert.equal(graphEntry.kind, 'task-graph-parent');
    assert.equal(graphEntry.id, 'task-graph-inspector');
    assert.equal(graphEntry.parentTaskId, 'task-graph-inspector');
    assert.equal(graphEntry.title, 'Build Graph Inspector fixture');
    assert.equal(graphEntry.status, 'APPROVED');
    assert.equal(graphEntry.maxConcurrency, 2);
    assert.equal(graphEntry.subtaskCount, 3);
    assert.equal(graphEntry.reviewDecision, 'REVIEW_APPROVED');
    assert.deepEqual(graphEntry.counts, {
      ready: 2,
      waiting: 0,
      running: 0,
      succeeded: 1,
      failed: 0,
      blocked: 0,
      stopped: 0,
    });

    const ordinaryEntry = tasks.find(item => item.graph === false);
    assert.ok(ordinaryEntry, 'Ordinary task must appear in tasks list');
    assert.equal(ordinaryEntry.kind, 'task');
    assert.equal(ordinaryEntry.id, 'task-inspector');
    assert.equal(ordinaryEntry.round, 1);

    for (let i = 0; i < tasks.length - 1; i += 1) {
      assert.ok(tasks[i].updatedAt >= tasks[i + 1].updatedAt);
    }
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Inspector returns exhaustive bounded Task Graph detail across subtasks, topology, frontier, wave, integration, recovery, and review', async () => {
  const repositoryRoot = repository();
  const { implCommit1, aggCommit } = graphFixture(repositoryRoot);
  const started = await startInspector({ root: repositoryRoot, port: 0 });
  try {
    const detailResponse = await fetch(`${started.url}/api/tasks/task-graph-inspector`);
    assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json();

    assert.equal(detail.graph, true);
    assert.equal(detail.kind, 'task-graph-parent');
    assert.equal(detail.id, 'task-graph-inspector');
    assert.equal(detail.parentTaskId, 'task-graph-inspector');
    assert.equal(detail.title, 'Build Graph Inspector fixture');
    assert.equal(detail.status, 'APPROVED');
    assert.equal(detail.maxConcurrency, 2);
    assert.equal(detail.subtaskCount, 3);
    assert.equal(detail.schemaVersion, 1);
    assert.equal(detail.spec, 'Demonstrate Task Graph visualization with subtasks and topology.');
    assert.equal(detail.historySource, 'recorded');

    // Subtasks and topology
    assert.equal(detail.subtasks.length, 3);
    const backend = detail.subtasks.find(s => s.id === 'backend');
    assert.ok(backend);
    assert.equal(backend.title, 'backend');
    assert.equal(backend.spec, 'Implement backend service.');
    assert.equal(backend.state, 'SUCCEEDED');
    assert.equal(backend.implementer, 'antigravity');
    assert.deepEqual(backend.agent, { id: 'antigravity', registered: true, adapter: 'antigravity-cli' });
    assert.equal(backend.sessionId, 'session_backend123');
    assert.equal(backend.worktree.branch, 'coordinate-agents/task-graph-inspector/backend');
    assert.equal(backend.implementationCommit, implCommit1);
    assert.equal(backend.evidence.length, 1);
    assert.equal(backend.evidence[0].type, 'IMPLEMENTATION_DONE');
    assert.equal(backend.scopeAudit.schemaVersion, 1);
    assert.equal(backend.scopeAudit.drift, false);
    assert.equal(backend.scopeAudit.scopePolicy, 'strict');
    assert.deepEqual(backend.scopeAudit.actualPaths, ['src/server/index.js']);
    assert.deepEqual(backend.scopeAudit.outsideIntentPaths, []);
    assert.ok(backend.recovery);
    assert.equal(backend.recovery.classification, 'completed');

    const frontend = detail.subtasks.find(s => s.id === 'frontend');
    assert.ok(frontend);
    assert.deepEqual(frontend.dependsOn, ['backend']);
    assert.equal(frontend.state, 'READY');

    const docs = detail.subtasks.find(s => s.id === 'docs');
    assert.ok(docs);
    assert.deepEqual(docs.dependsOn, ['backend']);
    assert.equal(docs.state, 'READY');

    // Dependencies edges
    assert.deepEqual(detail.dependencies, [
      { from: 'backend', to: 'docs' },
      { from: 'backend', to: 'frontend' },
    ]);

    // Frontier & wave
    assert.deepEqual(detail.frontier.ready, ['docs', 'frontend']);
    assert.deepEqual(detail.frontier.waiting, []);
    assert.deepEqual(detail.frontier.running, []);
    assert.deepEqual(detail.frontier.succeeded, ['backend']);
    assert.ok(detail.wave);
    assert.deepEqual(detail.wave.selected, ['docs', 'frontend']);
    assert.deepEqual(detail.wave.conflicts, []);

    // Conflicts and Intent coverage
    assert.deepEqual(detail.conflicts, []);
    assert.ok(detail.intentCoverage);
    assert.equal(detail.intentCoverage.schemaVersion, 1);
    assert.equal(detail.intentCoverage.subtasks.length, 3);

    // Integration facts
    assert.ok(detail.integration);
    assert.equal(detail.integration.state, 'SUCCEEDED');
    assert.equal(detail.integration.aggregateCommit, aggCommit);
    assert.ok(detail.integrationFacts);
    assert.equal(detail.integrationFacts.branch, 'coordinate-agents/task-graph-inspector/__integration__');

    // Review facts
    assert.ok(detail.review);
    assert.equal(detail.review.decision, 'REVIEW_APPROVED');
    assert.equal(detail.review.feedback, 'Graph topology executed correctly and integration verified.');
    assert.equal(detail.reviewHistory.length, 1);

    // Timeline and events
    assert.ok(Array.isArray(detail.events));
    assert.ok(detail.events.some(e => e.type === 'TASK_GRAPH_CREATED'));
    assert.ok(detail.events.some(e => e.type === 'REVIEW_APPROVED'));
    assert.ok(Array.isArray(detail.timeline));

    // Agent flow
    assert.deepEqual(detail.agentFlow, [
      { role: 'planner', agent: 'codex' },
      { role: 'implementer', agent: 'antigravity' },
      { role: 'implementer', agent: 'codex' },
      { role: 'reviewer', agent: 'codex' },
    ]);
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Inspector direct /api/graphs and /api/graphs/:id endpoints provide dedicated Task Graph access', async () => {
  const repositoryRoot = repository();
  graphFixture(repositoryRoot);
  const started = await startInspector({ root: repositoryRoot, port: 0 });
  try {
    const listRes = await fetch(`${started.url}/api/graphs`);
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'task-graph-inspector');
    assert.equal(list[0].graph, true);
    assert.equal(list[0].subtaskCount, 3);

    const itemRes = await fetch(`${started.url}/api/graphs/task-graph-inspector`);
    assert.equal(itemRes.status, 200);
    const item = await itemRes.json();
    assert.equal(item.id, 'task-graph-inspector');
    assert.equal(item.graph, true);
    assert.equal(item.subtasks.length, 3);

    const notFoundRes = await fetch(`${started.url}/api/graphs/task-nonexistent`);
    assert.equal(notFoundRes.status, 404);
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Inspector SSE streams Task Graph events and filters/resumes from Last-Event-ID', async () => {
  const repositoryRoot = repository();
  const first = appendRuntimeEvent(repositoryRoot, {
    type: 'TASK_GRAPH_CREATED',
    taskId: 'task-graph-sse',
    agentId: 'codex',
    role: 'planner',
    data: { parentTaskId: 'task-graph-sse', maxConcurrency: 2 },
  });
  const second = appendRuntimeEvent(repositoryRoot, {
    type: 'TASK_GRAPH_STATUS_CHANGED',
    taskId: 'task-graph-sse',
    agentId: 'codex',
    role: 'planner',
    data: { from: 'CREATED', to: 'RUNNING' },
  });
  const started = await startInspector({ root: repositoryRoot, port: 0 });
  const controller = new AbortController();
  try {
    const response = await fetch(`${started.url}/api/events/stream`, {
      headers: { 'Last-Event-ID': `${first.sequence}` },
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let body = '';

    const third = appendRuntimeEvent(repositoryRoot, {
      type: 'TASK_GRAPH_STATUS_CHANGED',
      taskId: 'task-graph-sse',
      agentId: 'codex',
      role: 'planner',
      data: { from: 'RUNNING', to: 'APPROVED' },
    });

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
  } finally {
    controller.abort();
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Inspector dashboard assets include Task Graph topology, frontier, conflict, and integration elements', async () => {
  const repositoryRoot = fixture();
  const started = await startInspector({ root: repositoryRoot, port: 0 });
  try {
    const html = await (await fetch(`${started.url}/index.html`)).text();
    assert.match(html, /id="graph-detail"/);
    assert.match(html, /id="graph-topology"/);
    assert.match(html, /id="graph-frontier"/);
    assert.match(html, /id="graph-conflicts"/);
    assert.match(html, /id="graph-integration"/);

    const js = await (await fetch(`${started.url}/app.js`)).text();
    assert.match(js, /renderGraphDetail/);
    assert.match(js, /graph-card/);
    assert.match(js, /graph-topology/);
    assert.match(js, /graph-frontier/);
    assert.match(js, /graph-conflicts/);
    assert.match(js, /graph-integration/);

    const css = await (await fetch(`${started.url}/styles.css`)).text();
    assert.match(css, /\.graph-card/);
    assert.match(css, /\.graph-detail/);
    assert.match(css, /\.graph-overview-grid/);
    assert.match(css, /\.graph-topology/);
    assert.match(css, /\.graph-facts/);
    assert.match(css, /\.graph-node/);
    assert.match(css, /\.graph-fact/);
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});

test('Inspector fails closed for malformed IDs, non-GET methods, symlinks, and path escapes without side effects', async () => {
  const repositoryRoot = fixture();
  graphFixture(repositoryRoot);
  const started = await startInspector({ root: repositoryRoot, port: 0 });
  try {
    // Non-GET methods must be rejected with 405 and Allow: GET header
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const endpoint of ['/api/tasks', '/api/graphs', '/api/tasks/task-inspector', '/api/graphs/task-graph-inspector', '/api/events']) {
        const res = await fetch(`${started.url}${endpoint}`, { method });
        assert.equal(res.status, 405, `${method} ${endpoint} must be rejected with 405`);
        assert.equal(res.headers.get('allow'), 'GET');
      }
    }

    // Malformed task and graph IDs must return 400 or 404 fail closed
    const malformed = ['task-$invalid', 'invalid-id', 'task-123%2F..%2F..%2Fetc', 'task-with-space '];
    for (const id of malformed) {
      const taskRes = await fetch(`${started.url}/api/tasks/${id}`);
      assert.ok([400, 404].includes(taskRes.status), `Malformed task id ${id} must fail closed`);
      const graphRes = await fetch(`${started.url}/api/graphs/${id}`);
      assert.ok([400, 404].includes(graphRes.status), `Malformed graph id ${id} must fail closed`);
    }

    // Path escapes
    const escapeRes = await fetch(`${started.url}/api/tasks/%2E%2E%2F%2E%2E%2Fpackage.json`);
    assert.ok([400, 404].includes(escapeRes.status));

    // Nonexistent IDs
    const notFoundTask = await fetch(`${started.url}/api/tasks/task-doesnotexist`);
    assert.equal(notFoundTask.status, 404);
    const notFoundGraph = await fetch(`${started.url}/api/graphs/task-doesnotexist`);
    assert.equal(notFoundGraph.status, 404);

    // Snapshot repository before and after inspector calls to prove NO side-effects
    function snapshotDir(dir) {
      const entries = [];
      function walk(current) {
        if (!existsSync(current)) return;
        for (const name of readdirSync(current).sort()) {
          const full = join(current, name);
          entries.push(full.slice(dir.length));
          try {
            const stat = readFileSync(full);
            entries.push(stat.byteLength);
          } catch {
            walk(full);
          }
        }
      }
      walk(dir);
      return entries;
    }

    const beforeSnapshot = snapshotDir(join(repositoryRoot, '.agent-bus'));

    // Perform multiple read operations
    await fetch(`${started.url}/api/tasks`);
    await fetch(`${started.url}/api/graphs`);
    await fetch(`${started.url}/api/tasks/task-graph-inspector`);
    await fetch(`${started.url}/api/graphs/task-graph-inspector`);
    await fetch(`${started.url}/api/tasks/task-inspector`);
    await fetch(`${started.url}/api/agents`);
    await fetch(`${started.url}/api/sessions`);
    await fetch(`${started.url}/api/events?limit=100`);

    const afterSnapshot = snapshotDir(join(repositoryRoot, '.agent-bus'));
    assert.deepEqual(beforeSnapshot, afterSnapshot, 'Inspector reads must produce zero mutations, events, or bus files');

    // Verify git status unchanged
    const gitStatus = spawnSync('git', ['status', '--porcelain'], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
    assert.equal(gitStatus.status, 0);
  } finally {
    await closeServer(started.server);
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
});
