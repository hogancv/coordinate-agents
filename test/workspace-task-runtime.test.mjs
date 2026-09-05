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
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createTask } from '../skills/coordinate-agents/scripts/task-runtime.mjs';
import { readConfig, writeConfig } from '../skills/coordinate-agents/scripts/config.mjs';
import {
  readWorkspaceTask,
  readWorkspaceTasks,
  runtimeWorkspaceTaskClose,
  runtimeWorkspaceTaskCreate,
  runtimeWorkspaceTaskRestart,
} from '../skills/coordinate-agents/scripts/workspace-task-runtime.mjs';
import { listRecords } from '../skills/coordinate-agents/scripts/session-manager.mjs';
import { startWorkspace } from '../inspector/server/server.mjs';
import { ACTION_ENDPOINT } from '../inspector/server/action-gateway.mjs';
import { workspaceRolePrompt } from '../skills/coordinate-agents/scripts/role-prompts.mjs';

const busTool = join(process.cwd(), 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');
const ACTIVE = new Set(['starting', 'running', 'idle', 'busy']);

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function repository(prefix = 'coordinate-agents-workspace-task-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'workspace-task@example.com']);
  git(root, ['config', 'user.name', 'Workspace Task']);
  writeFileSync(join(root, 'README.md'), '# Workspace Task fixture\n', 'utf8');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'chore: workspace task fixture']);
  const init = spawnSync(process.execPath, [busTool, 'init', '--root', root], { encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return realpathSync(root);
}

function fakeCli(root, name, { fail = false, auth = false } = {}) {
  const log = join(root, `${name}-raw-input.log`);
  const termLog = join(root, `${name}-term.log`);
  const command = join(root, `${name}-cli`);
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const log = ${JSON.stringify(log)};
const termLog = ${JSON.stringify(termLog)};
if (process.argv.includes('--version')) { console.log('workspace-fixture 1.0.0'); process.exit(0); }
${fail ? 'process.exit(17);' : auth ? `console.log('Welcome to the Antigravity CLI. You are currently not signed in.');
console.log('Select login method:');
console.log('Google OAuth');
process.stdin.resume();` : `fs.writeFileSync(termLog, process.env.TERM || '');
console.log('${name === 'codex' ? 'Starting MCP servers' : 'Generating...'}');
console.log('${name}-ready');
console.log('${name === 'codex' ? 'Ask Codex to do anything' : '? for shortcuts'}');
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', chunk => fs.appendFileSync(log, Buffer.from(chunk).toString('hex')));`}
`;
  writeFileSync(command, source, 'utf8');
  chmodSync(command, 0o755);
  return { command, log, termLog };
}

function configurePair(root, codex, antigravity) {
  const bus = join(root, '.agent-bus');
  const config = readConfig(bus);
  config.agents = config.agents.map(agent => agent.id === 'codex'
    ? { ...agent, command: codex.command }
    : agent.id === 'antigravity'
      ? { ...agent, command: antigravity.command }
      : agent);
  writeConfig(bus, config);
}

async function closeGroup(root, id) {
  if (!id) return;
  try { await runtimeWorkspaceTaskClose({ root, workspaceTaskId: id }); } catch { /* Test cleanup is best effort. */ }
}

async function removeTree(root) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      rmSync(root, { recursive: true, force: true });
      if (!existsSync(root)) return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  rmSync(root, { recursive: true, force: true });
}

test('Workspace Task lifecycle creates an isolated pair, preserves history, and closes idempotently', { timeout: 90_000 }, async () => {
  const root = repository();
  const codex = fakeCli(root, 'codex');
  const antigravity = fakeCli(root, 'antigravity');
  configurePair(root, codex, antigravity);
  let workspaceTaskId = null;
  try {
    const created = await runtimeWorkspaceTaskCreate({ root, language: 'en' });
    const first = created.workspaceTask;
    workspaceTaskId = first.id;
    assert.match(first.id, /^workspace-[A-Za-z0-9_-]{8,}$/);
    assert.match(first.title, /^Task · \d{4}-\d{2}-\d{2} \d{2}:\d{2} · [A-Za-z0-9]{6}$/);
    assert.equal(first.status, 'RUNNING');
    assert.equal(first.promptVersion, '2.3.0');
    assert.ok(first.sessions.codex.sessionId);
    assert.ok(first.sessions.antigravity.sessionId);
    assert.notEqual(first.sessions.codex.sessionId, first.sessions.antigravity.sessionId);
    assert.equal(readFileSync(codex.termLog, 'utf8'), 'xterm-256color');
    assert.equal(readFileSync(antigravity.termLog, 'utf8'), 'xterm-256color');
    assert.ok(readFileSync(codex.log, 'utf8').includes(Buffer.from(workspaceRolePrompt('codex', 'en')).toString('hex')));
    assert.ok(readFileSync(antigravity.log, 'utf8').includes(Buffer.from(workspaceRolePrompt('antigravity', 'en')).toString('hex')));

    const bound = listRecords(root).filter(session => session.taskId === first.id);
    assert.deepEqual(new Set(bound.map(session => session.agent)), new Set(['codex', 'antigravity']));
    assert.ok(bound.every(session => session.subtaskId === 'codex' || session.subtaskId === 'antigravity'));

    const closed = await runtimeWorkspaceTaskClose({ root, workspaceTaskId });
    assert.equal(closed.workspaceTask.status, 'CLOSED');
    assert.ok(closed.closedSessions.every(session => !ACTIVE.has(session.state)));
    const closedAgain = await runtimeWorkspaceTaskClose({ root, workspaceTaskId });
    assert.equal(closedAgain.workspaceTask.status, 'CLOSED');
    assert.ok(closedAgain.closedSessions.every(session => !ACTIVE.has(session.state)));

    const restarted = await runtimeWorkspaceTaskRestart({ root, workspaceTaskId, language: 'zh-CN' });
    assert.equal(restarted.workspaceTask.status, 'RUNNING');
    assert.notEqual(restarted.workspaceTask.sessions.codex.sessionId, first.sessions.codex.sessionId);
    assert.notEqual(restarted.workspaceTask.sessions.antigravity.sessionId, first.sessions.antigravity.sessionId);
    assert.equal(restarted.workspaceTask.sessionHistory.length, 1);
    assert.equal(restarted.workspaceTask.sessionHistory[0].codexSessionId, first.sessions.codex.sessionId);
    assert.equal(restarted.workspaceTask.sessionHistory[0].antigravitySessionId, first.sessions.antigravity.sessionId);

    const saved = JSON.parse(readFileSync(join(root, '.agent-bus', 'workspace-tasks', `${workspaceTaskId}.json`), 'utf8'));
    assert.equal(saved.sessions.codex.sessionId, restarted.workspaceTask.sessions.codex.sessionId);
    assert.equal(saved.sessions.antigravity.sessionId, restarted.workspaceTask.sessions.antigravity.sessionId);
    assert.equal(saved.promptVersion, '2.3.0');
    assert.equal((await readWorkspaceTask(root, workspaceTaskId)).id, workspaceTaskId);
  } finally {
    await closeGroup(root, workspaceTaskId);
    await removeTree(root);
  }
});

test('Workspace Task startup failure rolls back the first terminal and keeps both audit IDs', { timeout: 90_000 }, async () => {
  const root = repository('coordinate-agents-workspace-task-failure-');
  const codex = fakeCli(root, 'codex');
  const antigravity = fakeCli(root, 'antigravity', { fail: true });
  configurePair(root, codex, antigravity);
  try {
    await assert.rejects(
      runtimeWorkspaceTaskCreate({ root }),
      error => error.code === 'WORKSPACE_TASK_START_FAILED',
    );
    const tasks = await readWorkspaceTasks(root);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, 'ERROR');
    assert.ok(tasks[0].sessions.codex.sessionId);
    assert.ok(tasks[0].sessions.antigravity.sessionId);
    const sessions = listRecords(root);
    assert.equal(sessions.length, 2);
    assert.ok(sessions.every(session => !ACTIVE.has(session.state)));
    assert.ok(tasks[0].error?.code);
  } finally {
    await removeTree(root);
  }
});

test('Workspace Task reports explicit Antigravity authentication blockers', { timeout: 90_000 }, async () => {
  const root = repository('coordinate-agents-workspace-task-auth-');
  const codex = fakeCli(root, 'codex');
  const antigravity = fakeCli(root, 'antigravity', { auth: true });
  configurePair(root, codex, antigravity);
  try {
    await assert.rejects(
      runtimeWorkspaceTaskCreate({ root }),
      error => error.code === 'WORKSPACE_TASK_START_FAILED'
        && JSON.stringify(error.details || '').includes('AUTH_REQUIRED')
        && JSON.stringify(error.details || '').includes('authentication'),
    );
    const tasks = await readWorkspaceTasks(root);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, 'ERROR');
    assert.match(`${tasks[0].error?.details || ''}`, /Sign in with the CLI/);
    assert.ok(listRecords(root).every(session => !ACTIVE.has(session.state)));
  } finally {
    await removeTree(root);
  }
});

test('Workspace Gateway exposes pair lifecycle, raw PTY input, resize, and hides standard Tasks', { timeout: 120_000 }, async () => {
  const root = repository('coordinate-agents-workspace-task-gateway-');
  const codex = fakeCli(root, 'codex');
  const antigravity = fakeCli(root, 'antigravity');
  configurePair(root, codex, antigravity);
  const standard = createTask(root, { id: 'task-hidden-from-workspace', title: 'Legacy Task' });
  const started = await startWorkspace({ root, port: 0 });
  let workspaceTaskId = null;
  try {
    const page = await (await fetch(`${started.url}/`)).text();
    const capability = (page.match(/name="coordinate-agents-capability" content="([^"]+)"/) || [])[1];
    assert.ok(capability);
    const post = async (action, params = {}) => {
      const response = await fetch(`${started.url}${ACTION_ENDPOINT}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-coordinate-agents-capability': capability,
        },
        body: JSON.stringify({ action, params }),
      });
      return { status: response.status, payload: await response.json() };
    };

    const list = await (await fetch(`${started.url}/api/workspace-tasks`)).json();
    assert.equal(list.some(task => task.id === standard.id), false);
    assert.equal(list.length, 0);

    const created = await post('workspaceTaskCreate', { language: 'en' });
    assert.equal(created.status, 200);
    assert.equal(created.payload.ok, true, JSON.stringify(created.payload.error || {}));
    workspaceTaskId = created.payload.workspaceTask.id;
    const codexSessionId = created.payload.workspaceTask.sessions.codex.sessionId;
    assert.ok(codexSessionId);

    const resized = await post('sessionResize', { sessionId: codexSessionId, cols: 100, rows: 32 });
    assert.equal(resized.payload.ok, true, JSON.stringify(resized.payload.error || {}));
    const raw = await post('sessionWrite', { sessionId: codexSessionId, input: '\u001b[99~Z\u0003', submit: false });
    assert.equal(raw.payload.ok, true, JSON.stringify(raw.payload.error || {}));
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (existsSync(codex.log) && readFileSync(codex.log, 'utf8').includes('1b5b39397e5a03')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(readFileSync(codex.log, 'utf8'), /1b5b39397e5a03/);

    const closed = await post('workspaceTaskClose', { workspaceTaskId });
    assert.equal(closed.payload.ok, true, JSON.stringify(closed.payload.error || {}));
    const restarted = await post('workspaceTaskRestart', { workspaceTaskId, language: 'zh-CN' });
    assert.equal(restarted.payload.ok, true, JSON.stringify(restarted.payload.error || {}));
    assert.notEqual(restarted.payload.workspaceTask.sessions.codex.sessionId, codexSessionId);
    assert.equal(restarted.payload.workspaceTask.sessionHistory.length, 1);
    const exact = await (await fetch(`${started.url}/api/workspace-tasks/${workspaceTaskId}`)).json();
    assert.deepEqual(exact.sessionIds, restarted.payload.workspaceTask.sessionIds);
  } finally {
    await closeGroup(root, workspaceTaskId);
    started.server.closeAllConnections?.();
    await new Promise(resolve => started.server.close(resolve));
    await removeTree(root);
  }
});
