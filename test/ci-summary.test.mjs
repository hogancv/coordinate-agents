import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTap, generateMarkdownSummary } from '../scripts/ci-summary.mjs';

test('parseTap parses test counts, durations, and skips correctly', () => {
  const tap = `
TAP version 13
# Subtest: unit test 1
ok 1 - unit test 1
  ---
  duration_ms: 125.5
  ...
# Subtest: unit test 2
ok 2 - unit test 2 # SKIP
  ---
  duration_ms: 0.1
  ...
# Subtest: failing test
not ok 3 - failing test
  ---
  duration_ms: 50.2
  failureType: 'testCodeFailure'
  error: 'assertion error'
  code: 'ERR_ASSERTION'
  ...
1..3
# tests 3
# pass 1
# fail 1
# skipped 1
# duration_ms 175.8
`;

  const result = parseTap(tap);
  assert.equal(result.tests.length, 3);
  assert.equal(result.passCount, 1);
  assert.equal(result.failCount, 1);
  assert.equal(result.skipCount, 1);
  assert.equal(result.totalDuration, 175.8);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].failureDetails.failureType, 'testCodeFailure');
  assert.equal(result.failures[0].failureDetails.code, 'ERR_ASSERTION');

  const md = generateMarkdownSummary('Web Behavior Tests', result);
  assert.match(md, /Web Behavior Tests: ❌ Failed/);
  assert.match(md, /Top 10 Slowest Tests/);
  assert.match(md, /failing test/);
});

test('generateMarkdownSummary shows passed badge when all tests pass', () => {
  const result = {
    tests: [{ name: 'fast test', isOk: true, skipped: false, durationMs: 10 }],
    failures: [],
    passCount: 1,
    failCount: 0,
    skipCount: 0,
    totalDuration: 10,
  };

  const md = generateMarkdownSummary('Shared Tests', result);
  assert.match(md, /Shared Tests: ✅ Passed/);
  assert.doesNotMatch(md, /❌ Failures/);
});
