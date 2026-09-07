import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('Task Graph acceptance gate uses the focused cross-platform matrix without release authority', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'adapter-sdk-acceptance.yml'), 'utf8');
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  assert.equal(packageJson.scripts.test, 'npm run test:core');
  assert.equal(packageJson.scripts['test:full'], 'node --test --test-concurrency=1');
  for (const os of ['ubuntu-latest', 'macos-latest', 'windows-latest']) {
    assert.match(workflow, new RegExp(`\\b${os}\\b`));
  }
  for (const node of ['18.x', '22.x']) {
    assert.match(workflow, new RegExp(`['"]${node}['"]`));
  }
  for (const command of ['npm ci', 'npm test', 'npm run demo', 'npm pack --dry-run --ignore-scripts']) {
    assert.match(workflow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(workflow, /matrix:\s*\n\s*include:/);
  assert.doesNotMatch(workflow, /release-artifact:/);
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /paths: \[package\.json\]/);
  assert.match(workflow, /version-change:/);
  assert.match(workflow, /if: needs\.version-change\.outputs\.run_acceptance == 'true'/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.doesNotMatch(workflow, /npm publish|gh release create|git push|deploy-pages|pages:\s*write/i);
});

test('Task Graph gate documentation keeps review and release authorization separate', () => {
  const documentation = readFileSync(join(root, 'docs', 'task-graph-v1.md'), 'utf8');
  assert.match(documentation, /## Repository acceptance gate/);
  assert.match(documentation, /Linux with Node\.js 18 and 22/);
  assert.match(documentation, /macOS and Windows with Node\.js 22/);
  assert.match(documentation, /npm run test:full/);
  assert.match(documentation, /does not authorize merge, push, tag, publish, deploy, or release/i);
});

test('Plugin security scan workflow is intentionally removed', () => {
  assert.equal(existsSync(join(root, '.github', 'workflows', 'plugin-security-scan.yml')), false);
});
