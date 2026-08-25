import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANTIGRAVITY_CLI_ADAPTER_DESCRIPTOR,
  CODEX_CLI_ADAPTER_DESCRIPTOR,
  GENERIC_CLI_ADAPTER_DESCRIPTOR,
  assertAdapterConformance,
} from '../adapter-sdk.mjs';
import {
  getAdapter,
  getAdapterContract,
  getAdapterDescriptor,
  registerAdapter,
} from '../skills/coordinate-agents/adapters/index.mjs';

const builtins = [
  ['codex-cli', CODEX_CLI_ADAPTER_DESCRIPTOR, {}],
  ['antigravity-cli', ANTIGRAVITY_CLI_ADAPTER_DESCRIPTOR, {}],
  ['generic-cli', GENERIC_CLI_ADAPTER_DESCRIPTOR, {}],
];

test('all built-in adapters expose Contract v1 descriptors and pass public conformance', () => {
  for (const [name, descriptor, config] of builtins) {
    assert.equal(getAdapterDescriptor(name), descriptor);
    assert.equal(descriptor.contractVersion, 1);
    assert.equal(descriptor.id, name);

    const report = assertAdapterConformance(descriptor, {
      allowReserved: true,
      config,
    });
    assert.equal(report.ok, true, `${name}: ${report.diagnostics.join('\n')}`);
    assert.equal(report.adapterId, name);
    assert.equal(report.fixture.spawned, 2);
    assert.equal(report.summary.failed, 0);
  }
});

test('built-in registry instances carry the validated Contract v1 capabilities', () => {
  for (const [name] of builtins) {
    const adapter = getAdapter(name, { command: process.execPath, args: ['--prompt', '{prompt}'] });
    const contract = getAdapterContract(adapter);
    assert.equal(contract?.id, name);
    assert.deepEqual(contract?.capabilities, {
      detection: true,
      configuration: true,
      oneShotLaunch: true,
      persistentSession: true,
    });
    assert.equal(adapter.contract, contract);
  }
});

test('built-in adapter identities cannot be overridden through the registry', () => {
  assert.throws(
    () => registerAdapter('codex-cli', class ReplacementAdapter {}),
    error => error.code === 'INVALID_ADAPTER_CONFIG' && error.details.path === 'id',
  );
});
