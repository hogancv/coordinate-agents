import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCustomWorkspaceConfig, saveCustomWorkspaceConfig, validateCustomWorkspaceConfig, validateTerminalCommand, customPromptInput } from '../skills/coordinate-agents/scripts/workspace-custom-config.mjs';
import { selectTerminalPanes } from '../inspector/web-workspace/terminal-model.mjs';
import { reviewTargetError } from '../inspector/web-workspace/review-feedback.mjs';
import { customTerminalDefaults, customTerminalPrompt } from '../inspector/web-workspace/custom-terminal-model.mjs';
import { sameCustomPromptTarget } from '../inspector/web-workspace/custom-terminal-model.mjs';
import { PtyRuntime } from '../skills/coordinate-agents/scripts/pty-runtime.mjs';
import { writeUserConfig } from '../skills/coordinate-agents/scripts/user-config.mjs';

const custom = (command = 'codex') => ({ terminal1: { command }, terminal2: { command: 'agy' }, prompts: { project: '中文 🙂', terminal1: 'Review', terminal2: '' } });

test('custom config validates executable identity and byte-bounded Unicode prompts', () => {
  assert.deepEqual(validateCustomWorkspaceConfig(custom()), custom());
  for (const command of ['codex', 'agy-proxy', 'C:\\Program Files\\Agent\\cli.exe', '/opt/agent tools/cli']) assert.equal(validateTerminalCommand(command), command);
  for (const command of ['codex --model x', 'codex|agy', 'codex && agy', '$(whoami)', '%PATH%', './cli', 'C:cli', 'codex\n']) assert.throws(() => validateTerminalCommand(command));
  assert.throws(() => validateCustomWorkspaceConfig({ ...custom(), extra: true }));
  assert.throws(() => validateCustomWorkspaceConfig({ ...custom(), terminal1: { command: 'codex', args: ['--help'] } }));
  assert.throws(() => validateCustomWorkspaceConfig({ ...custom(), prompts: { ...custom().prompts, project: '🙂'.repeat(2049) } }));
  assert.throws(() => validateCustomWorkspaceConfig({ ...custom(), prompts: { ...custom().prompts, terminal2: '\x1b[2J' } }));
});

test('custom config is project isolated and never modifies agent definitions', () => {
  const roots = [mkdtempSync(join(tmpdir(), 'custom-config-')), mkdtempSync(join(tmpdir(), 'custom-config-'))];
  try {
    for (const root of roots) mkdirSync(join(root, '.agent-bus', 'tmp'), { recursive: true });
    saveCustomWorkspaceConfig(roots[0], custom());
    assert.deepEqual(readCustomWorkspaceConfig(roots[0]), custom());
    assert.equal(readCustomWorkspaceConfig(roots[1]).prompts.project, '');
    const disk = JSON.parse(readFileSync(join(roots[0], '.agent-bus', 'workspace-custom.json')));
    assert.equal(disk.schemaVersion, 1);
    assert.deepEqual(disk.custom, custom());
  } finally { for (const root of roots) rmSync(root, { recursive: true, force: true }); }
});

test('custom terminal selection uses stable slots and refuses default review target', () => {
  const task = { mode: 'custom', id: 'workspace-test', status: 'RUNNING', custom: custom(), sessions: { terminal1: { sessionId: 'session_one', state: 'running' }, terminal2: { sessionId: 'session_two', state: 'idle' } } };
  const panes = selectTerminalPanes({ workspaceTask: task });
  assert.deepEqual(panes.map(p => p.slotId), ['terminal1', 'terminal2']);
  assert.deepEqual(panes.map(p => p.sessionId), ['session_one', 'session_two']);
  assert.deepEqual(panes.map(p => p.role), ['custom', 'custom']);
  assert.equal(reviewTargetError({ projectId: 'p', taskId: task.id, task }), 'reviewCustomTask');
});

test('custom UI defaults and prompt composition are independent per terminal', () => {
  assert.equal(customTerminalDefaults().terminal2.command, 'agy');
  assert.equal(customTerminalDefaults({ codex: { command: 'my-codex' } }).terminal1.command, 'my-codex');
  assert.equal(customTerminalDefaults({ custom: custom('saved') }).terminal1.command, 'saved');
  const task = { mode: 'custom', custom: custom() };
  assert.equal(customTerminalPrompt(task, 'terminal1'), '中文 🙂\n\n---\n\nReview');
  assert.equal(customTerminalPrompt(task, 'terminal2'), '中文 🙂');
  assert.equal(customTerminalPrompt({ mode: 'default' }, 'terminal1'), '');
  assert.equal(customPromptInput('中文\n\n---\n\n🙂'), '\x1b[200~中文\n\n---\n\n🙂\x1b[201~\r');
});

test('Web creation is explicit and custom Prompt delivery reserves the keyboard queue', () => {
  const app = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../inspector/web-workspace/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="workspace-create-form"/);
  assert.match(html, /id="custom-project-prompt"/);
  assert.match(html, /id="custom-prompt-ready"/);
  assert.match(app, /addEventListener\('click', openCreateTask\)/);
  assert.match(app, /controller\.promptWriting = true/);
  assert.match(app, /await previous/);
  assert.match(app, /postAction\('workspaceTaskPromptSend'/);
});

test('Custom multiline paste reaches the PTY as literal LF with one final Enter', () => {
  const input = customPromptInput('Project 中文\n\n---\n\nTerminal 🙂');
  const writes = [];
  const fake = { pty: { write: bytes => writes.push(bytes) }, pid: 1, isActive: () => true,
    _setState() {}, _scheduleIdle() {}, snapshot: () => ({}) };
  PtyRuntime.prototype.write.call(fake, input, { submit: false });
  assert.deepEqual(writes, [input]);
  assert.equal(writes[0].match(/\r/g).length, 1);
  assert.equal(writes[0].match(/\n/g).length, 4);
});

test('Initial custom defaults use existing user command precedence without changing it', () => {
  const home = mkdtempSync(join(tmpdir(), 'custom-user-'));
  const root = join(home, 'project'); mkdirSync(join(root, '.agent-bus'), { recursive: true });
  const previous = process.env.COORDINATE_AGENTS_HOME;
  try {
    process.env.COORDINATE_AGENTS_HOME = home;
    writeUserConfig({ version: 1, agents: { antigravity: { command: 'agy-proxy' } } });
    assert.equal(readCustomWorkspaceConfig(root).terminal2.command, 'agy-proxy');
  } finally { if (previous === undefined) delete process.env.COORDINATE_AGENTS_HOME; else process.env.COORDINATE_AGENTS_HOME = previous; rmSync(home, { recursive: true, force: true }); }
});

test('Custom UI drains prior input, blocks raw typing, and never retries uncertain delivery', async () => {
  const app = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
  const fields = new Map(['custom-prompt-send', 'custom-prompt-ready', 'custom-prompt-preview', 'custom-prompt-status'].map(id => [`#${id}`, { disabled: false, checked: true, value: 'Prompt', textContent: '' }]));
  const task = { id: 'task', mode: 'custom', status: 'RUNNING', sessions: { terminal1: { sessionId: 'session', createdAt: 'time', state: 'running' } } };
  const target = { projectId: 'project', projectEpoch: 1, taskId: 'task', slot: 'terminal1', sessionId: 'session', sessionCreatedAt: 'time' };
  let release, calls = 0;
  const controller = { disposed: false, inputQueue: new Promise(done => { release = done; }) };
  const state = { projectId: 'project', projectEpoch: 1, selectedId: 'task', selectedTask: task, promptTarget: target, promptBusy: false, terminalViews: new Map([['terminal1', controller]]) };
  const context = vm.createContext({ state, document: { querySelector: id => fields.get(id) }, t: key => key, sameCustomPromptTarget,
    sessionIsActive: s => s?.state === 'running', fetchJson: async () => task, postAction: async () => { calls++; throw new Error('network uncertain'); }, scheduleTerminalRead() {}, showToast() {} });
  vm.runInContext(app.slice(app.indexOf('function currentPromptTarget('), app.indexOf('async function createTask(')), context);
  vm.runInContext(app.slice(app.indexOf('function enqueueRawInput('), app.indexOf('function terminalSize(')), context);
  const sent = context.sendCustomPrompt();
  assert.equal(controller.promptWriting, true);
  context.enqueueRawInput(controller, 'must not interleave');
  assert.equal(calls, 0);
  release(); await sent;
  assert.equal(calls, 1);
  assert.equal(fields.get('#custom-prompt-ready').checked, false);
  assert.equal(fields.get('#custom-prompt-status').textContent, 'custom.uncertain');
  await context.sendCustomPrompt(); assert.equal(calls, 1);
});
