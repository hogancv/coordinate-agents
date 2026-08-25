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
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /npm publish --ignore-scripts --access public --tag latest/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
});
