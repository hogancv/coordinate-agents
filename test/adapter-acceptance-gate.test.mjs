import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import externalDescriptor from '../examples/minimal-external-adapter/adapter.mjs';
import {
  ANTIGRAVITY_CLI_ADAPTER_DESCRIPTOR,
  CODEX_CLI_ADAPTER_DESCRIPTOR,
  GENERIC_CLI_ADAPTER_DESCRIPTOR,
  assertAdapterConformance,
} from '../adapter-sdk.mjs';

const root = process.cwd();
const adapters = [
  ['codex-cli', CODEX_CLI_ADAPTER_DESCRIPTOR],
  ['antigravity-cli', ANTIGRAVITY_CLI_ADAPTER_DESCRIPTOR],
  ['generic-cli', GENERIC_CLI_ADAPTER_DESCRIPTOR],
  ['minimal-external-adapter', externalDescriptor],
];

test('Adapter SDK acceptance gate runs built-in and external descriptors through one public kit', () => {
  for (const [id, descriptor] of adapters) {
    const report = assertAdapterConformance(descriptor, {
      allowReserved: id !== 'minimal-external-adapter',
    });
    assert.equal(report.ok, true, `${id}: ${report.diagnostics.join('\n')}`);
    assert.equal(report.adapterId, id);
    assert.equal(report.contractVersion, 1);
    assert.equal(report.summary.failed, 0);
    assert.equal(report.fixture.spawned, 2);
  }
});

test('Adapter SDK acceptance matrix is explicit and runs the required release-safe checks', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'adapter-sdk-acceptance.yml'), 'utf8');
  for (const os of ['ubuntu-latest', 'macos-latest', 'windows-latest']) {
    assert.match(workflow, new RegExp(`\\b${os}\\b`));
  }
  for (const node of ['18.x', '22.x']) assert.match(workflow, new RegExp(`['"]${node}['"]`));
  for (const command of ['npm ci', 'npm run check', 'npm run demo', 'npm pack --dry-run']) {
    assert.match(workflow, new RegExp(command.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')));
  }
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.doesNotMatch(workflow, /npm publish|npm install -g|curl\s+.*\|\s*(sh|bash)/i);
});
