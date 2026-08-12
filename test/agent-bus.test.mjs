import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const busCli = join(root, 'scripts', 'agent-bus.mjs');

function invoke(repository, args) {
  return spawnSync(process.execPath, [busCli, ...args, '--root', repository], { cwd: repository, encoding: 'utf8' });
}

function git(repository, args) {
  const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function repository() {
  const path = mkdtempSync(join(tmpdir(), 'agent-bus-test-'));
  git(path, ['init']);
  const initialized = invoke(path, ['init']);
  assert.equal(initialized.status, 0, initialized.stderr);
  return path;
}

function runAsync(repositoryPath, args) {
  const child = spawn(process.execPath, [busCli, ...args, '--root', repositoryPath], { cwd: repositoryPath });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  return {
    child,
    result: new Promise(resolvePromise => child.on('close', status => resolvePromise({ status, stdout, stderr }))),
  };
}

test('runs the complete cross-platform message lifecycle idempotently', () => {
  const repo = repository();
  try {
    const excludePath = resolve(repo, git(repo, ['rev-parse', '--git-path', 'info/exclude']));
    assert.match(readFileSync(excludePath, 'utf8'), /^\.agent-bus\/$/m);

    const bodyFile = join(repo, 'spec.md');
    writeFileSync(bodyFile, '# Implement this\n', 'utf8');
    const sent = invoke(repo, ['send', '--from', 'codex', '--to', 'antigravity', '--type', 'IMPLEMENT', '--subject', 'Implement spec', '--body-file', bodyFile]);
    assert.equal(sent.status, 0, sent.stderr);

    const waiting = invoke(repo, ['wait', '--role', 'antigravity', '--timeout-minutes', '1', '--poll-seconds', '0.01']);
    assert.equal(waiting.status, 0, waiting.stderr);
    const claimed = waiting.stdout.trim();
    assert.match(readFileSync(claimed, 'utf8'), /type: IMPLEMENT/);
    assert.ok(existsSync(`${claimed}.lease.json`));

    const first = invoke(repo, ['complete', '--message-path', claimed]);
    const second = invoke(repo, ['complete', '--message-path', claimed]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout.trim(), second.stdout.trim());

    assert.equal(invoke(repo, ['state', '--role', 'antigravity', '--state', 'WAITING']).status, 0);
    assert.equal(invoke(repo, ['state', '--role', 'antigravity', '--state', 'APPROVED']).status, 0);
    const status = JSON.parse(invoke(repo, ['status']).stdout);
    assert.equal(status.states.antigravity.state, 'APPROVED');
    assert.equal(status.queues.antigravity.processed, 1);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('supports two concurrent waiting processes without cross-claiming', async () => {
  const repo = repository();
  try {
    const codexWait = runAsync(repo, ['wait', '--role', 'codex', '--timeout-minutes', '0.1', '--poll-seconds', '0.01']);
    const agyWait = runAsync(repo, ['wait', '--role', 'antigravity', '--timeout-minutes', '0.1', '--poll-seconds', '0.01']);
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
    assert.equal(invoke(repo, ['send', '--from', 'antigravity', '--to', 'codex', '--type', 'IMPLEMENTATION_DONE', '--subject', 'Done', '--body', 'commit abc']).status, 0);
    assert.equal(invoke(repo, ['send', '--from', 'codex', '--to', 'antigravity', '--type', 'IMPLEMENT', '--subject', 'Build', '--body', 'spec']).status, 0);
    const [codex, agy] = await Promise.all([codexWait.result, agyWait.result]);
    assert.equal(codex.status, 0, codex.stderr);
    assert.equal(agy.status, 0, agy.stderr);
    assert.match(codex.stdout, /inbox[\\/]codex[\\/]processing/);
    assert.match(agy.stdout, /inbox[\\/]antigravity[\\/]processing/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('atomically handles concurrent writers and deduplicates retries', async () => {
  const repo = repository();
  try {
    const sends = Array.from({ length: 16 }, (_, index) => runAsync(repo, [
      'send', '--from', 'codex', '--to', 'antigravity', '--type', 'IMPLEMENT',
      '--subject', `Task ${index}`, '--body', `body ${index}`,
    ]));
    const results = await Promise.all(sends.map(item => item.result));
    assert.ok(results.every(result => result.status === 0), results.map(result => result.stderr).join('\n'));
    const queue = join(repo, '.agent-bus', 'inbox', 'antigravity', 'new');
    assert.equal(readdirSync(queue).filter(name => name.endsWith('.md')).length, 16);
    assert.equal(readdirSync(join(repo, '.agent-bus', 'tmp')).length, 0);
    for (const name of readdirSync(queue)) assert.match(readFileSync(join(queue, name), 'utf8'), /^---[\s\S]+\n---\nbody \d+\n$/);

    const duplicateArgs = ['send', '--from', 'codex', '--to', 'antigravity', '--type', 'IMPLEMENT', '--subject', 'Retry', '--body', 'same', '--dedupe-key', 'round-17'];
    const duplicates = Array.from({ length: 8 }, () => runAsync(repo, duplicateArgs));
    const duplicateResults = await Promise.all(duplicates.map(item => item.result));
    assert.ok(duplicateResults.every(result => result.status === 0));
    assert.equal(new Set(duplicateResults.map(result => result.stdout.trim())).size, 1);
    assert.equal(readdirSync(queue).filter(name => name.endsWith('.md')).length, 17);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('strips a UTF-8 BOM and rejects frontmatter injection', () => {
  const repo = repository();
  try {
    const body = join(repo, 'bom.md');
    writeFileSync(body, '\uFEFF# Windows body\n', 'utf8');
    const sent = invoke(repo, ['send', '--from', 'codex', '--to', 'antigravity', '--type', 'IMPLEMENT', '--subject', 'BOM', '--body-file', body]);
    assert.equal(sent.status, 0, sent.stderr);
    assert.doesNotMatch(readFileSync(sent.stdout.trim(), 'utf8'), /\uFEFF/);
    const injected = invoke(repo, ['send', '--from', 'codex', '--to', 'antigravity', '--type', 'IMPLEMENT', '--subject', 'Bad', '--body', 'x', '--related-commit', 'abc\nto: codex']);
    assert.equal(injected.status, 1);
    assert.match(injected.stderr, /unsupported characters/);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('recovers interrupted claims and stale locks', () => {
  const repo = repository();
  try {
    invoke(repo, ['send', '--from', 'codex', '--to', 'antigravity', '--type', 'IMPLEMENT', '--subject', 'Recover', '--body', 'work']);
    const claimed = invoke(repo, ['wait', '--role', 'antigravity', '--timeout-minutes', '1', '--poll-seconds', '0.01']).stdout.trim();
    const old = new Date(Date.now() - 60_000);
    const lease = JSON.parse(readFileSync(`${claimed}.lease.json`, 'utf8'));
    lease.expires_at = old.toISOString();
    writeFileSync(`${claimed}.lease.json`, `${JSON.stringify(lease)}\n`, 'utf8');
    const staleLock = join(repo, '.agent-bus', 'locks', 'abandoned');
    mkdirSync(staleLock);
    utimesSync(staleLock, old, old);
    const liveLock = join(repo, '.agent-bus', 'locks', 'live-owner');
    mkdirSync(liveLock);
    writeFileSync(join(liveLock, 'owner.json'), JSON.stringify({ pid: process.pid, host: hostname() }), 'utf8');
    utimesSync(liveLock, old, old);

    const recovered = invoke(repo, ['recover', '--role', 'antigravity', '--stale-after-seconds', '1']);
    assert.equal(recovered.status, 0, recovered.stderr);
    const parsed = JSON.parse(recovered.stdout);
    assert.ok(parsed.recovered.some(item => item.kind === 'message'));
    assert.ok(parsed.recovered.some(item => item.kind === 'lock'));
    assert.ok(existsSync(liveLock), 'a live local lock must not be stolen');
    const reclaimed = invoke(repo, ['wait', '--role', 'antigravity', '--timeout-minutes', '1', '--poll-seconds', '0.01']);
    assert.notEqual(basename(reclaimed.stdout.trim()), basename(claimed));
    const staleCompletion = invoke(repo, ['complete', '--message-path', claimed]);
    assert.equal(staleCompletion.status, 1);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('uses the recorded lease expiry rather than the recovery fallback age', async () => {
  const repo = repository();
  try {
    invoke(repo, ['send', '--from', 'codex', '--to', 'antigravity', '--type', 'IMPLEMENT', '--subject', 'Lease', '--body', 'work']);
    const claimed = invoke(repo, ['wait', '--role', 'antigravity', '--timeout-minutes', '1', '--poll-seconds', '0.01', '--lease-seconds', '0.1']).stdout.trim();
    await new Promise(resolvePromise => setTimeout(resolvePromise, 150));
    const recovered = JSON.parse(invoke(repo, ['recover', '--role', 'antigravity', '--stale-after-seconds', '999']).stdout);
    assert.equal(recovered.recovered.filter(item => item.kind === 'message').length, 1);
    assert.equal(existsSync(claimed), false);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('times out cleanly and quarantines damaged messages', () => {
  const repo = repository();
  try {
    const timeout = invoke(repo, ['wait', '--role', 'codex', '--timeout-minutes', '0.002', '--poll-seconds', '0.01']);
    assert.equal(timeout.status, 2);
    assert.equal(timeout.stdout.trim(), 'TIMEOUT');

    const queue = join(repo, '.agent-bus', 'inbox', 'codex', 'new');
    writeFileSync(join(queue, '0000-corrupt.md'), 'not a valid message', 'utf8');
    invoke(repo, ['send', '--from', 'antigravity', '--to', 'codex', '--type', 'IMPLEMENTATION_DONE', '--subject', 'Valid', '--body', 'ok']);
    const wait = invoke(repo, ['wait', '--role', 'codex', '--timeout-minutes', '1', '--poll-seconds', '0.01']);
    assert.equal(wait.status, 0, wait.stderr);
    assert.equal(readdirSync(join(repo, '.agent-bus', 'quarantine', 'codex')).filter(name => name.endsWith('.md')).length, 1);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('falls back from a damaged newest state record', () => {
  const repo = repository();
  try {
    invoke(repo, ['state', '--role', 'codex', '--state', 'WAITING', '--details', 'valid']);
    const stateDirectory = join(repo, '.agent-bus', 'state', 'codex');
    writeFileSync(join(stateDirectory, '99999999999999999-damaged.json'), '{broken', 'utf8');
    const status = invoke(repo, ['status']);
    assert.equal(status.status, 0, status.stderr);
    const parsed = JSON.parse(status.stdout);
    assert.equal(parsed.states.codex.state, 'WAITING');
    assert.equal(parsed.diagnostics.invalid_state_records.codex, 1);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test('requires an explicit confirmation before cleaning sensitive bus data', () => {
  const repo = repository();
  try {
    const denied = invoke(repo, ['clean', '--confirm', 'NO']);
    assert.equal(denied.status, 1);
    const accepted = invoke(repo, ['clean', '--confirm', 'DELETE_AGENT_BUS']);
    assert.equal(accepted.status, 0, accepted.stderr);
    assert.equal(existsSync(join(repo, '.agent-bus')), false);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
