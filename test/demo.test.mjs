import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

test('demonstrates requirement, implementation, commit, review, and approval end to end', () => {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'demo.mjs')], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[CODEX\] Clarify requirement/);
  assert.match(result.stdout, /\[ANTIGRAVITY\] Claim message, implement, test, and commit/);
  assert.match(result.stdout, /review: APPROVED/);
  assert.match(result.stdout, /tests: PASS/);
  assert.match(result.stdout, /bus: PASS/);
});
