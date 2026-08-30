import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('Task Graph acceptance gate is part of the complete cross-platform matrix without release authority', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'adapter-sdk-acceptance.yml'), 'utf8');
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  assert.equal(packageJson.scripts.test, 'node --test --test-concurrency=1');
  for (const os of ['ubuntu-latest', 'macos-latest', 'windows-latest']) {
    assert.match(workflow, new RegExp(`\\b${os}\\b`));
  }
  for (const node of ['18.x', '22.x']) {
    assert.match(workflow, new RegExp(`['"]${node}['"]`));
  }
  for (const command of ['npm ci', 'npm run check', 'npm run demo', 'npm pack --dry-run --ignore-scripts']) {
    assert.match(workflow, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(workflow, /if: startsWith\(github\.ref, 'refs\/tags\/v'\)/);
  assert.doesNotMatch(workflow, /npm publish|gh release create|git push|deploy-pages|pages:\s*write/i);
});

test('Task Graph gate documentation keeps review and release authorization separate', () => {
  const documentation = readFileSync(join(root, 'docs', 'task-graph-v1.md'), 'utf8');
  assert.match(documentation, /## Repository acceptance gate/);
  assert.match(documentation, /Windows, macOS, and Linux/);
  assert.match(documentation, /Node\.js 18 and Node\.js 22/);
  assert.match(documentation, /does not authorize merge, push, tag, publish, deploy, or release/i);
});
