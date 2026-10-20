import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, renameSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readGitChanges, readGitDiff } from '../skills/coordinate-agents/scripts/workspace-git-changes.mjs';
import { createLocalServer } from '../inspector/server/http-server.mjs';
import { createWorkspaceData } from '../inspector/server/workspace-data.mjs';
import { workspaceMessage } from '../skills/coordinate-agents/scripts/workspace-message.mjs';

function repo(t) {
  const root = mkdtempSync(join(tmpdir(), 'workspace-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
  return { root, git, put: (path, text) => writeFileSync(join(root, path), text) };
}

test('reads all statuses, staged and unstaged totals and literal special paths without mutating index', async t => {
  const { root, git, put } = repo(t);
  const odd = process.platform === 'win32' ? '中文 space [1].txt' : '中文 space\t[1]*.txt';
  put(odd, 'old\n'); put('deleted', 'gone\n'); put('before', 'rename\n');
  git('add', '.'); git('commit', '-qm', 'base');
  put(odd, 'staged\n'); git('add', '--', odd); put(odd, 'staged\nextra\n');
  rmSync(join(root, 'deleted')); renameSync(join(root, 'before'), join(root, 'after 中文'));
  git('add', '--', 'before', 'after 中文'); put('added', 'added\n'); git('add', 'added'); put('untracked', 'not counted\n');
  const before = git('status', '--porcelain=v1', '-z');
  const changes = await readGitChanges(root);
  assert.equal(changes.ok, true); assert.deepEqual(changes.summary, { files: 5, additions: 3, deletions: 2 });
  const files = new Map(changes.files.map(file => [file.path, file]));
  assert.equal(files.get(odd).status, 'modified'); assert.equal(files.get(odd).staged, true); assert.equal(files.get(odd).unstaged, true);
  assert.equal(files.get('deleted').status, 'deleted'); assert.equal(files.get('after 中文').status, 'renamed');
  assert.equal(files.get('after 中文').oldPath, 'before'); assert.equal(files.get('added').status, 'added');
  assert.equal(files.get('untracked').status, 'untracked'); assert.equal(files.get('untracked').additions, null);
  assert.match((await readGitDiff(root, odd)).diff, /\+extra/);
  assert.match((await readGitDiff(root, 'deleted')).diff, /-gone/);
  assert.match((await readGitDiff(root, 'after 中文')).diff, /rename from before/);
  assert.equal((await readGitDiff(root, 'untracked')).reason, 'untracked');
  assert.equal(git('status', '--porcelain=v1', '-z'), before);
});

test('rejects traversal, unchanged files and symlink ancestors; bounds large and binary diffs', async t => {
  const { root, git, put } = repo(t);
  put('clean', 'base\n'); put('binary', Buffer.from([0, 1, 2])); put('large', 'base\n');
  git('add', '.'); git('commit', '-qm', 'base');
  put('large', 'line\n'.repeat(100000)); put('binary', Buffer.from([0, 2, 3]));
  for (const path of ['../secret', '/etc/passwd', 'clean', './large', 'x/../large', 'large\0']) assert.equal((await readGitDiff(root, path)).ok, false);
  const big = await readGitDiff(root, 'large'); assert.equal(big.truncated, true); assert.equal(big.diff, '');
  assert.equal((await readGitDiff(root, 'binary')).reason, 'binary');
  assert.ok(Buffer.byteLength(JSON.stringify(await readGitChanges(root))) < 256 * 1024);
  const limited = await readGitChanges(root, { maxFiles: 1 }); assert.equal(limited.truncated, true); assert.equal(limited.files.length, 1); assert.equal(limited.summary.files, 2);
  mkdirSync(join(root, 'sub')); put('sub/file', 'base\n'); git('add', 'sub'); git('commit', '-qm', 'sub');
  rmSync(join(root, 'sub'), { recursive: true }); symlinkSync(tmpdir(), join(root, 'sub'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await readGitDiff(root, 'sub/file')).ok, false);
});

test('recovers for non repositories and missing git, supports repositories without HEAD', async t => {
  const { root, put } = repo(t); put('new', 'new\n');
  assert.equal((await readGitChanges(root)).files[0].status, 'untracked');
  const plain = mkdtempSync(join(tmpdir(), 'not-git-')); t.after(() => rmSync(plain, { recursive: true, force: true }));
  assert.equal((await readGitChanges(plain)).code, 'GIT_NOT_REPOSITORY');
  assert.equal((await readGitChanges(root, { gitExecutable: join(root, 'missing-git') })).code, 'GIT_UNAVAILABLE');
});

test('API requires capability and selects the project root; changes helper reads only its task without terminal side effects', async t => {
  const a = repo(t), b = repo(t);
  a.put('a', 'a\n'); b.put('b', 'b\n');
  const projects = { store: { get: id => ({ id, root: id === 'a' ? a.root : b.root }) }, contexts: new Map() };
  const server = createLocalServer({ root: a.root, ui: 'workspace', capability: 'test-capability', projects });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const url = `http://localhost:${server.address().port}`;
  assert.equal((await fetch(`${url}/api/git-changes`)).status, 403);
  const headers = { 'x-coordinate-agents-capability': 'test-capability' };
  const response = await fetch(`${url}/api/projects/b/api/git-changes`, { headers });
  assert.equal(response.status, 200); const changes = await response.json(); assert.equal(changes.files[0].path, 'b');
  const api = { readWorkspaceTask: async (root, id) => { assert.equal(root, b.root); assert.equal(id, 'task-b'); return { status: 'CLOSED', sessions: {} }; } };
  assert.deepEqual(await workspaceMessage(b.root, 'task-b', 'changes', undefined, api), changes);
  assert.deepEqual(await createWorkspaceData(b.root).readGitChanges(), changes);
});

test('staged rename followed by a rewrite includes source deletions even when HEAD sees delete/add', async t => {
  const { root, git, put } = repo(t);
  put('old', Array.from({ length: 10 }, (_, i) => `old ${i}\n`).join(''));
  git('add', '.'); git('commit', '-qm', 'base'); git('mv', 'old', 'new'); put('new', 'replacement\n');
  const result = await readGitChanges(root);
  assert.deepEqual(result.summary, { files: 1, additions: 1, deletions: 10 });
  assert.equal(result.files[0].deletions, 10);
});

test('unborn HEAD includes current content of staged additions with subsequent unstaged edits', async t => {
  const { root, git, put } = repo(t);
  put('added', 'staged\n'); git('add', '.'); put('added', 'working\nextra\n');
  const result = await readGitChanges(root);
  assert.deepEqual(result.summary, { files: 1, additions: 2, deletions: 0 });
  assert.equal(result.base, null);
  const diff = await readGitDiff(root, 'added'); assert.match(diff.diff, /\+working\n\+extra/); assert.doesNotMatch(diff.diff, /\+staged/);
});

test('Git reads do not run configured external diff, textconv, or fsmonitor commands', async t => {
  const { root, git, put } = repo(t);
  put('file.txt', 'before\n'); put('.gitattributes', '*.txt diff=unsafe\n');
  git('add', '.'); git('commit', '-qm', 'base'); put('file.txt', 'after\n');
  git('config', 'diff.external', 'an-external-tool-that-must-not-run');
  git('config', 'diff.unsafe.textconv', 'a-textconv-tool-that-must-not-run');
  git('config', 'core.fsmonitor', 'a-fsmonitor-tool-that-must-not-run');
  assert.deepEqual((await readGitChanges(root)).summary, { files: 1, additions: 1, deletions: 1 });
  assert.match((await readGitDiff(root, 'file.txt')).diff, /\+after/);
});

test('real changes CLI validates the stored task and leaves receipts and sessions unchanged', async t => {
  const { root, git, put } = repo(t);
  put('.gitignore', '.agent-bus/\n'); put('file.txt', 'before\n'); git('add', '.'); git('commit', '-qm', 'base'); put('file.txt', 'after\n');
  const directory = join(root, '.agent-bus', 'workspace-tasks'); mkdirSync(directory, { recursive: true });
  const id = 'workspace-changes0001', timestamp = '2026-10-14T00:00:00.000Z';
  const record = { schemaVersion: 1, id, title: 'Changes CLI', status: 'CLOSED', promptVersion: 'test',
    createdAt: timestamp, updatedAt: timestamp,
    sessions: { codex: { slot: 'codex', agent: 'codex', role: 'planner-reviewer', sessionId: null },
      antigravity: { slot: 'antigravity', agent: 'antigravity', role: 'implementer', sessionId: null } },
    sessionHistory: [], error: null };
  const taskText = JSON.stringify(record); writeFileSync(join(directory, `${id}.json`), taskText);
  const helper = new URL('../skills/coordinate-agents/scripts/workspace-message.mjs', import.meta.url);
  const { fileURLToPath } = await import('node:url'); const { readFileSync } = await import('node:fs');
  const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(helper), id, 'changes'], { cwd: root, encoding: 'utf8' }));
  assert.deepEqual(result.summary, { files: 1, additions: 1, deletions: 1 });
  assert.deepEqual(result, await readGitChanges(root));
  assert.equal(readFileSync(join(directory, `${id}.json`), 'utf8'), taskText);
  await assert.rejects(workspaceMessage(root, 'workspace-missing0001', 'changes'));
});
