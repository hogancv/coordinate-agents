import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const busCli = join(root, 'scripts', 'agent-bus.mjs');

function invoke(repository, args) {
  return spawnSync(process.execPath, [busCli, ...args, '--root', repository], {
    cwd: repository,
    encoding: 'utf8',
  });
}

function git(repository, args) {
  const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('runs the complete cross-platform message lifecycle', () => {
  const repository = mkdtempSync(join(tmpdir(), 'agent-bus-test-'));
  try {
    git(repository, ['init']);
    const initialized = invoke(repository, ['init']);
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.equal(JSON.parse(initialized.stdout).success, true);

    const excludePath = git(repository, ['rev-parse', '--git-path', 'info/exclude']);
    const absoluteExclude = resolve(repository, excludePath);
    assert.match(readFileSync(absoluteExclude, 'utf8'), /^\.agent-bus\/$/m);

    const bodyFile = join(repository, 'spec.md');
    writeFileSync(bodyFile, '# Implement this\n', 'utf8');
    const sent = invoke(repository, [
      'send', '--from', 'codex', '--to', 'antigravity', '--type', 'IMPLEMENT',
      '--subject', 'Implement spec', '--body-file', bodyFile,
    ]);
    assert.equal(sent.status, 0, sent.stderr);
    assert.ok(existsSync(sent.stdout.trim()));

    const waiting = invoke(repository, ['wait', '--role', 'antigravity', '--timeout-minutes', '1', '--poll-seconds', '0.01']);
    assert.equal(waiting.status, 0, waiting.stderr);
    const claimed = waiting.stdout.trim();
    assert.match(claimed, /processing/);
    assert.match(readFileSync(claimed, 'utf8'), /type: IMPLEMENT/);

    const completed = invoke(repository, ['complete', '--message-path', claimed]);
    assert.equal(completed.status, 0, completed.stderr);
    assert.match(completed.stdout, /processed/);

    const stateOne = invoke(repository, ['state', '--role', 'antigravity', '--state', 'WAITING', '--details', 'Waiting for review']);
    assert.equal(stateOne.status, 0, stateOne.stderr);
    const stateTwo = invoke(repository, ['state', '--role', 'antigravity', '--state', 'APPROVED', '--details', 'Approved']);
    assert.equal(stateTwo.status, 0, stateTwo.stderr);

    const status = invoke(repository, ['status']);
    assert.equal(status.status, 0, status.stderr);
    const parsed = JSON.parse(status.stdout);
    assert.equal(parsed.states.antigravity.state, 'APPROVED');
    assert.equal(parsed.queues.antigravity.processed, 1);
    assert.equal(parsed.queues.antigravity.new, 0);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
