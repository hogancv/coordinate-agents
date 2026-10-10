import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'release.yml'), 'utf8');

test('release workflow keeps explicit confirmation, exact-tag verification, and OIDC publishing', () => {
  assert.match(workflow, /test "\$CONFIRMATION" = "PUBLISH"/);
  assert.match(workflow, /ref: \$\{\{ inputs\.release_tag \}\}/);
  assert.match(workflow, /npm run release:verify/);
  assert.match(workflow, /--expected-source-commit/);
  assert.match(workflow, /--expected-tag/);
  assert.match(workflow, /npm pack --dry-run --ignore-scripts/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /npm publish --ignore-scripts --access public --tag latest/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(workflow, /needs: \[verify, package-acceptance\]/);
  assert.match(workflow, /uses: \.\/\.github\/workflows\/web-package-acceptance\.yml/);
  assert.match(workflow, /artifact_name: verified-npm-tarball/);
  const acceptance = readFileSync(join(process.cwd(), '.github', 'workflows', 'web-package-acceptance.yml'), 'utf8');
  assert.match(acceptance, /workflow_call:/);
  assert.match(acceptance, /name: \$\{\{ inputs\.artifact_name \|\| 'acceptance-npm-tarball' \}\}/);
  assert.match(acceptance, /ref: \$\{\{ inputs\.release_tag \|\| github\.sha \}\}/);
  assert.match(acceptance, /node: \['18.x', '20.x', '22.x', '24.x'\]/);
  assert.match(acceptance, /needs: package/);
  assert.match(acceptance, /needs\.package\.result == 'success'/);
  assert.match(acceptance, /SHA-256 mismatch/);
  assert.match(workflow, /SHA-256 mismatch/);
  assert.match(acceptance, /npm run release:verify/);
  assert.doesNotMatch(acceptance, /npm publish|id-token:\s*write/);
});
