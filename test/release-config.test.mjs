import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('release workflow is strictly manual and preserves OIDC provenance, gates, and dist tags', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  // Package publication configuration
  assert.equal(packageJson.publishConfig.access, 'public');
  assert.equal(packageJson.publishConfig.provenance, true);

  // Manual-only trigger (workflow_dispatch)
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /on:\s*\n\s+release:/, 'Must not trigger automatically on GitHub release');
  assert.doesNotMatch(workflow, /on:\s*\n\s+push:/, 'Must not trigger automatically on git push');
  assert.doesNotMatch(workflow, /on:\s*\n\s+pull_request:/, 'Must not trigger automatically on PR');

  // Explicit confirmation requirement
  assert.match(workflow, /confirmation:/);
  assert.match(workflow, /PUBLISH/);

  // Security & provenance
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /npm publish --ignore-scripts --access public --tag/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/);

  // Pinned actions
  for (const use of workflow.matchAll(/uses:\s+([^\s#]+)/g)) {
    assert.match(use[1], /@[0-9a-f]{40}$/, `action is not commit-pinned: ${use[1]}`);
  }
});
