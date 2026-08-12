import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('release workflow preserves OIDC provenance, version gate, and dist tags', () => {
  const workflow = readFileSync(join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.publishConfig.access, 'public');
  assert.equal(packageJson.publishConfig.provenance, true);
  assert.match(workflow, /release:\s*\n\s+types: \[published\]/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /RELEASE_TAG: \$\{\{ github\.event\.release\.tag_name \}\}/);
  assert.match(workflow, /test "v\$\{PACKAGE_VERSION\}" = "\$RELEASE_TAG"/);
  assert.match(workflow, /echo "tag=next"/);
  assert.match(workflow, /echo "tag=latest"/);
  assert.match(workflow, /npm publish --ignore-scripts --access public --tag/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN/);
  for (const use of workflow.matchAll(/uses:\s+([^\s#]+)/g)) {
    assert.match(use[1], /@[0-9a-f]{40}$/, `action is not commit-pinned: ${use[1]}`);
  }
});
