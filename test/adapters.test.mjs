import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { AgentAdapter, getAdapter, listAdapters, registerAdapter } from '../skills/coordinate-agents/adapters/index.mjs';
import { resolveExecutable } from '../skills/coordinate-agents/adapters/executable.mjs';

test('AgentAdapter defines normalized statuses and default lifecycle methods', () => {
  assert.deepEqual(AgentAdapter.STATUSES, {
    IDLE: 'idle',
    WORKING: 'working',
    COMPLETED: 'completed',
    FAILED: 'failed',
    WAITING: 'waiting',
  });

  const adapter = new AgentAdapter({ id: 'base-test' });
  assert.equal(adapter.name, 'base');
  assert.throws(() => adapter.detect(), /detect\(\) must be implemented/);
  assert.throws(() => adapter.resolveLaunch({ root: '.', prompt: 'test' }), /resolveLaunch\(\) must be implemented/);

  // Default lifecycle methods
  assert.throws(() => adapter.dispatch({ root: '.', task: 'test' }), /dispatch\(\) is not supported/);
  assert.deepEqual(adapter.observeStatus(), { status: 'idle', details: null, lastUpdated: null });
  assert.deepEqual(adapter.retrieveResult(), { success: false, output: null, error: 'No result available' });
  assert.deepEqual(adapter.cleanup(), { cleaned: true });

  const state = adapter.reportState('working', 'Running tests');
  assert.equal(state.status, 'working');
  assert.equal(state.details, 'Running tests');
  assert.ok(state.lastUpdated);
  assert.deepEqual(adapter.observeStatus(), state);

  // Negative test: invalid status rejection
  assert.throws(() => adapter.reportState('invalid-state'), /Invalid normalized status/);

  const caps = adapter.capabilities();
  assert.equal(caps.name, 'base');
  assert.equal(caps.supportsHeadless, false);
  assert.equal(caps.supportsInteractive, true);
  assert.equal(caps.supportsStateReporting, true);
  assert.deepEqual(adapter.launchPolicy(), { mode: 'one-shot' });
  assert.equal(caps.launchPolicy, 'one-shot');
});

test('registered adapters provide capabilities and correct adapter instances', () => {
  const adapters = listAdapters();
  assert.ok(adapters.includes('codex-cli'));
  assert.ok(adapters.includes('antigravity-cli'));
  assert.ok(adapters.includes('generic-cli'));

  const codex = getAdapter('codex-cli', { id: 'codex' });
  assert.equal(codex.name, 'codex-cli');
  const codexCaps = codex.capabilities();
  assert.equal(codexCaps.name, 'codex-cli');
  assert.equal(codexCaps.supportsInteractive, true);

  const agy = getAdapter('antigravity-cli', { id: 'antigravity' });
  assert.equal(agy.name, 'antigravity-cli');
  const agyCaps = agy.capabilities();
  assert.equal(agyCaps.name, 'antigravity-cli');
  assert.equal(agy.launchPolicy().mode, 'bus-supervised');
  assert.equal(agyCaps.launchPolicy, 'bus-supervised');

  const generic = getAdapter('generic-cli', { id: 'custom', command: 'echo' });
  assert.equal(generic.name, 'generic-cli');
  const genericCaps = generic.capabilities();
  assert.equal(genericCaps.name, 'generic-cli');

  assert.throws(() => getAdapter('unknown-adapter', { id: 'test' }), /Unknown adapter: unknown-adapter/);
});

test('Antigravity adapter keeps permission flags explicit', () => {
  const agy = getAdapter('antigravity-cli', {
    id: 'antigravity',
    command: process.execPath,
    args: ['--configured-flag'],
  });

  const resolved = agy.resolveLaunch({ prompt: 'Implement feature' });
  assert.deepEqual(resolved.args, ['--configured-flag', '--prompt-interactive', 'Implement feature']);
  assert.equal(resolved.args.includes('--dangerously-skip-permissions'), false);
});

test('Antigravity persistent sessions provide the required empty prompt value', () => {
  const agy = getAdapter('antigravity-cli', {
    id: 'antigravity',
    command: process.execPath,
  });

  const resolved = agy.resolveSessionLaunch({
    root: '.',
    initialPrompt: 'Implement feature',
    agent: 'antigravity',
    language: 'en',
  });

  assert.deepEqual(resolved.args, ['--prompt-interactive', '']);
  assert.equal(resolved.initialInputConsumed, false);
});

test('Antigravity preserves configured prompt templates and fills a missing flag value', () => {
  const withPrompt = getAdapter('antigravity-cli', {
    id: 'antigravity',
    command: process.execPath,
    args: ['--prompt-interactive', '{prompt}'],
  });
  assert.deepEqual(withPrompt.resolveSessionLaunch({ initialPrompt: 'Implement feature' }).args, [
    '--prompt-interactive', 'Implement feature',
  ]);
  assert.equal(withPrompt.resolveSessionLaunch({ initialPrompt: 'Implement feature' }).initialInputConsumed, true);

  const missingValue = getAdapter('antigravity-cli', {
    id: 'antigravity',
    command: process.execPath,
    args: ['--prompt-interactive'],
  });
  assert.deepEqual(missingValue.resolveSessionLaunch({ initialPrompt: 'Implement feature' }).args, [
    '--prompt-interactive', '',
  ]);
});

test('custom adapter can be registered and used with custom lifecycle', () => {
  class MockHeadlessAdapter extends AgentAdapter {
    constructor(config) {
      super(config);
      this.name = 'mock-headless';
      this.lastTask = null;
      this.result = null;
    }

    detect() {
      return { available: true, version: '1.0.0' };
    }

    resolveLaunch(options) {
      return { command: 'mock-agent', prefix: [], args: ['--prompt', options.prompt] };
    }

    capabilities() {
      return {
        ...super.capabilities(),
        name: 'mock-headless',
        supportsHeadless: true,
      };
    }

    dispatch(task) {
      this.lastTask = task;
      this.reportState('working', `Processing task: ${task.type}`);
      return { dispatched: true, taskId: 'task-123' };
    }

    completeTask(success, output) {
      this.result = { success, output, error: success ? null : output };
      this.reportState(success ? 'completed' : 'failed', output);
    }

    retrieveResult() {
      return this.result || super.retrieveResult();
    }
  }

  registerAdapter('mock-headless', MockHeadlessAdapter);
  assert.ok(listAdapters().includes('mock-headless'));

  const adapter = getAdapter('mock-headless', { id: 'mock1' });
  assert.equal(adapter.capabilities().supportsHeadless, true);
  assert.equal(adapter.detect().available, true);

  const dispatchResult = adapter.dispatch({ type: 'IMPLEMENT', subject: 'Feature X' });
  assert.equal(dispatchResult.dispatched, true);
  assert.equal(adapter.observeStatus().status, 'working');

  adapter.completeTask(true, 'Feature X implemented and tested');
  assert.equal(adapter.observeStatus().status, 'completed');
  assert.deepEqual(adapter.retrieveResult(), {
    success: true,
    output: 'Feature X implemented and tested',
    error: null,
  });
});

test('generic-cli supports {agent} placeholder and rejects {role}', () => {
  const testRoot = resolve(tmpdir(), 'coordinate-agents-adapter-test');
  const generic = getAdapter('generic-cli', {
    id: 'test-agent',
    command: process.execPath,
    args: ['--agent', '{agent}', '--dir', '{root}', '--message', '{prompt}', '--lang', '{lang}'],
  });

  const launchContext = {
    root: testRoot,
    prompt: 'Implement feature',
    agent: 'test-agent',
    language: 'en',
    activation: 0,
  };

  const resolved = generic.resolveLaunch(launchContext);
  assert.equal(resolved.command, process.execPath);
  assert.deepEqual(resolved.args, [
    '--agent', 'test-agent',
    '--dir', testRoot,
    '--message', 'Implement feature',
    '--lang', 'en',
  ]);

  // Negative test: {role} placeholder is explicitly rejected
  const genericLegacy = getAdapter('generic-cli', {
    id: 'test-agent',
    command: process.execPath,
    args: ['--target', '{role}', '--prompt', '{prompt}'],
  });

  assert.throws(
    () => genericLegacy.resolveLaunch(launchContext),
    /Unsupported template placeholder: \{role\}\. Use \{agent\}\./
  );
});

test('POSIX shebangs may use a symlinked system interpreter', { skip: process.platform === 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'coordinate-agents-shebang-'));
  try {
    const interpreter = join(directory, 'node-link');
    const script = join(directory, 'fixture');
    symlinkSync(process.execPath, interpreter);
    writeFileSync(script, `#!${interpreter}\nprocess.exit(0);\n`, 'utf8');
    chmodSync(script, 0o755);

    const resolved = resolveExecutable(script);
    assert.equal(resolved.available, true, resolved.details);
    assert.equal(resolved.command, process.execPath);
    assert.deepEqual(resolved.prefix, [script]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
