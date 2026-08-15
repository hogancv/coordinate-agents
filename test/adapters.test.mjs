import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentAdapter, getAdapter, listAdapters, registerAdapter } from '../adapters/index.mjs';

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

  const caps = adapter.capabilities();
  assert.equal(caps.name, 'base');
  assert.equal(caps.supportsHeadless, false);
  assert.equal(caps.supportsInteractive, true);
  assert.equal(caps.supportsStateReporting, true);
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

  const generic = getAdapter('generic-cli', { id: 'custom', command: 'echo' });
  assert.equal(generic.name, 'generic-cli');
  const genericCaps = generic.capabilities();
  assert.equal(genericCaps.name, 'generic-cli');

  assert.throws(() => getAdapter('unknown-adapter', { id: 'test' }), /Unknown adapter: unknown-adapter/);
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
