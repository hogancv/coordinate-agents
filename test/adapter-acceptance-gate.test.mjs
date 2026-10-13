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

test('Legacy compatibility runs for Adapter/Session source changes independently of the npm version', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'adapter-sdk-acceptance.yml'), 'utf8');
  assert.match(workflow, /name: Legacy Plugin CI/);
  for (const os of ['ubuntu-latest', 'macos-latest', 'windows-latest']) assert.ok(workflow.includes(os));
  for (const node of ['18.x', '22.x']) assert.ok(workflow.includes(node));
  for (const command of ['npm ci', 'npm run test:adapters', 'npm run test:legacy', 'npm run test:plugin', 'npm run demo', 'npm run check:llms']) assert.ok(workflow.includes(command), command);
  assert.match(workflow, /skills\/coordinate-agents\/\*\*/);
  assert.doesNotMatch(workflow, /!skills\/coordinate-agents\/scripts\/workspace-\*\.mjs/);
  assert.match(workflow, /inspector\/server\/\*\*/);
  assert.match(workflow, /adapter-sdk\.mjs/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /cache: npm/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.doesNotMatch(workflow, /package\.json|version-change|current_version|previous_version/);
  assert.doesNotMatch(workflow, /npm pack|release-artifact:|npm run release:verify/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.doesNotMatch(workflow, /npm publish|npm install -g|curl\s+.*\|\s*(sh|bash)/i);
});

test('Pages build is explicit, pinned, and build-only', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'pages-build.yml'), 'utf8');
  assert.match(workflow, /name: Pages Build/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/jekyll-build-pages@[0-9a-f]{40}/);
  assert.match(workflow, /source: \.\/docs/);
  assert.match(workflow, /destination: \.\/_site/);
  assert.doesNotMatch(workflow, /deploy-pages|pages:\s*write|id-token:\s*write/);
});
