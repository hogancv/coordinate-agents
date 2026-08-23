import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  runtimeSetupConfigure,
  runtimeTaskCreate,
  runtimeTaskOperation,
} from '../bin/coordinate-agents.mjs';
import {
  runtimeSessionClose,
  runtimeSessionInspect,
  runtimeSessionOpen,
  runtimeSessionRead,
  runtimeSessionStatus,
  runtimeSessionWrite,
} from '../skills/coordinate-agents/scripts/session-service.mjs';
import { ExecutionSessionManager } from '../skills/coordinate-agents/scripts/session-manager.mjs';
import { readRuntimeEvents } from '../skills/coordinate-agents/scripts/runtime-events.mjs';

const busTool = join(process.cwd(), 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');

function repository(prefix = 'coordinate-agents-session-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const result = spawnSync('git', ['init', root], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const init = spawnSync(process.execPath, [busTool, 'init', '--root', root], { encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return root;
}

function isolatedHome() {
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-session-home-'));
  process.env.COORDINATE_AGENTS_HOME = home;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return home;
}

function persistentExecutable(root, name = 'agy-proxy', { crash = false, silent = false } = {}) {
  const directory = join(root, 'tools with spaces');
  mkdirSync(directory, { recursive: true });
  const command = join(directory, name);
  if (crash) {
    if (process.platform === 'win32') {
      const cmd = `${command}.cmd`;
      writeFileSync(cmd, '@if "%~1"=="--version" (echo persistent-fixture 1.0.0& exit /b 0)\r\n@exit /b 9\r\n', 'utf8');
      return cmd;
    }
    writeFileSync(command, '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo persistent-fixture 1.0.0\n  exit 0\nfi\nexit 9\n', 'utf8');
    chmodSync(command, 0o755);
    return command;
  }
  const source = `const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('persistent-fixture 1.0.0'); process.exit(0); }
if (process.env.FIXTURE_STARTS) fs.appendFileSync(process.env.FIXTURE_STARTS, 'S');
${silent ? '' : "console.log('persistent-fixture-ready');"}
let buffer = '';
const completed = new Set();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  const matches = [...buffer.matchAll(/Task ID:\\s*(task-[A-Za-z0-9_-]+)[\\s\\S]*?Round:\\s*(\\d+)/g)];
  for (const match of matches) {
    const key = match[1] + ':' + match[2];
    if (completed.has(key)) continue;
    completed.add(key);
    if (process.env.FIXTURE_DONE) fs.appendFileSync(process.env.FIXTURE_DONE, 'D');
    const result = cp.spawnSync(process.execPath, [process.env.BUS_TOOL, 'send', '--root', process.env.FIXTURE_ROOT, '--from', process.env.FIXTURE_AGENT, '--to', 'codex', '--type', 'IMPLEMENTATION_DONE', '--subject', 'persistent fixture done', '--related-commit', 'session1234', '--body', 'Task ID: ' + match[1] + '\\nimplementationCommit: session1234\\nPersistent PTY fixture completed'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) process.stderr.write(result.stderr || result.stdout || 'fixture send failed');
    console.log('persistent-fixture-done:' + key);
  }
});
`;
  if (process.platform === 'win32') {
    const script = `${command}.cjs`;
    writeFileSync(script, source, 'utf8');
    const cmd = `${command}.cmd`;
    writeFileSync(cmd, `@"${process.execPath}" "${script}" %*\r\n`, 'utf8');
    return cmd;
  }
  writeFileSync(command, `#!${process.execPath}\n${source}`, 'utf8');
  chmodSync(command, 0o755);
  return command;
}

async function configure(root, command, agent = 'antigravity', adapter = 'antigravity-cli', args = []) {
  const result = await runtimeSetupConfigure({ root, agent, command, adapter, args, role: 'implementer' });
  assert.equal(result.ok, true, JSON.stringify(result));
}

async function closeQuietly(root, sessionId) {
  try { await runtimeSessionClose({ root, sessionId, graceful: true, timeoutMs: 500 }); } catch { /* Cleanup is best effort after a crash. */ }
}

async function removeTree(path) {
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      if (!existsSync(path)) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (lastError) throw lastError;
}

test('Execution Session supports open, write, bounded read, inspect, status, and close', async () => {
  const root = repository();
  const home = isolatedHome();
  const command = persistentExecutable(root);
  const starts = join(root, 'starts.txt');
  const done = join(root, 'done.txt');
  process.env.FIXTURE_STARTS = starts;
  process.env.FIXTURE_DONE = done;
  process.env.FIXTURE_ROOT = root;
  process.env.FIXTURE_AGENT = 'antigravity';
  process.env.BUS_TOOL = busTool;
  try {
    await configure(root, command);
    const opened = await runtimeSessionOpen({ root, agent: 'antigravity' });
    assert.equal(opened.ok, true);
    assert.equal(opened.reused, false);
    assert.equal(opened.session.agent, 'antigravity');
    assert.equal(opened.session.command, command);
    assert.equal(opened.session.cwd, realpathSync(root));
    assert.ok(opened.session.pid);

    const status = await runtimeSessionStatus({ root, sessionId: opened.session.id });
    assert.ok(['running', 'idle', 'busy'].includes(status.session.state));
    await runtimeSessionWrite({ root, sessionId: opened.session.id, input: 'hello persistent session' });
    let inspected;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      inspected = await runtimeSessionInspect({ root, sessionId: opened.session.id, maxLines: 20, maxBytes: 4096 });
      if (inspected.output.output.includes('persistent-fixture-ready')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(inspected.output.output, /persistent-fixture-ready/);
    const read = await runtimeSessionRead({ root, sessionId: opened.session.id, maxLines: 20, maxBytes: 4096 });
    assert.match(read.output, /persistent-fixture/);
    const closed = await runtimeSessionClose({ root, sessionId: opened.session.id, timeoutMs: 500 });
    assert.ok(['exited', 'failed'].includes(closed.session.state));
    const eventTypes = readRuntimeEvents(root, { sessionId: opened.session.id, limit: 50 }).map(event => event.type);
    assert.ok(eventTypes.includes('SESSION_STARTING'));
    assert.ok(eventTypes.includes('SESSION_STARTED'));
    assert.ok(eventTypes.includes('SESSION_CLOSED'));
    assert.ok(eventTypes.indexOf('SESSION_STARTING') < eventTypes.indexOf('SESSION_STARTED'));
    assert.ok(eventTypes.indexOf('SESSION_STARTED') < eventTypes.indexOf('SESSION_CLOSED'));
    assert.equal(eventTypes.filter(type => type === 'SESSION_STARTED').length, 1);
    assert.equal(eventTypes.filter(type => type === 'SESSION_CLOSED').length, 1);
    assert.equal((readFileSync(starts, 'utf8') || '').length, 1);
  } finally {
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
  }
});

test('silent healthy CLI starts promptly and records one ordered startup lifecycle', async () => {
  const root = repository('coordinate-agents-session-silent-');
  const home = isolatedHome();
  const command = persistentExecutable(root, 'agy-silent', { silent: true });
  process.env.FIXTURE_STARTS = join(root, 'starts.txt');
  process.env.FIXTURE_DONE = join(root, 'done.txt');
  process.env.FIXTURE_ROOT = root;
  process.env.FIXTURE_AGENT = 'antigravity';
  process.env.BUS_TOOL = busTool;
  let sessionId = null;
  try {
    await configure(root, command);
    const startedAt = Date.now();
    const opened = await runtimeSessionOpen({ root, agent: 'antigravity' });
    const elapsedMs = Date.now() - startedAt;
    sessionId = opened.session.id;
    assert.equal(opened.ok, true);
    assert.equal(opened.reused, false);
    assert.ok(['running', 'idle', 'busy'].includes(opened.session.state));
    assert.ok(elapsedMs < 4_000, `silent session startup took ${elapsedMs}ms`);

    const eventTypes = readRuntimeEvents(root, { sessionId, limit: 50 }).map(event => event.type);
    assert.deepEqual(eventTypes.filter(type => ['SESSION_STARTING', 'SESSION_STARTED', 'SESSION_FAILED'].includes(type)), [
      'SESSION_STARTING',
      'SESSION_STARTED',
    ]);

    await runtimeSessionStatus({ root, sessionId });
    await runtimeSessionRead({ root, sessionId, maxLines: 20, maxBytes: 4096 });
    const afterRead = readRuntimeEvents(root, { sessionId, limit: 50 }).map(event => event.type);
    assert.equal(afterRead.filter(type => type === 'SESSION_STARTED').length, 1);
  } finally {
    if (sessionId) await closeQuietly(root, sessionId);
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
  }
});

test('Task dispatch reuses the same healthy session after CHANGES_REQUESTED', async () => {
  const root = repository('coordinate-agents-session-reuse-');
  const home = isolatedHome();
  const command = persistentExecutable(root);
  const starts = join(root, 'starts.txt');
  const done = join(root, 'done.txt');
  process.env.FIXTURE_STARTS = starts;
  process.env.FIXTURE_DONE = done;
  process.env.FIXTURE_ROOT = root;
  process.env.FIXTURE_AGENT = 'antigravity';
  process.env.BUS_TOOL = busTool;
  try {
    await configure(root, command);
    await runtimeTaskCreate({ root, id: 'task-session-reuse', title: 'Persistent task', spec: 'Implement the persistent fixture workflow.' });
    const first = await runtimeTaskOperation('dispatch', { root, taskId: 'task-session-reuse' });
    assert.equal(first.task.status, 'REVIEWING');
    const firstSessionId = first.task.sessionId;
    assert.ok(firstSessionId);
    await runtimeTaskOperation('review', { root, taskId: 'task-session-reuse', decision: 'CHANGES_REQUESTED', feedback: 'Keep the same coding-agent context and address this finding.' });
    const second = await runtimeTaskOperation('dispatch', { root, taskId: 'task-session-reuse' });
    assert.equal(second.task.status, 'REVIEWING');
    assert.equal(second.task.sessionId, firstSessionId);
    assert.equal(second.session.reused, true);
    assert.equal(readFileSync(starts, 'utf8'), 'S');
    assert.equal(readFileSync(done, 'utf8'), 'DD');
    const sessionEventTypes = readRuntimeEvents(root, { sessionId: firstSessionId, limit: 100 }).map(event => event.type);
    assert.ok(sessionEventTypes.includes('SESSION_REUSED'));
    assert.equal(sessionEventTypes.filter(type => type === 'SESSION_STARTED').length, 1);
    assert.equal(sessionEventTypes.filter(type => type === 'SESSION_REUSED').length, 1);

    const otherManager = new ExecutionSessionManager();
    const attached = await otherManager.status(root, firstSessionId);
    assert.equal(attached.id, firstSessionId);
    assert.equal(attached.command, command);
    await closeQuietly(root, firstSessionId);
  } finally {
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
  }
});

test('sessions are isolated by root and Agent identity, and custom executable names are preserved', async () => {
  const rootA = repository('coordinate-agents-session-root-a-');
  const rootB = repository('coordinate-agents-session-root-b-');
  const home = isolatedHome();
  const commandA = persistentExecutable(rootA, 'agy-proxy');
  const commandC = persistentExecutable(rootA, 'claude-bot');
  const sessions = [];
  try {
    await configure(rootA, commandA);
    await configure(rootB, commandA);
    const first = await runtimeSessionOpen({ root: rootA, agent: 'antigravity' });
    const second = await runtimeSessionOpen({ root: rootB, agent: 'antigravity' });
    assert.notEqual(first.session.id, second.session.id);
    assert.equal(first.session.command, commandA);
    assert.equal(second.session.command, commandA);
    sessions.push([rootA, first.session.id], [rootB, second.session.id]);

    await configure(rootA, commandC, 'claude-bot', 'generic-cli', ['--interactive']);
    const otherAgent = await runtimeSessionOpen({ root: rootA, agent: 'claude-bot' });
    assert.notEqual(otherAgent.session.id, first.session.id);
    assert.equal(otherAgent.session.agent, 'claude-bot');
    sessions.push([rootA, otherAgent.session.id]);
  } finally {
    for (const [root, id] of sessions) await closeQuietly(root, id);
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('missing executable fails fast and a crashed session becomes inspectable without retry', async () => {
  const root = repository('coordinate-agents-session-failure-');
  const home = isolatedHome();
  process.env.FIXTURE_STARTS = join(root, 'starts.txt');
  process.env.FIXTURE_DONE = join(root, 'done.txt');
  process.env.FIXTURE_ROOT = root;
  process.env.FIXTURE_AGENT = 'antigravity';
  process.env.BUS_TOOL = busTool;
  try {
    const configPath = join(root, '.agent-bus', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    config.agents.find(agent => agent.id === 'antigravity').command = 'definitely-missing-coordinate-agents-cli';
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await assert.rejects(
      runtimeSessionOpen({ root, agent: 'antigravity' }),
      error => error.code === 'EXECUTABLE_NOT_FOUND',
    );

    const crashCommand = persistentExecutable(root, 'agy-crash', { crash: true });
    const restoredConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    delete restoredConfig.agents.find(agent => agent.id === 'antigravity').command;
    writeFileSync(configPath, `${JSON.stringify(restoredConfig, null, 2)}\n`, 'utf8');
    await configure(root, crashCommand);
    const opened = await runtimeSessionOpen({ root, agent: 'antigravity' });
    let status = opened.session;
    for (let attempt = 0; attempt < 100 && ['starting', 'running', 'idle', 'busy'].includes(status.state); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
      status = (await runtimeSessionStatus({ root, sessionId: opened.session.id })).session;
    }
    assert.equal(status.state, 'failed');
    assert.equal(status.exitCode, 9);
    const inspected = await runtimeSessionInspect({ root, sessionId: opened.session.id });
    assert.equal(inspected.session.state, 'failed');
    assert.equal(inspected.session.exitCode, 9);
    const eventTypes = readRuntimeEvents(root, { sessionId: opened.session.id, limit: 50 }).map(event => event.type);
    assert.ok(eventTypes.includes('SESSION_STARTING'));
    assert.ok(eventTypes.includes('SESSION_FAILED'));
    assert.equal(eventTypes.includes('SESSION_STARTED'), false);
    assert.equal(eventTypes.filter(type => type === 'SESSION_FAILED').length, 1);
  } finally {
    await removeTree(root);
    rmSync(home, { recursive: true, force: true });
  }
});
