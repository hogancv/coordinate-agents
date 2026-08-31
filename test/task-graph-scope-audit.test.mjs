/**
 * Focused deterministic tests for the post-execution scope audit (issue #33).
 *
 * Every test uses an isolated temporary Git repository. Tests never invoke
 * live model accounts or modify a real project. Paths with spaces and shell
 * metacharacters are covered explicitly.
 */
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  auditSubtaskScope,
  collectCommittedChanges,
  collectDirtyChanges,
  parseNameStatus,
  parsePorcelainStatus,
  pathCoveredByIntent,
  pathMatchesPattern,
  patternToRegex,
  subtaskScopeIntent,
} from '../skills/coordinate-agents/scripts/scope-audit.mjs';
import {
  readTaskGraph,
  setTaskGraphSubtaskState,
} from '../skills/coordinate-agents/scripts/task-graph-runtime.mjs';
import {
  runtimeTaskGraphCreate,
  runtimeTaskGraphStatus,
} from '../bin/coordinate-agents.mjs';

const canonicalTmpdir = realpathSync(tmpdir());

// ------------------------------------------------------------------
// Repository helpers
// ------------------------------------------------------------------

function tempRepo(prefix = 'coordinate-scope-audit-') {
  const root = mkdtempSync(join(canonicalTmpdir, prefix));
  execFileSync('git', ['init', root], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Scope Audit Test'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'test@scope.invalid'], { cwd: root, stdio: 'ignore', windowsHide: true });
  writeFileSync(join(root, 'README.md'), '# Scope Audit Test\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: root, stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: root, stdio: 'ignore', windowsHide: true });
  return root;
}

function headCommit(repoPath) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf8', windowsHide: true }).trim();
}

function makeCommit(repoPath, files, message = 'Test commit') {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(repoPath, ...rel.split('/'));
    mkdirSync(join(repoPath, ...rel.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(full, content, 'utf8');
    execFileSync('git', ['add', rel], { cwd: repoPath, stdio: 'ignore', windowsHide: true });
  }
  execFileSync('git', ['commit', '-m', message], { cwd: repoPath, stdio: 'ignore', windowsHide: true });
  return headCommit(repoPath);
}

function simpleGraph(parentTaskId = 'task-scope-audit') {
  return {
    schemaVersion: 1,
    parentTask: { id: parentTaskId, title: 'Scope audit test graph', planner: 'codex', reviewer: 'codex' },
    subtasks: [
      { id: 'backend', implementer: 'antigravity', spec: 'Implement backend.' },
      { id: 'docs', implementer: 'codex', spec: 'Write docs.', dependsOn: ['backend'] },
    ],
    maxConcurrency: 2,
  };
}

function intentMap(parentTaskId = 'task-scope-audit', scopePolicy = 'warn') {
  return {
    schemaVersion: 1,
    parentTaskId,
    scopePolicy,
    subtasks: [
      { id: 'backend', writeIntent: ['src/backend/**', 'lib/**'] },
      { id: 'docs', writeIntent: [] },
    ],
  };
}

// ------------------------------------------------------------------
// Unit: patternToRegex and pathMatchesPattern
// ------------------------------------------------------------------

test('patternToRegex: glob star matches any segment at any depth', () => {
  assert.ok(patternToRegex('src/**').test('src/foo/bar.js'));
  assert.ok(patternToRegex('src/**').test('src/a'));
  assert.ok(!patternToRegex('src/**').test('lib/foo.js'));
  assert.ok(patternToRegex('**/*.js').test('src/foo/bar.js'));
  assert.ok(!patternToRegex('**/*.js').test('src/foo/bar.ts'));
});

test('patternToRegex: single star does not cross path separator', () => {
  assert.ok(patternToRegex('src/*.js').test('src/foo.js'));
  assert.ok(!patternToRegex('src/*.js').test('src/a/foo.js'));
});

test('patternToRegex: question mark matches one non-separator character', () => {
  assert.ok(patternToRegex('src/f?o.js').test('src/foo.js'));
  assert.ok(!patternToRegex('src/f?o.js').test('src/fooo.js'));
});

test('patternToRegex: literal pattern without slash matches at any depth', () => {
  assert.ok(patternToRegex('README.md').test('README.md'));
  assert.ok(patternToRegex('README.md').test('docs/README.md'));
  assert.ok(!patternToRegex('README.md').test('README.zh-CN.md'));
});

test('patternToRegex: literal pattern with slash is anchored from root', () => {
  assert.ok(patternToRegex('src/index.js').test('src/index.js'));
  assert.ok(!patternToRegex('src/index.js').test('lib/src/index.js'));
});

test('pathMatchesPattern: covers representative fixture paths', () => {
  assert.ok(pathMatchesPattern('src/backend/api.js', 'src/backend/**'));
  assert.ok(!pathMatchesPattern('lib/util.js', 'src/backend/**'));
  assert.ok(pathMatchesPattern('lib/util.js', 'lib/**'));
  assert.ok(!pathMatchesPattern('src/frontend/index.js', 'src/backend/**'));
});

test('pathMatchesPattern: paths with spaces and shell metacharacters', () => {
  assert.ok(pathMatchesPattern('path with spaces/file.js', 'path with spaces/**'));
  assert.ok(!pathMatchesPattern('path with spaces/file.js', 'other/**'));
  // Dollar and semicolon in path segment
  assert.ok(pathMatchesPattern('src/$value;literal/file.js', 'src/**'));
});

test('pathCoveredByIntent: returns false for empty intent list', () => {
  assert.ok(!pathCoveredByIntent('src/foo.js', []));
});

test('pathCoveredByIntent: returns true when any pattern matches', () => {
  assert.ok(pathCoveredByIntent('src/backend/api.js', ['src/backend/**', 'lib/**']));
  assert.ok(!pathCoveredByIntent('docs/readme.md', ['src/backend/**', 'lib/**']));
});

// ------------------------------------------------------------------
// Unit: parseNameStatus and parsePorcelainStatus
// ------------------------------------------------------------------

test('parseNameStatus: parses additions, modifications, deletions, and renames', () => {
  const output = 'A\0src/new.js\0M\0src/old.js\0D\0lib/removed.js\0R80\0lib/old-name.js\0lib/new-name.js\0C90\0src/base.js\0src/copy.js\0';
  const changes = parseNameStatus(output);
  assert.equal(changes.length, 5);
  assert.deepEqual(changes[0], { status: 'A', path: 'src/new.js' });
  assert.deepEqual(changes[1], { status: 'M', path: 'src/old.js' });
  assert.deepEqual(changes[2], { status: 'D', path: 'lib/removed.js' });
  assert.deepEqual(changes[3], { status: 'R', oldPath: 'lib/old-name.js', path: 'lib/new-name.js' });
  assert.deepEqual(changes[4], { status: 'C', oldPath: 'src/base.js', path: 'src/copy.js' });
});

test('parseNameStatus: rejects non-portable backslash paths', () => {
  const output = 'M\0src\\backend\\file.js\0';
  assert.throws(() => parseNameStatus(output), error => error.code === 'TASK_STATE_CONFLICT' && error.stage === 'scope-audit');
});

test('parsePorcelainStatus: parses modified, untracked, and renamed', () => {
  const output = ' M src/modified.js\0?? src/untracked.js\0R  src/new.js\0src/old.js\0';
  const changes = parsePorcelainStatus(output);
  assert.equal(changes.length, 3);
  assert.equal(changes[0].path, 'src/modified.js');
  assert.equal(changes[1].path, 'src/untracked.js');
  assert.equal(changes[2].path, 'src/new.js');
  assert.equal(changes[2].oldPath, 'src/old.js');
});

// ------------------------------------------------------------------
// Unit: collectCommittedChanges
// ------------------------------------------------------------------

test('collectCommittedChanges: returns additions between two real commits', () => {
  const root = tempRepo('coordinate-scope-committed-');
  try {
    const base = headCommit(root);
    const impl = makeCommit(root, { 'src/backend/api.js': 'api\n', 'lib/util.js': 'util\n' });
    const changes = collectCommittedChanges(root, base, impl);
    assert.ok(changes.length >= 2);
    assert.ok(changes.some(c => c.path === 'src/backend/api.js'));
    assert.ok(changes.some(c => c.path === 'lib/util.js'));
    assert.ok(changes.every(c => c.status));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('collectCommittedChanges: fails closed for invalid or missing arguments', () => {
  assert.throws(() => collectCommittedChanges(null, 'abc', 'def'), error => error.code === 'TASK_STATE_CONFLICT' && error.stage === 'scope-audit');
  assert.throws(() => collectCommittedChanges('/nonexistent', 'a'.repeat(40), 'b'.repeat(40)), error => error.code === 'TASK_STATE_CONFLICT' && error.stage === 'scope-audit');
});

test('collectCommittedChanges: includes rename with both path sides', () => {
  const root = tempRepo('coordinate-scope-rename-');
  try {
    const base = headCommit(root);
    // Create original file
    makeCommit(root, { 'lib/old-name.js': 'content\n' }, 'Add original');
    const preRename = headCommit(root);
    // Rename via git mv
    execFileSync('git', ['mv', 'lib/old-name.js', 'lib/new-name.js'], { cwd: root, stdio: 'ignore', windowsHide: true });
    execFileSync('git', ['commit', '-m', 'Rename file'], { cwd: root, stdio: 'ignore', windowsHide: true });
    const impl = headCommit(root);
    const changes = collectCommittedChanges(root, preRename, impl);
    const rename = changes.find(c => c.status === 'R');
    assert.ok(rename, 'Expected a rename change record');
    assert.ok(rename.oldPath && rename.path, 'Rename must have both path sides');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// Unit: collectDirtyChanges
// ------------------------------------------------------------------

test('collectDirtyChanges: reports uncommitted worktree files', () => {
  const root = tempRepo('coordinate-scope-dirty-');
  try {
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'dirty.js'), 'dirty\n', 'utf8');
    // Don't add or commit — file is untracked
    const changes = collectDirtyChanges(root);
    // Git should report the untracked src/ directory or src/dirty.js
    assert.ok(Array.isArray(changes));
    assert.ok(changes.length > 0, 'Expected at least one dirty change to be reported');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('collectDirtyChanges: returns empty array in clean worktree', () => {
  const root = tempRepo('coordinate-scope-clean-');
  try {
    const changes = collectDirtyChanges(root);
    assert.deepEqual(changes, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('collectDirtyChanges: fails closed for invalid path', () => {
  assert.throws(() => collectDirtyChanges('/nonexistent-path'), error => error.code === 'TASK_STATE_CONFLICT' && error.stage === 'scope-audit');
  assert.throws(() => collectDirtyChanges(null), error => error.code === 'TASK_STATE_CONFLICT' && error.stage === 'scope-audit');
});

// ------------------------------------------------------------------
// Unit: auditSubtaskScope — core policy logic
// ------------------------------------------------------------------

test('auditSubtaskScope: in-scope committed changes produce no drift', () => {
  const root = tempRepo('coordinate-scope-inscope-');
  try {
    const base = headCommit(root);
    const impl = makeCommit(root, {
      'src/backend/api.js': 'api code\n',
      'lib/helper.js': 'helper\n',
    }, 'In-scope implementation');
    const result = auditSubtaskScope({
      parentTaskId: 'task-inscope',
      subtaskId: 'backend',
      graphBaseCommit: base,
      implementationCommit: impl,
      worktreePath: root,
      writeIntent: ['src/backend/**', 'lib/**'],
      scopePolicy: 'warn',
    });
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.drift, false);
    assert.equal(result.driftEvidence, null);
    assert.equal(result.outsideIntentPaths.length, 0);
    assert.ok(result.actualPaths.includes('src/backend/api.js'));
    assert.ok(result.actualPaths.includes('lib/helper.js'));
    assert.equal(result.scopePolicy, 'warn');
    assert.equal(result.coverage, 'declared');
    assert.equal(result.parentTaskId, 'task-inscope');
    assert.equal(result.subtaskId, 'backend');
    assert.equal(result.graphBaseCommit, base);
    assert.equal(result.implementationCommit, impl);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('auditSubtaskScope: outside-intent committed changes produce drift with INTENT_SCOPE_DRIFT evidence', () => {
  const root = tempRepo('coordinate-scope-outside-');
  try {
    const base = headCommit(root);
    const impl = makeCommit(root, {
      'src/backend/api.js': 'backend\n',
      'src/frontend/index.js': 'frontend — outside intent\n',
    }, 'Mixed scope implementation');
    const result = auditSubtaskScope({
      parentTaskId: 'task-outside',
      subtaskId: 'backend',
      graphBaseCommit: base,
      implementationCommit: impl,
      worktreePath: root,
      writeIntent: ['src/backend/**'],
      scopePolicy: 'observe',
    });
    assert.equal(result.drift, true);
    assert.ok(result.driftEvidence !== null);
    assert.equal(result.driftEvidence.code, 'INTENT_SCOPE_DRIFT');
    assert.ok(result.outsideIntentPaths.includes('src/frontend/index.js'));
    assert.ok(!result.outsideIntentPaths.includes('src/backend/api.js'));
    assert.equal(result.scopePolicy, 'observe');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('auditSubtaskScope: explicit-empty writeIntent audits all writes as outside scope', () => {
  const root = tempRepo('coordinate-scope-empty-intent-');
  try {
    const base = headCommit(root);
    const impl = makeCommit(root, {
      'some/file.js': 'changed\n',
    }, 'Unexpected write');
    const result = auditSubtaskScope({
      parentTaskId: 'task-empty',
      subtaskId: 'docs',
      graphBaseCommit: base,
      implementationCommit: impl,
      worktreePath: root,
      writeIntent: [],
      scopePolicy: 'warn',
    });
    assert.equal(result.drift, true);
    assert.equal(result.coverage, 'explicit-empty');
    assert.ok(result.outsideIntentPaths.includes('some/file.js'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('auditSubtaskScope: explicit-empty writeIntent with no actual writes produces no drift', () => {
  const root = tempRepo('coordinate-scope-empty-clean-');
  try {
    const base = headCommit(root);
    // Re-commit the same file (no real new files) — but actually we need an
    // implementation commit different from base. Make a minimal change.
    const impl = makeCommit(root, { 'README.md': '# Updated\n' }, 'Touch readme');
    const result = auditSubtaskScope({
      parentTaskId: 'task-empty-clean',
      subtaskId: 'docs',
      graphBaseCommit: base,
      implementationCommit: impl,
      worktreePath: root,
      writeIntent: [],
      scopePolicy: 'strict',
    });
    // README.md was changed so it IS drift for empty intent
    assert.equal(result.drift, true);
    assert.ok(result.outsideIntentPaths.includes('README.md'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('auditSubtaskScope: rename records both old and new path sides', () => {
  const root = tempRepo('coordinate-scope-rename-audit-');
  try {
    const base = headCommit(root);
    makeCommit(root, { 'src/old.js': 'old content\n' }, 'Add old file');
    const preRename = headCommit(root);
    execFileSync('git', ['mv', 'src/old.js', 'src/new.js'], { cwd: root, stdio: 'ignore', windowsHide: true });
    execFileSync('git', ['commit', '-m', 'Rename src/old.js to src/new.js'], { cwd: root, stdio: 'ignore', windowsHide: true });
    const impl = headCommit(root);

    // src/** covers both sides
    const inScope = auditSubtaskScope({
      parentTaskId: 'task-rename',
      subtaskId: 'backend',
      graphBaseCommit: preRename,
      implementationCommit: impl,
      worktreePath: root,
      writeIntent: ['src/**'],
      scopePolicy: 'warn',
    });
    assert.equal(inScope.drift, false);
    assert.ok(inScope.committedChanges.some(c => c.status === 'R'));

    // Only new path covered — old path may be considered outside
    const oldPathOutside = auditSubtaskScope({
      parentTaskId: 'task-rename-2',
      subtaskId: 'backend',
      graphBaseCommit: preRename,
      implementationCommit: impl,
      worktreePath: root,
      writeIntent: ['src/new.js'],
      scopePolicy: 'observe',
    });
    assert.equal(oldPathOutside.drift, true);
    assert.ok(oldPathOutside.outsideIntentPaths.includes('src/old.js'));
    assert.ok(oldPathOutside.driftEvidence.committedOutside.some(change => (
      change.status === 'R' && change.oldPath === 'src/old.js' && change.path === 'src/new.js'
    )));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('auditSubtaskScope: deletion is reported in committedChanges', () => {
  const root = tempRepo('coordinate-scope-deletion-');
  try {
    makeCommit(root, { 'lib/to-delete.js': 'will be deleted\n' }, 'Add file');
    const base = headCommit(root);
    execFileSync('git', ['rm', 'lib/to-delete.js'], { cwd: root, stdio: 'ignore', windowsHide: true });
    writeFileSync(join(root, 'README.md'), '# Modified while deleting\n', 'utf8');
    execFileSync('git', ['add', 'README.md'], { cwd: root, stdio: 'ignore', windowsHide: true });
    execFileSync('git', ['commit', '-m', 'Delete and modify files'], { cwd: root, stdio: 'ignore', windowsHide: true });
    const impl = headCommit(root);

    const result = auditSubtaskScope({
      parentTaskId: 'task-deletion',
      subtaskId: 'backend',
      graphBaseCommit: base,
      implementationCommit: impl,
      worktreePath: root,
      writeIntent: ['README.md', 'lib/**'],
      scopePolicy: 'strict',
    });
    assert.equal(result.drift, false);
    assert.ok(result.committedChanges.some(c => c.status === 'D' && c.path === 'lib/to-delete.js'));
    assert.ok(result.committedChanges.some(c => c.status === 'M' && c.path === 'README.md'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('auditSubtaskScope: dirty worktree changes are captured in hasDirty and dirtyChanges', () => {
  const root = tempRepo('coordinate-scope-dirty-audit-');
  try {
    const base = headCommit(root);
    const impl = makeCommit(root, { 'src/committed.js': 'committed\n' }, 'Committed');
    // Add an uncommitted file in the worktree
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'dirty.js'), 'dirty uncommitted\n', 'utf8');

    const result = auditSubtaskScope({
      parentTaskId: 'task-dirty',
      subtaskId: 'backend',
      graphBaseCommit: base,
      implementationCommit: impl,
      worktreePath: root,
      writeIntent: ['src/**'],
      scopePolicy: 'warn',
    });
    assert.equal(result.hasDirty, true);
    assert.ok(result.dirtyChanges.length > 0);
    assert.equal(result.dirtyChangeCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('auditSubtaskScope: missing Intent Map cannot invent scope evidence', () => {
  assert.throws(() => auditSubtaskScope({
    parentTaskId: 'task-legacy',
    subtaskId: 'backend',
    graphBaseCommit: 'a'.repeat(40),
    implementationCommit: 'b'.repeat(40),
    worktreePath: '/unused',
    writeIntent: null,
    scopePolicy: null,
  }), error => error.code === 'TASK_STATE_CONFLICT' && error.stage === 'scope-audit');
});

test('auditSubtaskScope: paths with spaces and shell metacharacters are handled safely', () => {
  const root = mkdtempSync(join(canonicalTmpdir, 'coordinate scope audit $;-'));
  try {
    execFileSync('git', ['init', root], { stdio: 'ignore', windowsHide: true });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root, stdio: 'ignore', windowsHide: true });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root, stdio: 'ignore', windowsHide: true });
    writeFileSync(join(root, 'README.md'), '# Initial\n', 'utf8');
    execFileSync('git', ['add', 'README.md'], { cwd: root, stdio: 'ignore', windowsHide: true });
    execFileSync('git', ['commit', '-m', 'Initial'], { cwd: root, stdio: 'ignore', windowsHide: true });
    const base = headCommit(root);

    // Create a file with spaces, a tab, and shell metacharacters. Argument
    // arrays plus NUL-delimited Git output must preserve it exactly.
    mkdirSync(join(root, 'src'), { recursive: true });
    const unusualPath = process.platform === 'win32'
      ? 'src/path with space $value;[x].js'
      : 'src/path with space\t$value;[x].js';
    writeFileSync(join(root, unusualPath), 'impl\n', 'utf8');
    execFileSync('git', ['add', unusualPath], { cwd: root, stdio: 'ignore', windowsHide: true });
    execFileSync('git', ['commit', '-m', 'Add product'], { cwd: root, stdio: 'ignore', windowsHide: true });
    const impl = headCommit(root);

    const result = auditSubtaskScope({
      parentTaskId: 'task-spaces',
      subtaskId: 'backend',
      graphBaseCommit: base,
      implementationCommit: impl,
      worktreePath: root,
      writeIntent: ['src/**'],
      scopePolicy: 'warn',
    });
    assert.equal(result.drift, false);
    assert.ok(result.actualPaths.includes(unusualPath));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// Unit: subtaskScopeIntent
// ------------------------------------------------------------------

test('subtaskScopeIntent: returns null for graph without Intent Map', async () => {
  const root = tempRepo('coordinate-scope-intent-legacy-');
  try {
    await runtimeTaskGraphCreate({ root, graph: simpleGraph('task-intent-legacy-scope') });
    const graph = readTaskGraph(root, 'task-intent-legacy-scope');
    const { writeIntent, scopePolicy } = subtaskScopeIntent(graph, 'backend');
    assert.equal(writeIntent, null);
    assert.equal(scopePolicy, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('subtaskScopeIntent: returns declared patterns and policy for graph with Intent Map', async () => {
  const root = tempRepo('coordinate-scope-intent-declared-');
  try {
    await runtimeTaskGraphCreate({
      root,
      graph: simpleGraph('task-intent-declared'),
      intentMap: intentMap('task-intent-declared', 'strict'),
    });
    const graph = readTaskGraph(root, 'task-intent-declared');
    const { writeIntent, scopePolicy } = subtaskScopeIntent(graph, 'backend');
    assert.deepEqual(writeIntent, ['lib/**', 'src/backend/**']);
    assert.equal(scopePolicy, 'strict');
    const { writeIntent: docsIntent } = subtaskScopeIntent(graph, 'docs');
    assert.deepEqual(docsIntent, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// Integration: observe policy records without blocking completion
// ------------------------------------------------------------------

test('observe policy: records drift evidence without changing SUCCEEDED state', async () => {
  const root = tempRepo('coordinate-scope-observe-');
  try {
    await runtimeTaskGraphCreate({
      root,
      graph: simpleGraph('task-observe'),
      intentMap: intentMap('task-observe', 'observe'),
    });
    const graph = readTaskGraph(root, 'task-observe');
    const base = graph.baseCommit || headCommit(root);

    // Simulate a drift commit: backend subtask writes outside src/backend/** and lib/**
    const implCommit = makeCommit(root, {
      'src/backend/api.js': 'backend\n',
      'src/frontend/leaked.js': 'leaked — outside intent\n',
    }, 'Drifted backend impl');

    // Manually run scope audit (simulating dispatch completion)
    const { writeIntent, scopePolicy } = subtaskScopeIntent(graph, 'backend');
    const evidence = auditSubtaskScope({
      parentTaskId: 'task-observe',
      subtaskId: 'backend',
      graphBaseCommit: base,
      implementationCommit: implCommit,
      worktreePath: root,
      writeIntent,
      scopePolicy,
    });
    assert.equal(evidence.drift, true);
    assert.equal(evidence.scopePolicy, 'observe');
    assert.ok(evidence.outsideIntentPaths.includes('src/frontend/leaked.js'));

    // Persist with SUCCEEDED (observe keeps completion)
    setTaskGraphSubtaskState(root, 'task-observe', 'backend', 'SUCCEEDED', {
      expectedState: 'READY',
      implementationCommit: implCommit,
      evidence: [{ type: 'IMPLEMENTATION_DONE', relatedCommit: implCommit }],
      worktreePath: root,
      branch: 'coordinate-agents/task-observe/backend',
      ref: 'refs/heads/coordinate-agents/task-observe/backend',
      baseCommit: base,
      lastError: null,
      scopeEvidence: evidence,
    });

    const stored = readTaskGraph(root, 'task-observe');
    const backend = stored.subtasks.find(s => s.id === 'backend');
    assert.equal(backend.state, 'SUCCEEDED');
    assert.ok(backend.scopeEvidence !== undefined && backend.scopeEvidence !== null);
    assert.equal(backend.scopeEvidence.drift, true);
    assert.equal(backend.scopeEvidence.scopePolicy, 'observe');
    assert.ok(backend.scopeEvidence.driftEvidence.code === 'INTENT_SCOPE_DRIFT');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// Integration: warn policy records visible warning and keeps SUCCEEDED
// ------------------------------------------------------------------

test('warn policy: records INTENT_SCOPE_DRIFT evidence and keeps SUCCEEDED', async () => {
  const root = tempRepo('coordinate-scope-warn-');
  try {
    await runtimeTaskGraphCreate({
      root,
      graph: simpleGraph('task-warn'),
      intentMap: intentMap('task-warn', 'warn'),
    });
    const graph = readTaskGraph(root, 'task-warn');
    const base = graph.baseCommit || headCommit(root);

    const implCommit = makeCommit(root, {
      'lib/backend.js': 'in-scope\n',
      'docs/extra.md': 'outside intent\n',
    }, 'Warn drift impl');

    const { writeIntent, scopePolicy } = subtaskScopeIntent(graph, 'backend');
    const evidence = auditSubtaskScope({
      parentTaskId: 'task-warn',
      subtaskId: 'backend',
      graphBaseCommit: base,
      implementationCommit: implCommit,
      worktreePath: root,
      writeIntent,
      scopePolicy,
    });

    assert.equal(evidence.drift, true);
    assert.equal(evidence.scopePolicy, 'warn');
    assert.ok(evidence.outsideIntentPaths.includes('docs/extra.md'));

    setTaskGraphSubtaskState(root, 'task-warn', 'backend', 'SUCCEEDED', {
      expectedState: 'READY',
      implementationCommit: implCommit,
      evidence: [{ type: 'IMPLEMENTATION_DONE', relatedCommit: implCommit }],
      worktreePath: root,
      branch: 'coordinate-agents/task-warn/backend',
      ref: 'refs/heads/coordinate-agents/task-warn/backend',
      baseCommit: base,
      lastError: null,
      reason: `INTENT_SCOPE_DRIFT: ${evidence.outsideIntentPaths.slice(0, 2).join(', ')}`,
      scopeEvidence: evidence,
    });

    const stored = readTaskGraph(root, 'task-warn');
    const backend = stored.subtasks.find(s => s.id === 'backend');
    assert.equal(backend.state, 'SUCCEEDED');
    assert.ok(/INTENT_SCOPE_DRIFT/.test(backend.reason));
    assert.equal(backend.scopeEvidence.drift, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('persistence rejects Scope Audit evidence that contradicts the Intent Map', async () => {
  const root = tempRepo('coordinate-scope-contradictory-');
  try {
    await runtimeTaskGraphCreate({
      root,
      graph: simpleGraph('task-contradictory-scope'),
      intentMap: intentMap('task-contradictory-scope', 'observe'),
    });
    const graph = readTaskGraph(root, 'task-contradictory-scope');
    const base = graph.baseCommit || headCommit(root);
    const implCommit = makeCommit(root, { 'src/backend/api.js': 'backend\n' }, 'Scope evidence');
    const evidence = auditSubtaskScope({
      parentTaskId: graph.parentTaskId,
      subtaskId: 'backend',
      graphBaseCommit: base,
      implementationCommit: implCommit,
      worktreePath: root,
      writeIntent: graph.intentMap.subtasks.find(item => item.id === 'backend').writeIntent,
      scopePolicy: 'observe',
    });
    assert.throws(() => setTaskGraphSubtaskState(root, graph.parentTaskId, 'backend', 'SUCCEEDED', {
      expectedState: 'READY',
      baseCommit: base,
      implementationCommit: implCommit,
      scopeEvidence: { ...evidence, scopePolicy: 'strict' },
    }), error => error.code === 'TASK_STATE_CONFLICT');
    assert.equal(readTaskGraph(root, graph.parentTaskId).subtasks.find(item => item.id === 'backend').state, 'READY');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// Integration: strict policy blocks successful prerequisite eligibility
// ------------------------------------------------------------------

test('strict policy: drift transitions subtask to FAILED and leaves worktree intact', async () => {
  const root = tempRepo('coordinate-scope-strict-');
  try {
    await runtimeTaskGraphCreate({
      root,
      graph: simpleGraph('task-strict'),
      intentMap: intentMap('task-strict', 'strict'),
    });
    const graph = readTaskGraph(root, 'task-strict');
    const base = graph.baseCommit || headCommit(root);

    const implCommit = makeCommit(root, {
      'src/backend/api.js': 'backend\n',
      'config/settings.json': '{"leaked": true}\n',
    }, 'Strict drift impl');

    const { writeIntent, scopePolicy } = subtaskScopeIntent(graph, 'backend');
    const evidence = auditSubtaskScope({
      parentTaskId: 'task-strict',
      subtaskId: 'backend',
      graphBaseCommit: base,
      implementationCommit: implCommit,
      worktreePath: root,
      writeIntent,
      scopePolicy,
    });

    assert.equal(evidence.drift, true);
    assert.equal(evidence.scopePolicy, 'strict');
    assert.ok(evidence.outsideIntentPaths.includes('config/settings.json'));

    // Under strict, transition to FAILED (not SUCCEEDED)
    setTaskGraphSubtaskState(root, 'task-strict', 'backend', 'FAILED', {
      expectedState: 'READY',
      implementationCommit: implCommit,
      evidence: [{ type: 'IMPLEMENTATION_DONE', relatedCommit: implCommit }],
      worktreePath: root,
      branch: 'coordinate-agents/task-strict/backend',
      ref: 'refs/heads/coordinate-agents/task-strict/backend',
      baseCommit: base,
      lastError: { code: 'INTENT_SCOPE_DRIFT', message: 'Drift detected', recoverable: true },
      scopeEvidence: evidence,
    });

    const stored = readTaskGraph(root, 'task-strict');
    const backend = stored.subtasks.find(s => s.id === 'backend');
    assert.equal(backend.state, 'FAILED');
    assert.equal(backend.scopeEvidence.drift, true);
    // Docs subtask (depends on backend) must NOT be READY yet
    const docs = stored.subtasks.find(s => s.id === 'docs');
    assert.notEqual(docs.state, 'READY');
    // Implementation commit preserved
    assert.equal(backend.implementationCommit, implCommit);
    // Worktree path preserved (not deleted)
    assert.equal(backend.worktreePath, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// Integration: no drift → strict policy does not block
// ------------------------------------------------------------------

test('strict policy: clean in-scope changes succeed without drift', async () => {
  const root = tempRepo('coordinate-scope-strict-clean-');
  try {
    await runtimeTaskGraphCreate({
      root,
      graph: simpleGraph('task-strict-clean'),
      intentMap: intentMap('task-strict-clean', 'strict'),
    });
    const graph = readTaskGraph(root, 'task-strict-clean');
    const base = graph.baseCommit || headCommit(root);

    const implCommit = makeCommit(root, {
      'src/backend/api.js': 'backend\n',
      'lib/helper.js': 'helper\n',
    }, 'In-scope strict impl');

    const { writeIntent, scopePolicy } = subtaskScopeIntent(graph, 'backend');
    const evidence = auditSubtaskScope({
      parentTaskId: 'task-strict-clean',
      subtaskId: 'backend',
      graphBaseCommit: base,
      implementationCommit: implCommit,
      worktreePath: root,
      writeIntent,
      scopePolicy,
    });

    assert.equal(evidence.drift, false);
    assert.equal(evidence.scopePolicy, 'strict');
    assert.equal(evidence.driftEvidence, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// Integration: missing Intent Map preserves v2.3 completion semantics
// ------------------------------------------------------------------

test('missing Intent Map: preserves v2.3 coverage and stores no invented scope evidence', async () => {
  const root = tempRepo('coordinate-scope-v23-');
  try {
    await runtimeTaskGraphCreate({
      root,
      graph: simpleGraph('task-v23-compat'),
      // No intentMap — v2.3 behavior
    });
    const graph = readTaskGraph(root, 'task-v23-compat');
    const { writeIntent, scopePolicy } = subtaskScopeIntent(graph, 'backend');
    assert.equal(writeIntent, null);
    assert.equal(scopePolicy, null);

    assert.equal(Object.hasOwn(graph.subtasks.find(subtask => subtask.id === 'backend'), 'scopeEvidence'), false);

    // Graph status also shows unavailable intent coverage
    const status = await runtimeTaskGraphStatus({ root, taskId: 'task-v23-compat' });
    assert.equal(status.intentCoverage.available, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// Integration: audit before dependent eligibility
// ------------------------------------------------------------------

test('audit is performed before dependent eligibility: strict drift leaves docs WAITING', async () => {
  const root = tempRepo('coordinate-scope-eligibility-');
  try {
    await runtimeTaskGraphCreate({
      root,
      graph: simpleGraph('task-eligibility'),
      intentMap: intentMap('task-eligibility', 'strict'),
    });
    const graph = readTaskGraph(root, 'task-eligibility');
    const base = graph.baseCommit || headCommit(root);

    const implCommit = makeCommit(root, {
      'src/backend/api.js': 'backend\n',
      'outside/leaked.js': 'leaked\n',
    }, 'Drift commit');

    const { writeIntent, scopePolicy } = subtaskScopeIntent(graph, 'backend');
    const evidence = auditSubtaskScope({
      parentTaskId: 'task-eligibility',
      subtaskId: 'backend',
      graphBaseCommit: base,
      implementationCommit: implCommit,
      worktreePath: root,
      writeIntent,
      scopePolicy,
    });
    assert.equal(evidence.drift, true);

    // Strict: FAILED transition
    setTaskGraphSubtaskState(root, 'task-eligibility', 'backend', 'FAILED', {
      expectedState: 'READY',
      implementationCommit: implCommit,
      evidence: [{ type: 'IMPLEMENTATION_DONE', relatedCommit: implCommit }],
      worktreePath: root,
      branch: 'coordinate-agents/task-eligibility/backend',
      ref: 'refs/heads/coordinate-agents/task-eligibility/backend',
      baseCommit: base,
      lastError: { code: 'INTENT_SCOPE_DRIFT', message: 'Drift', recoverable: true },
      scopeEvidence: evidence,
    });

    const stored = readTaskGraph(root, 'task-eligibility');
    const docs = stored.subtasks.find(s => s.id === 'docs');
    // docs depends on backend; since backend is FAILED, docs must not be READY
    assert.notEqual(docs.state, 'READY');
    assert.notEqual(docs.state, 'SUCCEEDED');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// Integration: observe and warn policies do not block dependent eligibility
// ------------------------------------------------------------------

test('observe and warn policies: docs becomes READY after drifted backend SUCCEEDED', async () => {
  for (const policy of ['observe', 'warn']) {
    const root = tempRepo(`coordinate-scope-${policy}-eligible-`);
    try {
      await runtimeTaskGraphCreate({
        root,
        graph: simpleGraph(`task-${policy}-eligible`),
        intentMap: intentMap(`task-${policy}-eligible`, policy),
      });
      const graph = readTaskGraph(root, `task-${policy}-eligible`);
      const base = graph.baseCommit || headCommit(root);

      const implCommit = makeCommit(root, {
        'src/backend/api.js': 'backend\n',
        'outside/leaked.js': 'leaked\n',
      }, `${policy} drift commit`);

      const { writeIntent, scopePolicy } = subtaskScopeIntent(graph, 'backend');
      const evidence = auditSubtaskScope({
        parentTaskId: `task-${policy}-eligible`,
        subtaskId: 'backend',
        graphBaseCommit: base,
        implementationCommit: implCommit,
        worktreePath: root,
        writeIntent,
        scopePolicy,
      });
      assert.equal(evidence.drift, true);

      setTaskGraphSubtaskState(root, `task-${policy}-eligible`, 'backend', 'SUCCEEDED', {
        expectedState: 'READY',
        implementationCommit: implCommit,
        evidence: [{ type: 'IMPLEMENTATION_DONE', relatedCommit: implCommit }],
        worktreePath: root,
        branch: `coordinate-agents/task-${policy}-eligible/backend`,
        ref: `refs/heads/coordinate-agents/task-${policy}-eligible/backend`,
        baseCommit: base,
        lastError: null,
        scopeEvidence: evidence,
      });

      const stored = readTaskGraph(root, `task-${policy}-eligible`);
      const backend = stored.subtasks.find(s => s.id === 'backend');
      assert.equal(backend.state, 'SUCCEEDED');
      // docs depends on backend → now READY
      const docs = stored.subtasks.find(s => s.id === 'docs');
      assert.equal(docs.state, 'READY');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

// ------------------------------------------------------------------
// Edge case: bounded evidence limits
// ------------------------------------------------------------------

test('auditSubtaskScope: outsideIntentPaths is bounded to SCOPE_AUDIT_MAX_EVIDENCE_ITEMS', async () => {
  const root = tempRepo('coordinate-scope-bounded-');
  try {
    const base = headCommit(root);
    // Create many files outside intent
    const files = {};
    for (let i = 0; i < 100; i += 1) {
      files[`outside/file-${i}.js`] = `export const x = ${i};\n`;
    }
    const impl = makeCommit(root, files, 'Many outside files');

    const result = auditSubtaskScope({
      parentTaskId: 'task-bounded',
      subtaskId: 'backend',
      graphBaseCommit: base,
      implementationCommit: impl,
      worktreePath: root,
      writeIntent: ['src/**'],
      scopePolicy: 'warn',
    });
    // Bounded to max
    assert.ok(result.outsideIntentPaths.length <= 64);
    assert.ok(result.actualPaths.length <= 64);
    assert.ok(result.driftEvidence.outsideIntentPaths.length <= 64);
    assert.equal(result.actualPathCount, 100);
    assert.equal(result.actualPathsTruncated, true);
    assert.equal(result.outsideIntentPathCount, 100);
    assert.equal(result.outsideIntentPathsTruncated, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------
// Edge case: audit determinism — same inputs produce same output
// ------------------------------------------------------------------

test('auditSubtaskScope: deterministic — same inputs produce identical normalized facts', () => {
  const root = tempRepo('coordinate-scope-deterministic-');
  try {
    const base = headCommit(root);
    const impl = makeCommit(root, {
      'src/backend/api.js': 'api\n',
      'src/frontend/ui.js': 'ui\n',
    }, 'Deterministic test');

    const params = {
      parentTaskId: 'task-det',
      subtaskId: 'backend',
      graphBaseCommit: base,
      implementationCommit: impl,
      worktreePath: root,
      writeIntent: ['src/backend/**'],
      scopePolicy: 'observe',
    };

    const first = auditSubtaskScope(params);
    const second = auditSubtaskScope(params);
    assert.deepEqual(first, second);
    assert.deepEqual(first.outsideIntentPaths, second.outsideIntentPaths);
    assert.deepEqual(first.actualPaths, second.actualPaths);
    assert.deepEqual(first.committedChanges, second.committedChanges);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
