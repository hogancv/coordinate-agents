import assert from 'node:assert/strict';
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
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { collaborationHealth } from '../inspector/web-workspace/collaboration-health.mjs';
import { createTask } from '../skills/coordinate-agents/scripts/task-runtime.mjs';
import { readConfig, writeConfig } from '../skills/coordinate-agents/scripts/config.mjs';
import {
  readWorkspaceTask,
  readWorkspaceTasks,
  runtimeWorkspaceTaskClose,
  runtimeWorkspaceTaskCreate,
  runtimeWorkspaceTaskRestart,
  runtimeWorkspaceTaskArchive,
  runtimeWorkspaceArchivesClear,
  runtimeWorkspaceTaskPromptSend,
  dispatchWorkspaceTask,
  reportWorkspaceTask,
  workspaceTerminalReady,
  createWorkspaceNativeIdentityStore,
} from '../skills/coordinate-agents/scripts/workspace-task-runtime.mjs';
import { fixtureIdentityAuthority } from './support/native-identity-authority.mjs';
import { listRecords } from '../skills/coordinate-agents/scripts/session-manager.mjs';
import { startWorkspace } from './support/workspace-server.mjs';
import { ACTION_ENDPOINT } from '../inspector/server/action-gateway.mjs';
import { workspaceRolePrompt } from '../skills/coordinate-agents/scripts/role-prompts.mjs';
import { workspaceMessage } from '../skills/coordinate-agents/scripts/workspace-message.mjs';
import { saveCustomWorkspaceConfig } from '../skills/coordinate-agents/scripts/workspace-custom-config.mjs';
import { invokeRuntimeOperation } from '../skills/coordinate-agents/scripts/workspace-services.mjs';
import { readRuntimeEvents } from '../skills/coordinate-agents/scripts/runtime-events.mjs';

const busTool = join(process.cwd(), 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');
const ACTIVE = new Set(['starting', 'running', 'idle', 'busy']);

test('Custom lifecycle keeps distinct generic slots, snapshots, explicit input and no cooperation', { timeout: 60_000 }, async () => {
  const root = repository();
  const custom = { terminal1: { command: process.execPath }, terminal2: { command: process.execPath }, prompts: { project: '"CUSTOM_SHARED"', terminal1: '', terminal2: '"CUSTOM_TWO"' } };
  let task, other;
  try {
    saveCustomWorkspaceConfig(root, custom);
    task = (await runtimeWorkspaceTaskCreate({ root, mode: 'custom' })).workspaceTask;
    assert.equal(task.mode, 'custom');
    assert.equal(task.startup, null);
    assert.equal(task.cooperation, null);
    assert.deepEqual(task.collaborationEvents, []);
    assert.notEqual(task.sessions.terminal1.sessionId, task.sessions.terminal2.sessionId);
    assert.equal(task.sessions.terminal1.nativeIdentity, undefined);
    assert.equal(task.sessions.terminal2.nativeIdentity, undefined);
    for (const session of listRecords(root)) {
      assert.equal(session.agent, 'workspace-custom');
      assert.equal(session.taskId, task.id);
      assert.ok(['terminal1', 'terminal2'].includes(session.subtaskId));
      assert.deepEqual(session.args, []);
      assert.doesNotMatch(session.outputTail, /CUSTOM_SHARED|workspace-message|planner-reviewer/);
    }
    await assert.rejects(runtimeWorkspaceTaskPromptSend({ root, workspaceTaskId: task.id, slot: 'terminal1' }), /confirm/i);
    await runtimeWorkspaceTaskPromptSend({ root, workspaceTaskId: task.id, slot: 'terminal1', confirmed: true, sessionCreatedAt: task.sessions.terminal1.createdAt });
    assert.doesNotMatch(JSON.stringify(readRuntimeEvents(root, { limit: 200 })), /CUSTOM_SHARED|CUSTOM_TWO/);
    await assert.rejects(dispatchWorkspaceTask(root, task.id, 'round-custom', () => assert.fail('must not deliver')), /custom/i);
    await assert.rejects(reportWorkspaceTask(root, task.id, 'DONE', 'round-custom'), /custom/i);
    await assert.rejects(workspaceMessage(root, task.id, 'send', 'not allowed'), /custom/i);
    assert.equal((await readWorkspaceTask(root, task.id)).sessions.terminal1.sessionId, task.sessions.terminal1.sessionId);
    saveCustomWorkspaceConfig(root, { ...custom, terminal1: { command: 'not-installed-irrelevant' }, prompts: { ...custom.prompts, project: 'changed' } });
    const firstIds = Object.values(task.sessions).map(s => s.sessionId);
    task = (await runtimeWorkspaceTaskRestart({ root, workspaceTaskId: task.id })).workspaceTask;
    assert.deepEqual(task.custom, custom);
    assert.ok(Object.values(task.sessions).every(s => !firstIds.includes(s.sessionId)));
    await assert.rejects(runtimeWorkspaceTaskPromptSend({ root, workspaceTaskId: task.id, slot: 'terminal1', confirmed: true, sessionCreatedAt: 'stale-generation' }), /changed/i);
    await assert.rejects(invokeRuntimeOperation('sessionWrite', { root, sessionId: firstIds[0], input: 'x' }), /owned/i);
    const file = join(root, '.agent-bus', 'workspace-tasks', `${task.id}.json`);
    const original = readFileSync(file, 'utf8');
    const corrupt = JSON.parse(original);
    [corrupt.sessions.terminal1.sessionId, corrupt.sessions.terminal2.sessionId] = [corrupt.sessions.terminal2.sessionId, corrupt.sessions.terminal1.sessionId];
    writeFileSync(file, JSON.stringify(corrupt));
    try {
      await assert.rejects(invokeRuntimeOperation('sessionRead', { root, sessionId: task.sessions.terminal1.sessionId }), /owned/i);
      await assert.rejects(runtimeWorkspaceTaskClose({ root, workspaceTaskId: task.id }), /binding/i);
      assert.ok(listRecords(root).filter(s => s.taskId === task.id && !firstIds.includes(s.id)).every(s => ACTIVE.has(s.state)));
    } finally { writeFileSync(file, original); }
    other = (await runtimeWorkspaceTaskCreate({ root, mode: 'custom', custom })).workspaceTask;
    await runtimeWorkspaceTaskArchive({ root, workspaceTaskId: task.id });
    assert.ok(listRecords(root).filter(s => s.taskId === task.id).every(s => !ACTIVE.has(s.state)));
    assert.equal((await runtimeWorkspaceArchivesClear({ root })).deletedSessions, 4);
    assert.ok(listRecords(root).filter(s => s.taskId === other.id).every(s => ACTIVE.has(s.state)));
  } finally { if (task) await closeGroup(root, task.id); if (other) await closeGroup(root, other.id); await removeTree(root); }
});

test('Custom partial startup failure rolls back only the owning task', { timeout: 40_000 }, async () => {
  const root = repository();
  const custom = { terminal1: { command: process.execPath }, terminal2: { command: 'not-installed-custom-fixture' }, prompts: { project: '', terminal1: '', terminal2: '' } };
  try {
    await assert.rejects(runtimeWorkspaceTaskCreate({ root, mode: 'custom', custom }));
    const tasks = await readWorkspaceTasks(root);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].status, 'ERROR');
    assert.ok(listRecords(root).every(s => !ACTIVE.has(s.state)));
  } finally { for (const task of await readWorkspaceTasks(root)) await closeGroup(root, task.id); await removeTree(root); }
});

test('Custom Codex uses inline scrollback while other custom commands keep their arguments', { timeout: 30_000, skip: process.platform === 'win32' }, async () => {
  const root = repository();
  let task;
  try {
    const fixture = fakeCli(root, 'codex');
    const command = join(root, 'codex');
    writeFileSync(command, readFileSync(fixture.args[0]), { mode: 0o755 });
    const custom = { terminal1: { command }, terminal2: { command: process.execPath }, prompts: { project: '', terminal1: '', terminal2: '' } };
    task = (await runtimeWorkspaceTaskCreate({ root, mode: 'custom', custom })).workspaceTask;
    const records = listRecords(root).filter(session => session.taskId === task.id);
    assert.deepEqual(records.find(session => session.subtaskId === 'terminal1').args, ['--no-alt-screen']);
    assert.deepEqual(records.find(session => session.subtaskId === 'terminal2').args, []);
  } finally { if (task) await closeGroup(root, task.id); await removeTree(root); }
});

test('Custom HTTP configuration, bounded creation, current-slot input and SSE are project bound', { timeout: 60_000 }, async () => {
  const root = repository();
  let started, task;
  try {
    started = await startWorkspace({ root, port: 0 });
    const base = started.url.replace('localhost', '127.0.0.1');
    const headers = { 'content-type': 'application/json', 'x-coordinate-agents-capability': started.capability };
    const post = (action, params) => fetch(`${base}/api/action`, { method: 'POST', headers, body: JSON.stringify({ action, params }) });
    const custom = { terminal1: { command: process.execPath }, terminal2: { command: process.execPath }, prompts: { project: '"HTTP_CUSTOM"', terminal1: '', terminal2: '' } };
    assert.equal((await post('workspaceCustomSettingsSave', { custom })).status, 200);
    assert.deepEqual((await (await fetch(`${base}/api/workspace-settings`, { headers })).json()).custom, custom);
    for (const params of [ { mode: 'custom', custom: { terminal1: { command: 'node --eval x' } } },
      { mode: 'default', custom }, { mode: 'custom', custom: { ...custom, extra: 'x' } }, { mode: 'custom', root: tmpdir() } ]) {
      assert.ok([400, 403].includes((await post('workspaceTaskCreate', params)).status));
    }
    task = (await (await post('workspaceTaskCreate', { mode: 'custom', custom: { terminal1: { command: process.execPath }, terminal2: { command: process.execPath } } })).json()).workspaceTask;
    assert.equal(task.mode, 'custom');
    assert.equal(task.custom.prompts.project, '"HTTP_CUSTOM"');
    assert.equal((await (await post('workspaceTaskPromptSend', { workspaceTaskId: task.id, slot: 'terminal1', confirmed: true, sessionCreatedAt: 'stale' })).json()).ok, false);
    for (const [slot, label] of [['terminal1', 'ONE'], ['terminal2', 'TWO']]) {
      const sessionId = task.sessions[slot].sessionId;
      assert.equal((await (await post('sessionWrite', { sessionId, input: `console.log("STREAM_${label}")`, submit: true })).json()).ok, true);
      const abort = new AbortController();
      const stream = await fetch(`${base}/api/sessions/${sessionId}/stream`, { headers, signal: abort.signal });
      assert.equal(stream.status, 200);
      const reader = stream.body.getReader();
      let output = '';
      const timeout = setTimeout(() => abort.abort(), 8000);
      try {
        while (!output.includes(`STREAM_${label}`)) { const chunk = await reader.read(); if (chunk.done) break; output += new TextDecoder().decode(chunk.value); }
        assert.match(output, new RegExp(`STREAM_${label}`));
        assert.doesNotMatch(output, new RegExp(`STREAM_${label === 'ONE' ? 'TWO' : 'ONE'}`));
      } finally { clearTimeout(timeout); abort.abort(); }
    }
    assert.equal((await (await post('workspaceTaskPromptSend', { workspaceTaskId: task.id, slot: 'terminal1', confirmed: true, sessionCreatedAt: task.sessions.terminal1.createdAt })).json()).ok, true);
    assert.equal((await post('workspaceCustomSettingsSave', { root: tmpdir(), custom })).status, 403);
  } finally {
    if (task) await closeGroup(root, task.id);
    if (started) await new Promise(done => { started.server.close(done); started.server.closeAllConnections?.(); });
    await removeTree(root);
  }
});

test('Workspace readiness recognizes ANSI-redrawn interactive prompts', () => {
  const paint = value => [...value].map(character => `\u001b[38;5;252m${character}\u001b[39m`).join('');
  assert.equal(workspaceTerminalReady('codex', `${paint('Starting MCP servers')}\n${paint('Ask Codex to do anything')}`), true);
  assert.equal(workspaceTerminalReady('codex', paint('Ask Codex to do anything')), true);
  assert.equal(workspaceTerminalReady('antigravity', paint('? for shortcuts')), true);
});

test('Workspace readiness does not mistake a stale input marker for folder trust approval', () => {
  assert.equal(workspaceTerminalReady('codex', 'Ask Codex to do anything\nTrust this folder?\n1. Trust and continue'), false);
  assert.equal(workspaceTerminalReady('antigravity', 'Welcome. You are currently not signed in.\nSigning in...\nDo you trust the contents of this project?\n> Yes, I trust this folder'), false);
  assert.equal(workspaceTerminalReady('antigravity', '? for shortcuts\nDo you trust the contents of this project?'), false);
  assert.equal(workspaceTerminalReady('codex', 'Trust this folder?\nAsk Codex to do anything'), true);
});

test('Codex placeholder input is not ready while its model header is still loading', () => {
  assert.equal(workspaceTerminalReady('codex', 'OpenAI Codex (v0.162.1)\nloading\nAsk Codex to do anything'), false);
  assert.equal(workspaceTerminalReady('codex', '│ OpenAI Codex (v0.162.1) │\n│                       │\n│ model: loading        │\nAsk Codex to do anything'), false);
  assert.equal(workspaceTerminalReady('codex', 'OpenAI Codex (v0.162.1)\ngpt-5.6-luna · max\nAsk Codex to do anything'), true);
  assert.equal(workspaceTerminalReady('codex', '│ OpenAI Codex (v0.162.1) │\n│                       │\n│ model: gpt-5.6-luna   │\nAsk Codex to do anything'), true);
  assert.equal(workspaceTerminalReady('codex', 'Ask Codex to do anything\nError: account/read failed during TUI bootstrap: workspace routing discovery timed out'), false);
});

test('Workspace readiness preserves prompt text between ST and BEL terminated OSC sequences', () => {
  const output = '\x1b]10;?\x1b\\\x1b]11;?\x1b\\\x1b[27;3HAsk Codex to do anything\x1b]0;Workspace\x07';
  assert.equal(workspaceTerminalReady('codex', output), true);
  assert.equal(workspaceTerminalReady('codex', '\x1b]0;Ask Codex to do anything\x07'), false);
});

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
  return realpathSync.native(root);
}

test('single-task reads ignore Session payload identities that differ from the requested file', async () => {
  const root = repository();
  try {
    const id = 'workspace-sessionfacts0001';
    const sessionId = 'session_viewtarget0001';
    const directory = join(root, '.agent-bus', 'workspace-tasks');
    mkdirSync(directory, { recursive: true });
    const timestamp = new Date().toISOString();
    writeFileSync(join(directory, `${id}.json`), JSON.stringify({ schemaVersion: 1, id, title: 'Session facts', status: 'CLOSED',
      promptVersion: '2.3.0-web-lite-2', createdAt: timestamp, updatedAt: timestamp,
      sessions: { codex: { slot: 'codex', agent: 'codex', role: 'planner-reviewer', sessionId },
        antigravity: { slot: 'antigravity', agent: 'antigravity', role: 'implementer', sessionId: null } },
      sessionHistory: [], error: null }));
    const sessions = join(root, '.agent-bus', 'sessions');
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, `${sessionId}.json`), JSON.stringify({ schemaVersion: 1, id: 'session_otheridentity0001',
      agent: 'codex', command: process.execPath, cwd: root, state: 'running', backend: 'node-pty',
      diagnostics: { nativeStatus: 'running' } }));
    const detail = await readWorkspaceTask(root, id);
    const listed = (await readWorkspaceTasks(root))[0];
    assert.equal(detail.promptVersion, '2.3.0-web-lite-2');
    assert.equal(detail.sessions.codex.state, null);
    assert.equal(detail.sessions.codex.backend, null);
    assert.equal(detail.sessions.codex.diagnostics, null);
    assert.deepEqual(detail.sessions, listed.sessions);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function fakeCli(root, name, { fail = false, auth = false, transientAuth = false, trust = false, inputDelayMs = 0, titleUpdates = false } = {}) {
  const log = join(root, `${name}-raw-input.log`);
  const termLog = join(root, `${name}-term.log`);
  const script = join(root, `${name}-cli.cjs`);
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const log = ${JSON.stringify(log)};
const termLog = ${JSON.stringify(termLog)};
if (process.argv.includes('--version')) { console.log('workspace-fixture 1.0.0'); process.exit(0); }
${titleUpdates ? "setInterval(() => process.stdout.write('\\x1b]0;title-' + Date.now() + '\\x07'), 80);" : ''}
${fail ? 'process.exit(17);' : trust ? `console.log('${name === 'codex' ? 'Ask Codex to do anything' : 'Welcome. You are currently not signed in.'}');
console.log('${name === 'codex' ? 'Trust this folder?' : 'Do you trust the contents of this project?'}');
console.log('${name === 'codex' ? '1. Trust and continue' : '> Yes, I trust this folder'}');
process.stdin.resume();
process.stdin.setRawMode?.(true);
let confirmed = false;
process.stdin.on('data', chunk => {
  fs.appendFileSync(log, Buffer.from(chunk).toString('hex'));
  if (!confirmed && chunk.includes(121)) {
    confirmed = true;
    console.log('\\x1b[2J${name === 'codex' ? 'Ask Codex to do anything' : '? for shortcuts'}');
  }
});` : auth ? `console.log('Welcome to the Antigravity CLI. You are currently not signed in.');
console.log('Select login method:');
console.log('Google OAuth');
process.stdin.resume();` : transientAuth ? `console.log('Welcome to the Antigravity CLI. You are currently not signed in.');
console.log('Signing in...');
setTimeout(() => {
  fs.writeFileSync(termLog, process.env.TERM || '');
  console.log('${name === 'codex' ? 'Starting MCP servers' : 'Generating...'}');
  console.log('${name}-ready');
  console.log('${name === 'codex' ? 'Ask Codex to do anything' : '? for shortcuts'}');
  process.stdin.setRawMode?.(true);
  process.stdin.resume();
}, 100);` : `fs.writeFileSync(termLog, process.env.TERM || '');
console.log('${name === 'codex' ? 'Starting MCP servers' : 'Generating...'}');
console.log('${name}-ready');
console.log('${name === 'codex' ? 'Ask Codex to do anything' : '? for shortcuts'}');
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', chunk => {
  const input = Buffer.from(chunk).toString('hex');
  if (${inputDelayMs} > 0) setTimeout(() => fs.appendFileSync(log, input), ${inputDelayMs});
  else fs.appendFileSync(log, input);
});`}
`;
  writeFileSync(script, source, 'utf8');
  return { command: process.execPath, args: [script], log, termLog };
}

function configurePair(root, codex, antigravity) {
  const bus = join(root, '.agent-bus');
  const config = readConfig(bus);
  config.agents = config.agents.map(agent => agent.id === 'codex'
    ? { ...agent, command: codex.command, args: codex.args }
    : agent.id === 'antigravity'
      ? { ...agent, command: antigravity.command, args: antigravity.args }
      : agent);
  writeConfig(bus, config);
}

async function closeGroup(root, id) {
  if (!id) return;
  try { await runtimeWorkspaceTaskClose({ root, workspaceTaskId: id }); } catch { /* Test cleanup is best effort. */ }
}

async function waitForCliInput(path, input, timeoutMs = 5_000) {
  const expected = Buffer.from(input).toString('hex');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path) && readFileSync(path, 'utf8').includes(expected)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`Mock CLI did not consume the expected input within ${timeoutMs}ms.`);
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

test('Workspace readiness ignores continuous title updates after the interactive prompt', { timeout: 40_000 }, async () => {
  const root = repository();
  const codex = fakeCli(root, 'codex', { titleUpdates: true });
  const antigravity = fakeCli(root, 'antigravity', { titleUpdates: true });
  configurePair(root, codex, antigravity);
  try {
    const created = await runtimeWorkspaceTaskCreate({ root });
    assert.equal(created.workspaceTask.status, 'RUNNING');
    await waitForCliInput(codex.log, workspaceRolePrompt('codex', 'en'));
    await waitForCliInput(antigravity.log, workspaceRolePrompt('antigravity', 'en'));
  } finally {
    for (const task of await readWorkspaceTasks(root)) await closeGroup(root, task.id);
    await removeTree(root);
  }
});

test('Workspace Task lifecycle creates an isolated pair, preserves history, and closes idempotently', { timeout: 90_000 }, async () => {
  const root = repository();
  const codex = fakeCli(root, 'codex');
  // An RPC write acknowledgement does not mean the CLI has consumed its input.
  // Reproduce that asynchronous boundary rather than relying on runner speed.
  const antigravity = fakeCli(root, 'antigravity', { inputDelayMs: 500 });
  configurePair(root, codex, antigravity);
  let workspaceTaskId = null;
  try {
    const created = await runtimeWorkspaceTaskCreate({ root, language: 'en' });
    const first = created.workspaceTask;
    workspaceTaskId = first.id;
    assert.match(first.id, /^workspace-[A-Za-z0-9_-]{8,}$/);
    assert.match(first.title, /^Task · \d{4}-\d{2}-\d{2} \d{2}:\d{2} · [A-Za-z0-9]{6}$/);
    assert.equal(first.status, 'RUNNING');
    assert.equal(first.promptVersion, '2.3.0-web-lite-3');
    assert.ok(first.sessions.codex.sessionId);
    assert.ok(first.sessions.antigravity.sessionId);
    assert.notEqual(first.sessions.codex.sessionId, first.sessions.antigravity.sessionId);
    assert.match(first.sessions.codex.runtimeGeneration, /^[0-9a-f-]{36}$/);
    assert.notEqual(first.sessions.codex.runtimeGeneration, first.sessions.antigravity.runtimeGeneration);
    assert.equal(first.sessions.codex.nativeIdentity.binding, null);
    assert.equal(first.sessions.codex.nativeIdentity.verification.state, 'UNAVAILABLE');
    assert.equal(readFileSync(codex.termLog, 'utf8'), 'xterm-256color');
    assert.equal(readFileSync(antigravity.termLog, 'utf8'), 'xterm-256color');
    await waitForCliInput(codex.log, workspaceRolePrompt('codex', 'en'));
    await waitForCliInput(antigravity.log, workspaceRolePrompt('antigravity', 'en'));

    const bound = listRecords(root).filter(session => session.taskId === first.id);
    assert.deepEqual(new Set(bound.map(session => session.agent)), new Set(['codex', 'antigravity']));
    assert.ok(bound.every(session => session.subtaskId === 'codex' || session.subtaskId === 'antigravity'));
    assert.equal(bound.find(session => session.agent === 'codex').runtimeGeneration, first.sessions.codex.runtimeGeneration);
    // Storage fixtures authenticate only their own opaque test attestations;
    // they do not claim real native CLI capture or register a production source.
    const identityAuthority = fixtureIdentityAuthority();
    const identityStore = createWorkspaceNativeIdentityStore({ root, verifyAttestation: identityAuthority.verifyAttestation });
    const originalIdentity = { schemaVersion: 1, projectRoot: root, taskId: first.id, slot: 'codex', adapter: 'codex-cli',
      conversationId: '11111111-1111-4111-8111-111111111111', sessionId: first.sessions.codex.sessionId,
      runtimeGeneration: first.sessions.codex.runtimeGeneration, sequence: 1, expectedRevision: 0,
      source: { id: 'fixture-authority', version: '1' }, observedAt: new Date().toISOString() };
    await identityStore.observe(identityAuthority.issue(originalIdentity));

    const helper = join(process.cwd(), 'skills', 'coordinate-agents', 'scripts', 'workspace-message.mjs');
    const messageCli = (...args) => {
      const result = spawnSync(process.execPath, [helper, workspaceTaskId, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 5000 });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return JSON.parse(result.stdout);
    };
    const sent = messageCli('send', 'web-lite-hello');
    assert.equal(sent.sessionId, first.sessions.antigravity.sessionId);
    assert.equal(sent.sent, true);
    await waitForCliInput(antigravity.log, 'web-lite-hello');
    assert.equal(sent.status, 'SENT');
    await waitForCliInput(antigravity.log, sent.roundId);
    let latest = sent;
    for (const state of ['working', 'done', 'reviewing', 'approved']) {
      const reported = messageCli('report', state, sent.roundId, `mock ${state}`);
      assert.equal(reported.status, state.toUpperCase());
      latest = messageCli('wait', `${latest.cursor}`, `${latest.revision}`, '1000');
      assert.equal(latest.status, state.toUpperCase());
      assert.equal(latest.pending, false);
    }
    const completed = await readWorkspaceTask(root, workspaceTaskId);
    assert.equal(completed.cooperation.status, 'APPROVED');
    assert.deepEqual(completed.collaborationEvents.map(event => event.status), ['SENT', 'WORKING', 'DONE', 'REVIEWING', 'APPROVED']);
    await dispatchWorkspaceTask(root, workspaceTaskId, 'round-health-restart', async () => {});
    await reportWorkspaceTask(root, workspaceTaskId, 'WORKING', 'round-health-restart', 'Progress before close', { notify: () => {} });
    const active = await readWorkspaceTask(root, workspaceTaskId);
    assert.equal(collaborationHealth(active, { now: Date.parse(active.cooperation.updatedAt) + 3600000 }).state, 'attention');
    assert.ok(Object.values(active.sessions).every(session => session.recordAvailable));
    const history = active.collaborationEvents;
    const closed = await runtimeWorkspaceTaskClose({ root, workspaceTaskId });
    // Closed pairs must not receive additional input through the lightweight helper.
    await assert.rejects(workspaceMessage(root, workspaceTaskId, 'send', 'hello'), /not ready/);
    assert.equal(closed.workspaceTask.status, 'CLOSED');
    assert.equal(closed.workspaceTask.cooperation.status, 'WORKING');
    assert.equal(collaborationHealth(closed.workspaceTask).signals.length, 0);
    assert.deepEqual(closed.workspaceTask.collaborationEvents, history);
    assert.equal(closed.workspaceTask.sessions.codex.nativeIdentity.binding.conversationId, originalIdentity.conversationId);
    assert.equal(closed.workspaceTask.sessions.codex.nativeIdentity.verification.state, 'UNAVAILABLE');
    assert.ok(closed.closedSessions.every(session => !ACTIVE.has(session.state)));
    const closedAgain = await runtimeWorkspaceTaskClose({ root, workspaceTaskId });
    assert.equal(closedAgain.workspaceTask.status, 'CLOSED');
    assert.ok(closedAgain.closedSessions.every(session => !ACTIVE.has(session.state)));

    // A fresh UUID would conflict with this immutable native binding. Refuse
    // before replacing Sessions; native Resume owns reopening bound Tasks.
    await assert.rejects(runtimeWorkspaceTaskRestart({ root, workspaceTaskId, language: 'zh-CN' }), /original conversation|new Task/i);
    const retained = await readWorkspaceTask(root, workspaceTaskId);
    assert.equal(retained.status, 'CLOSED');
    assert.deepEqual(retained.collaborationEvents, history);
    assert.deepEqual(retained.sessionHistory, closedAgain.workspaceTask.sessionHistory);
    assert.equal(retained.sessions.codex.sessionId, first.sessions.codex.sessionId);
    assert.equal(retained.sessions.antigravity.sessionId, first.sessions.antigravity.sessionId);
    assert.equal(retained.sessions.codex.nativeIdentity.binding.conversationId, originalIdentity.conversationId);
    await assert.rejects(identityStore.observe(identityAuthority.issue({ ...originalIdentity, observedAt: new Date().toISOString(),
      sequence: 2, expectedRevision: 1 })), error => error.details?.reason === 'TASK_UNAVAILABLE');

    const saved = JSON.parse(readFileSync(join(root, '.agent-bus', 'workspace-tasks', `${workspaceTaskId}.json`), 'utf8'));
    assert.equal(saved.sessions.codex.sessionId, first.sessions.codex.sessionId);
    assert.equal(saved.sessions.antigravity.sessionId, first.sessions.antigravity.sessionId);
    assert.equal(saved.promptVersion, '2.3.0-web-lite-3');
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

test('Workspace keeps login prompts interactive instead of treating them as startup failures', { timeout: 40000 }, async () => {
  const root = repository('coordinate-agents-workspace-task-auth-');
  configurePair(root, fakeCli(root, 'codex'), fakeCli(root, 'antigravity', { auth: true }));
  let id;
  try {
    const result = await runtimeWorkspaceTaskCreate({ root });
    id = result.workspaceTask.id;
    assert.equal(result.workspaceTask.status, 'AWAITING_INPUT');
    assert.equal(result.workspaceTask.startup.slots.antigravity, 'AUTH_REQUIRED');
    assert.equal(result.workspaceTask.error, null);
    assert.ok(listRecords(root).every(session => ACTIVE.has(session.state)));
  } finally {
    for (const task of await readWorkspaceTasks(root)) await closeGroup(root, task.id);
    await removeTree(root);
  }
});

test('Workspace Task waits for transient Antigravity authentication before failing', { timeout: 90_000 }, async () => {
  const root = repository('coordinate-agents-workspace-task-transient-auth-');
  const codex = fakeCli(root, 'codex');
  const antigravity = fakeCli(root, 'antigravity', { transientAuth: true });
  configurePair(root, codex, antigravity);
  let workspaceTaskId = null;
  try {
    const created = await runtimeWorkspaceTaskCreate({ root });
    workspaceTaskId = created.workspaceTask.id;
    assert.equal(created.workspaceTask.status, 'RUNNING');
    assert.ok(created.workspaceTask.sessions.antigravity.sessionId);
  } finally {
    await closeGroup(root, workspaceTaskId);
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
    // ConPTY translates valid keyboard sequences and discards unknown CSI
    // codes; use the real Up key rather than an undefined CSI 99~ sequence.
    const raw = await post('sessionWrite', { sessionId: codexSessionId, input: '\u001b[AZ\u0003', submit: false });
    assert.equal(raw.payload.ok, true, JSON.stringify(raw.payload.error || {}));
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (existsSync(codex.log) && readFileSync(codex.log, 'utf8').includes('1b5b415a03')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(readFileSync(codex.log, 'utf8'), /1b5b415a03/);

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

test('Web onboarding retains both terminals and resumes each role once after user input', { timeout: 60000 }, async () => {
  const root = repository('coordinate-web-onboarding-');
  const codex = fakeCli(root, 'codex', { trust: true });
  const antigravity = fakeCli(root, 'antigravity', { trust: true });
  configurePair(root, codex, antigravity);
  const { runtimeWorkspaceTaskContinue } = await import('../skills/coordinate-agents/scripts/workspace-task-runtime.mjs');
  const { invokeRuntimeOperation } = await import('../skills/coordinate-agents/scripts/workspace-services.mjs');
  try {
    const created = (await runtimeWorkspaceTaskCreate({ root })).workspaceTask;
    assert.equal(created.status, 'AWAITING_INPUT');
    assert.deepEqual(created.startup.slots, { codex: 'TRUST_REQUIRED', antigravity: 'TRUST_REQUIRED' });
    assert.ok(created.sessions.codex.sessionId && created.sessions.antigravity.sessionId);
    assert.ok(listRecords(root).every(session => ACTIVE.has(session.state)));
    assert.equal((await readWorkspaceTask(root, created.id)).status, 'AWAITING_INPUT');
    await runtimeWorkspaceTaskContinue({ root, workspaceTaskId: created.id });
    assert.equal(existsSync(codex.log) ? readFileSync(codex.log, 'utf8') : '', '');
    assert.equal(existsSync(antigravity.log) ? readFileSync(antigravity.log, 'utf8') : '', '');
    for (const slot of ['antigravity', 'codex']) {
      await invokeRuntimeOperation('sessionWrite', { root, sessionId: created.sessions[slot].sessionId, input: 'y\r', submit: false });
      const next = (await runtimeWorkspaceTaskContinue({ root, workspaceTaskId: created.id })).workspaceTask;
      assert.equal(next.startup.slots[slot], 'READY');
      assert.deepEqual(next.sessionIds, created.sessionIds);
      assert.equal(next.status, slot === 'codex' ? 'RUNNING' : 'AWAITING_INPUT');
    }
    await runtimeWorkspaceTaskContinue({ root, workspaceTaskId: created.id });
    for (const [slot, cli] of [['codex', codex], ['antigravity', antigravity]]) {
      await waitForCliInput(cli.log, workspaceRolePrompt(slot, 'en'));
      const log = readFileSync(cli.log, 'utf8');
      const prompt = Buffer.from(workspaceRolePrompt(slot, 'en')).toString('hex');
      assert.equal(log.split(prompt).length - 1, 1);
    }
    assert.equal(listRecords(root).length, 2);
    // Reproduce a process stopping after a Session exists but before its ID is bound.
    const file = join(root, '.agent-bus', 'workspace-tasks', `${created.id}.json`);
    const interrupted = JSON.parse(readFileSync(file, 'utf8'));
    interrupted.status = 'STARTING';
    interrupted.startup.slots = { codex: 'WAITING', antigravity: 'WAITING' };
    interrupted.sessions.antigravity.sessionId = null;
    delete interrupted.sessions.antigravity.runtimeGeneration;
    writeFileSync(file, JSON.stringify(interrupted));
    const recovered = (await runtimeWorkspaceTaskContinue({ root, workspaceTaskId: created.id })).workspaceTask;
    assert.equal(recovered.status, 'ERROR');
    assert.match(recovered.error.message, /Restart the pair/);
    const restarted = (await runtimeWorkspaceTaskRestart({ root, workspaceTaskId: created.id })).workspaceTask;
    assert.equal(restarted.status, 'AWAITING_INPUT');
    const sessionsAfterRestart = listRecords(root);
    assert.equal(sessionsAfterRestart.filter(session => ACTIVE.has(session.state)).length, 2);
    for (const oldId of Object.values(created.sessionIds)) assert.ok(!ACTIVE.has(sessionsAfterRestart.find(session => session.id === oldId).state));
  } finally {
    for (const task of await readWorkspaceTasks(root)) await closeGroup(root, task.id);
    await removeTree(root);
  }
});

test('startup screen parsing follows header redraws instead of keeping stale loading text', async () => {
  const { renderWorkspaceStartupScreen } = await import('../skills/coordinate-agents/scripts/workspace-task-runtime.mjs');
  const initial = '\x1b[1;1HOpenAI Codex (v0.162.1)\x1b[2;1Hloading\x1b[8;1HAsk Codex to do anything';
  const loading = await renderWorkspaceStartupScreen(initial, { cols: 80, rows: 24 });
  assert.equal(workspaceTerminalReady('codex', loading), false);
  const ready = await renderWorkspaceStartupScreen(initial + '\x1b[2;1Hgpt-5.6-luna · max\x1b[K', { cols: 80, rows: 24 });
  assert.equal(workspaceTerminalReady('codex', ready), true);
});

test('failed Codex account initialization is exposed in the task Session view', async () => {
  const root = repository('coordinate-codex-bootstrap-failure-');
  const id = 'workspace-bootstraperror1', sessionId = 'session_bootstraperror1';
  const directory = join(root, '.agent-bus', 'workspace-tasks');mkdirSync(directory, { recursive: true });
  const timestamp = new Date().toISOString();
  writeFileSync(join(directory, `${id}.json`), JSON.stringify({ schemaVersion: 1, id, title: 'Bootstrap failure', status: 'RUNNING', promptVersion: 'test', createdAt: timestamp, updatedAt: timestamp,
    sessions: { codex: { slot: 'codex', agent: 'codex', role: 'planner-reviewer', sessionId }, antigravity: { slot: 'antigravity', agent: 'antigravity', role: 'implementer', sessionId: null } }, sessionHistory: [], error: null }));
  mkdirSync(join(root, '.agent-bus', 'sessions'), { recursive: true });
  writeFileSync(join(root, '.agent-bus', 'sessions', `${sessionId}.json`), JSON.stringify({ schemaVersion: 1, id: sessionId, taskId: id, cwd: root, command: 'mock', agent: 'codex', state: 'failed', exitCode: 1,
    outputTail: 'Unsent draft: example\nError: account/read failed during TUI bootstrap: account/read failed: workspace routing discovery timed out (code -32603)' }));
  try {
    const task = await readWorkspaceTask(root, id);
    assert.match(task.sessions.codex.error, /workspace routing discovery timed out/);
    assert.equal(task.sessions.codex.startupFailure, 'account-init-timeout');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('current startup screen preserves spaces in Codex cursor-painted trust prompts', async () => {
  const { renderWorkspaceStartupScreen } = await import('../skills/coordinate-agents/scripts/workspace-task-runtime.mjs');
  const raw = '\x1b[1;1H\x1b[J\x1b[2;3HFolder access\x1b[5;3HTrust\x1b[5;9Hthis\x1b[5;14Hfolder?\x1b[9;3H1.\x1b[9;6HTrust\x1b[9;12Hand\x1b[9;16Hcontinue';
  const screen = await renderWorkspaceStartupScreen(raw, { cols: 80, rows: 24 });
  assert.match(screen, /Trust this folder\?/);
  assert.equal(workspaceTerminalReady('codex', screen), false);
});
