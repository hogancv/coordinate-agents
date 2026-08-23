import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADAPTER_CAPABILITIES,
  ADAPTER_CONTRACT_ERROR_CODES,
  ADAPTER_CONTRACT_VERSION,
  RESERVED_ADAPTER_IDS,
  AdapterContractError,
  createAdapter,
  defineAdapter,
  validateAdapterDescriptor,
  validateAdapterIdentity,
  validateAdapterInstance,
  validateConfigurationResult,
  validateDetectionResult,
  validateLaunchPolicy,
  validateLaunchResult,
} from '../adapter-sdk.mjs';

const validCapabilities = Object.freeze({
  detection: true,
  configuration: true,
  oneShotLaunch: true,
  persistentSession: true,
});

function validInstance() {
  return {
    detect() {
      return { available: true, command: process.execPath, resolvedCommand: process.execPath, version: process.version };
    },
    validateConfiguration() {
      return { compatible: true, code: null, details: null };
    },
    resolveLaunch({ prompt }) {
      return { command: process.execPath, prefix: [], args: ['-e', `console.log(${JSON.stringify(prompt)})`] };
    },
    resolveSessionLaunch() {
      return { command: process.execPath, prefix: [], args: [], initialInputConsumed: false };
    },
    launchPolicy() {
      return { mode: 'one-shot' };
    },
  };
}

function validDescriptor(overrides = {}) {
  return {
    contractVersion: ADAPTER_CONTRACT_VERSION,
    id: 'fixture-cli',
    capabilities: validCapabilities,
    create: () => validInstance(),
    ...overrides,
  };
}

function assertContractError(callback, code, path) {
  assert.throws(callback, error => {
    assert.ok(error instanceof AdapterContractError);
    assert.equal(error.code, code);
    assert.equal(error.recoverable, false);
    assert.equal(error.details.path, path);
    return true;
  });
}

test('public Adapter SDK freezes Contract v1 independently from the package version', () => {
  assert.equal(ADAPTER_CONTRACT_VERSION, 1);
  assert.equal(ADAPTER_CAPABILITIES.PERSISTENT_SESSION, 'persistentSession');
  assert.equal(ADAPTER_CONTRACT_ERROR_CODES.INVALID_ADAPTER_CONFIG, 'INVALID_ADAPTER_CONFIG');
  assert.deepEqual(RESERVED_ADAPTER_IDS, ['codex-cli', 'antigravity-cli', 'generic-cli']);

  const descriptor = defineAdapter(validDescriptor());
  assert.equal(descriptor.id, 'fixture-cli');
  assert.equal(descriptor.contractVersion, 1);
  assert.ok(Object.isFrozen(descriptor));
  assert.ok(Object.isFrozen(descriptor.capabilities));
});

test('package self-reference resolves both supported Adapter SDK subpaths', async () => {
  const explicit = await import('@hogancv/coordinate-agents/adapter-sdk.mjs');
  const extensionless = await import('@hogancv/coordinate-agents/adapter-sdk');
  assert.equal(explicit.ADAPTER_CONTRACT_VERSION, 1);
  assert.equal(extensionless.defineAdapter, explicit.defineAdapter);
});

test('adapter identity rejects invalid, reserved, and duplicate IDs deterministically', () => {
  assert.equal(validateAdapterIdentity('vendor-cli'), 'vendor-cli');
  assert.equal(validateAdapterIdentity('codex-cli', { allowReserved: true }), 'codex-cli');
  assertContractError(() => validateAdapterIdentity('Vendor CLI'), 'INVALID_ADAPTER_CONFIG', 'id');
  assertContractError(() => validateAdapterIdentity('codex-cli'), 'INVALID_ADAPTER_CONFIG', 'id');
  assertContractError(
    () => validateAdapterIdentity('vendor-cli', { registeredIds: ['vendor-cli'] }),
    'INVALID_ADAPTER_CONFIG',
    'id',
  );
});

test('descriptor validation rejects unsupported versions and capability mismatches before spawn', () => {
  assertContractError(
    () => validateAdapterDescriptor(validDescriptor({ contractVersion: 2 })),
    'INVALID_ADAPTER_CONFIG',
    'contractVersion',
  );
  assertContractError(
    () => validateAdapterDescriptor(validDescriptor({
      capabilities: { ...validCapabilities, unexpected: true },
    })),
    'INVALID_ADAPTER_CONFIG',
    'capabilities.unexpected',
  );
  assertContractError(
    () => validateAdapterDescriptor(validDescriptor({
      capabilities: {
        detection: true,
        configuration: true,
        oneShotLaunch: false,
        persistentSession: false,
      },
    })),
    'UNSUPPORTED_CAPABILITY',
    'capabilities',
  );

  let factoryCalled = false;
  const descriptor = validDescriptor({
    capabilities: { ...validCapabilities, persistentSession: false },
    create: () => {
      factoryCalled = true;
      const instance = validInstance();
      delete instance.resolveLaunch;
      return instance;
    },
  });
  assertContractError(() => createAdapter(descriptor), 'UNSUPPORTED_CAPABILITY', 'instance.resolveLaunch');
  assert.equal(factoryCalled, true);
});

test('createAdapter freezes configuration and validates the factory result', () => {
  let receivedConfig;
  const descriptor = validDescriptor({
    create(config) {
      receivedConfig = config;
      return validInstance();
    },
  });
  const instance = createAdapter(descriptor, { command: 'fixture' });
  assert.equal(instance.detect().available, true);
  assert.deepEqual(receivedConfig, { command: 'fixture' });
  assert.ok(Object.isFrozen(receivedConfig));

  assertContractError(
    () => validateAdapterInstance(validDescriptor(), null),
    'INVALID_ADAPTER_CONFIG',
    'instance',
  );
});

test('result validators enforce structured detection and configuration facts', () => {
  const detection = { available: false, code: 'EXECUTABLE_NOT_FOUND', details: 'Command not found' };
  assert.equal(validateDetectionResult(detection), detection);
  assertContractError(
    () => validateDetectionResult({ available: false, code: null, details: 'Command not found' }),
    'INVALID_ADAPTER_CONFIG',
    'detection.code',
  );

  const compatibility = { compatible: false, code: 'UNSUPPORTED_CAPABILITY', details: 'Missing prompt mode' };
  assert.equal(validateConfigurationResult(compatibility), compatibility);
  assertContractError(
    () => validateConfigurationResult({ compatible: false, code: 'UNSUPPORTED_CAPABILITY' }),
    'INVALID_ADAPTER_CONFIG',
    'configuration.details',
  );
});

test('launch validation requires array arguments and explicit persistent-input semantics', () => {
  const oneShot = {
    command: process.execPath,
    prefix: [],
    args: ['-e', 'process.exit(0)'],
    resolvedCommand: process.execPath,
    cwd: process.cwd(),
  };
  assert.equal(validateLaunchResult(oneShot), oneShot);
  assertContractError(
    () => validateLaunchResult({ command: process.execPath, args: '--version' }),
    'INVALID_ADAPTER_CONFIG',
    'launch.args',
  );
  assertContractError(
    () => validateLaunchResult({ command: process.execPath, args: [] }, { kind: 'persistent-session' }),
    'INVALID_ADAPTER_CONFIG',
    'launch.initialInputConsumed',
  );
  assert.equal(
    validateLaunchResult(
      { command: process.execPath, prefix: [], args: [], initialInputConsumed: false },
      { kind: 'persistent-session' },
    ).initialInputConsumed,
    false,
  );

  assert.deepEqual(validateLaunchPolicy({ mode: 'bus-supervised', pollIntervalMs: 500 }), {
    mode: 'bus-supervised',
    pollIntervalMs: 500,
  });
  assertContractError(
    () => validateLaunchPolicy({ mode: 'automatic-retry' }),
    'INVALID_ADAPTER_CONFIG',
    'launchPolicy.mode',
  );
});
