#!/usr/bin/env node

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const busTool = join(packageRoot, 'scripts', 'agent-bus.mjs');
const keep = process.argv.includes('--keep');
const repo = mkdtempSync(join(tmpdir(), 'coordinate-agents-demo-'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repo, encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${command} failed`).trim());
  return result.stdout.trim();
}

function bus(args) {
  return run(process.execPath, [busTool, ...args, '--root', repo]);
}

function step(label, detail = '') {
  process.stdout.write(`\n[${label}]${detail ? ` ${detail}` : ''}\n`);
}

try {
  step('SETUP', 'Create an isolated Git repository (Default reference workflow)');
  run('git', ['init', '--initial-branch=main']);
  run('git', ['config', 'user.name', 'Demo Agent']);
  run('git', ['config', 'user.email', 'demo@users.noreply.github.com']);
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ private: true, scripts: { test: 'node --test' } }, null, 2)}\n`);
  writeFileSync(join(repo, 'app.mjs'), "export function addTodo(items, title) { return [...items, { title, done: false }]; }\n");
  mkdirSync(join(repo, 'test'));
  writeFileSync(join(repo, 'test', 'app.test.mjs'), "import assert from 'node:assert/strict'; import test from 'node:test'; import { addTodo } from '../app.mjs'; test('adds a todo', () => assert.equal(addTodo([], 'Ship')[0].title, 'Ship'));\n");
  run('git', ['add', '.']);
  run('git', ['commit', '-m', 'Initialize demo project']);
  bus(['init']);

  step('CODEX', 'Clarify requirement and submit implementation specification');
  const spec = join(repo, '.agent-bus', 'specs', 'todo.md');
  writeFileSync(spec, '# Todo requirement\nAdd completion support without changing addTodo behavior. Acceptance: tests pass.\n');
  const implement = bus(['send', '--from', 'codex', '--to', 'antigravity', '--type', 'IMPLEMENT', '--subject', 'Add todo completion', '--body-file', spec, '--dedupe-key', 'demo-round-1']);
  console.log(`queued: ${implement}`);

  step('ANTIGRAVITY', 'Claim message, implement, test, and commit');
  const claimedByAgy = bus(['wait', '--agent', 'antigravity', '--timeout-minutes', '1', '--poll-seconds', '0.01']);
  console.log(`claimed: ${claimedByAgy}`);
  writeFileSync(join(repo, 'app.mjs'), "export function addTodo(items, title) { return [...items, { title, done: false }]; }\nexport function completeTodo(items, index) { return items.map((item, i) => i === index ? { ...item, done: true } : item); }\n");
  writeFileSync(join(repo, 'test', 'app.test.mjs'), "import assert from 'node:assert/strict'; import test from 'node:test'; import { addTodo, completeTodo } from '../app.mjs'; test('adds a todo', () => assert.equal(addTodo([], 'Ship')[0].title, 'Ship')); test('completes a todo', () => assert.equal(completeTodo(addTodo([], 'Ship'), 0)[0].done, true));\n");
  const testOutput = run(process.execPath, ['--test']);
  console.log('validation: node --test PASS');
  run('git', ['add', 'app.mjs', 'test/app.test.mjs']);
  run('git', ['commit', '-m', 'Add todo completion']);
  const commit = run('git', ['rev-parse', 'HEAD']);
  const evidence = join(repo, '.agent-bus', 'evidence', 'demo-round-1.txt');
  writeFileSync(evidence, `${testOutput}\ncommit=${commit}\n`);
  bus(['complete', '--message-path', claimedByAgy]);
  bus(['send', '--from', 'antigravity', '--to', 'codex', '--type', 'IMPLEMENTATION_DONE', '--subject', 'Completion implemented', '--body-file', evidence, '--related-commit', commit, '--dedupe-key', 'demo-round-1-done']);
  console.log(`commit: ${commit.slice(0, 12)}`);

  step('CODEX', 'Claim result and review real commit plus validation evidence');
  const claimedByCodex = bus(['wait', '--agent', 'codex', '--timeout-minutes', '1', '--poll-seconds', '0.01']);
  const reviewedCommit = run('git', ['rev-parse', 'HEAD']);
  assertEqual(reviewedCommit, commit, 'reviewed commit mismatch');
  run(process.execPath, ['--test']);
  assertIncludes(readFileSync(claimedByCodex, 'utf8'), commit, 'completion message lacks commit');
  bus(['complete', '--message-path', claimedByCodex]);
  bus(['send', '--from', 'codex', '--to', 'antigravity', '--type', 'REVIEW_APPROVED', '--subject', 'Review approved', '--body', `Verified ${commit}: tests pass.`, '--dedupe-key', 'demo-round-1-review']);
  console.log('review: APPROVED');

  step('ANTIGRAVITY', 'Receive approval and stop editing');
  const approval = bus(['wait', '--agent', 'antigravity', '--timeout-minutes', '1', '--poll-seconds', '0.01']);
  assertIncludes(readFileSync(approval, 'utf8'), 'REVIEW_APPROVED', 'approval message missing');
  bus(['complete', '--message-path', approval]);
  bus(['state', '--agent', 'codex', '--state', 'APPROVED', '--related-commit', commit]);
  bus(['state', '--agent', 'antigravity', '--state', 'WAITING', '--related-commit', commit]);

  const status = JSON.parse(bus(['status']));
  assertEqual(status.states.codex.state, 'APPROVED', 'Codex did not approve');
  assertEqual(status.queues.codex.processed, 1, 'Codex result queue mismatch');
  assertEqual(status.queues.antigravity.processed, 2, 'Antigravity queue mismatch');
  step('RESULT', 'IMPLEMENTED -> TESTED -> COMMITTED -> REVIEW_APPROVED');
  console.log(`repository: ${repo}`);
  console.log(`commit: ${commit}`);
  console.log('tests: PASS');
  console.log('bus: PASS');
} catch (error) {
  console.error(`\n[FAILED] ${error.message || error}`);
  process.exitCode = 1;
} finally {
  if (!keep) rmSync(repo, { recursive: true, force: true });
  else console.log('\n--keep selected; demo repository was preserved.');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${expected}, received ${actual}`);
}

function assertIncludes(actual, expected, message) {
  if (!actual.includes(expected)) throw new Error(message);
}
