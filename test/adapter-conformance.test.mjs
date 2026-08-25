import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import {
  ADAPTER_CONFORMANCE_ERROR_CODES,
  ADAPTER_CONTRACT_VERSION,
  AdapterConformanceError,
  AdapterContractError,
  assertAdapterConformance,
  runAdapterConformance,
} from '../adapter-sdk.mjs';

const capabilities = Object.freeze({
  detection: true,
  configuration: true,
  oneShotLaunch: true,
  persistentSession: true,
});
function descriptor(overrides = {}) {
  return {
    contractVersion: ADAPTER_CONTRACT_VERSION,
    id: 'fixture-cli',
    capabilities,
    create(config) {
      const fixture = config.conformanceFixture;
      return {
        detect() {
          return {
            available: existsSync(fixture.script),
            command: fixture.command,
            resolvedCommand: fixture.command,
            version: 'fixture-1.0.0',
          };
        },
        validateConfiguration() {
          return { compatible: true, code: null, details: null };
        },
        resolveLaunch({ root, prompt }) {
          return {
            command: fixture.command,
            prefix: [...fixture.prefix],
            args: ['--mode', 'one-shot', '--prompt', prompt],
            resolvedCommand: fixture.command,
            cwd: root,
          };
        },
        resolveSessionLaunch({ root }) {
          return {
            command: fixture.command,
            prefix: [...fixture.prefix],
            args: ['--mode', 'persistent'],
            resolvedCommand: fixture.command,
            cwd: root,
            initialInputConsumed: false,
          };
        },
        launchPolicy() {
          return { mode: 'one-shot' };
        },
        capabilities() {
          return { ...capabilities };
        },
      };
    },
    ...overrides,
  };
}

function failingCode(report, code) {
  assert.equal(report.ok, false);
  assert.ok(report.failures.some(failure => failure.code === code), report.diagnostics.join('\n'));
  return report;
}

test('public conformance runner proves a valid adapter through an isolated fake executable', () => {
  const report = assertAdapterConformance(descriptor());

  assert.equal(report.ok, true);
  assert.equal(report.kitVersion, 1);
  assert.equal(report.contractVersion, 1);
  assert.equal(report.adapterId, 'fixture-cli');
  assert.equal(report.fixture.isolated, true);
  assert.equal(report.fixture.repository, true);
  assert.equal(report.fixture.pathContainsSpaces, true);
  assert.equal(report.fixture.pathContainsShellMetacharacters, true);
  assert.equal(report.fixture.spawned, 2);
  assert.equal(report.fixture.cleaned, true);
  assert.equal(report.observations.detection.available, true);
  assert.equal(report.observations.configuration.compatible, true);
  assert.equal(report.observations.oneShotLaunch.processSucceeded, true);
  assert.equal(report.observations.persistentSession.initialInputConsumed, false);
  assert.equal(report.observations.persistentSession.initialInputVerified, true);
  assert.equal(report.summary.failed, 0);
});

test('conformance runner accepts a factory with public metadata and does not mutate config', () => {
  const originalConfig = { vendorFlag: 'fixture-value' };
  const factory = config => descriptor().create(config);
  const report = runAdapterConformance(factory, {
    id: 'factory-cli',
    capabilities,
    config: originalConfig,
  });

  assert.equal(report.ok, true, report.diagnostics.join('\n'));
  assert.deepEqual(originalConfig, { vendorFlag: 'fixture-value' });
});

test('invalid, reserved, duplicate, and unsupported identities fail before spawn', () => {
  for (const [candidate, options, path] of [
    [descriptor({ id: 'Invalid ID' }), {}, 'id'],
    [descriptor({ id: 'codex-cli' }), {}, 'id'],
    [descriptor(), { registeredIds: ['fixture-cli'] }, 'id'],
    [descriptor({ contractVersion: 2 }), {}, 'contractVersion'],
  ]) {
    const report = failingCode(runAdapterConformance(candidate, options), 'INVALID_ADAPTER_CONFIG');
    assert.equal(report.fixture.spawned, 0);
    assert.equal(report.failures[0].path, path);
  }
});

test('capability and method mismatches are rejected before the fixture process starts', () => {
  const report = runAdapterConformance(descriptor({
    create(config) {
      const instance = descriptor().create(config);
      delete instance.resolveSessionLaunch;
      return instance;
    },
  }));

  failingCode(report, 'UNSUPPORTED_CAPABILITY');
  assert.equal(report.fixture.spawned, 0);
  assert.equal(report.failures[0].path, 'instance.resolveSessionLaunch');
});

test('unsafe and malformed launch plans produce bounded diagnostics without unsafe spawn', () => {
  const unsafeConfig = runAdapterConformance(descriptor(), { config: { command: 'real-provider-cli' } });
  failingCode(unsafeConfig, ADAPTER_CONFORMANCE_ERROR_CODES.UNSAFE_LAUNCH);
  assert.equal(unsafeConfig.fixture.spawned, 0);

  const unsafe = runAdapterConformance(descriptor({
    capabilities: { ...capabilities, persistentSession: false },
    create(config) {
      const instance = descriptor().create(config);
      instance.resolveLaunch = () => ({ command: process.execPath, prefix: [], args: ['-e', 'process.exit(0)'] });
      return instance;
    },
  }));
  failingCode(unsafe, ADAPTER_CONFORMANCE_ERROR_CODES.UNSAFE_LAUNCH);
  assert.equal(unsafe.fixture.spawned, 0);

  const malformed = runAdapterConformance(descriptor({
    capabilities: { ...capabilities, persistentSession: false },
    create(config) {
      const instance = descriptor().create(config);
      instance.resolveLaunch = () => ({ command: process.execPath, prefix: [], args: '--not-an-array' });
      return instance;
    },
  }));
  failingCode(malformed, 'INVALID_ADAPTER_CONFIG');
  assert.equal(malformed.fixture.spawned, 0);
  assert.equal(malformed.failures[0].path, 'launch.args');
});

test('initial input mismatches are detected and failures remain bounded', () => {
  const mismatch = runAdapterConformance(descriptor({
    capabilities: { ...capabilities, oneShotLaunch: false },
    create(config) {
      const instance = descriptor().create(config);
      instance.resolveSessionLaunch = ({ root }) => ({
        command: config.conformanceFixture.command,
        prefix: [...config.conformanceFixture.prefix],
        args: ['--mode', 'persistent'],
        cwd: root,
        initialInputConsumed: true,
      });
      return instance;
    },
  }));
  failingCode(mismatch, ADAPTER_CONFORMANCE_ERROR_CODES.INITIAL_INPUT_MISMATCH);

  const hugeMessage = 'secret-token=should-not-appear '.repeat(200);
  const thrown = runAdapterConformance(descriptor({
    create() {
      throw new Error(hugeMessage);
    },
  }));
  assert.equal(thrown.ok, false);
  assert.ok(thrown.diagnostics.every(diagnostic => diagnostic.length <= 512));
  assert.doesNotMatch(thrown.diagnostics.join('\n'), /should-not-appear/);
  assert.throws(() => assertAdapterConformance(descriptor({
    create() {
      throw new AdapterContractError('INVALID_ADAPTER_CONFIG', 'create: fixture rejected', { path: 'create' });
    },
  })), error => {
    assert.ok(error instanceof AdapterConformanceError);
    assert.equal(error.code, 'INVALID_ADAPTER_CONFIG');
    assert.equal(error.details.path, 'create');
    return true;
  });
});
