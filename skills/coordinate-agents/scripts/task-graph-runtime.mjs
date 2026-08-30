import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';

import {
  DEFAULT_CONFIG,
  RESERVED_DEVICE_NAMES,
  acquireConfigLock,
  assertContained,
  assertSafePath,
  atomicWrite,
  readConfig,
  readInternalFile,
  safeInternalStat,
  writeConfig,
} from './config.mjs';
import {
  TASK_GRAPH_SCHEMA_VERSION,
  TASK_GRAPH_MAX_CONCURRENCY,
  TASK_GRAPH_MAX_SUBTASKS,
  TASK_GRAPH_STATES,
  TASK_GRAPH_SUBTASK_STATES,
  taskGraphDurableFacts,
  validateTaskGraphV1,
} from './task-graph-contract.mjs';
import { runtimeError, serializeRuntimeError } from './runtime-contract.mjs';
import {
  appendRuntimeEvent,
  readRuntimeEvents,
  sanitizeRuntimeEventData,
} from './runtime-events.mjs';
import { validateTaskId } from './task-runtime.mjs';
import { EXECUTION_SESSION_STATES } from './session-manager.mjs';
import {
  intentCoverageFacts,
  intentSchedulingWave,
  validateIntentMapV1,
  writeIntentConflictBetween,
} from './intent-map-contract.mjs';

export const TASK_GRAPH_STORE_DIRECTORY = 'task-graphs';
export const TASK_GRAPH_WORKTREES_DIRECTORY = 'worktrees';
export const TASK_GRAPH_INTEGRATION_DIRECTORY = '__integration__';
export const TASK_GRAPH_INTEGRATION_STATES = Object.freeze(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED']);
export const TASK_GRAPH_MAX_REASON_BYTES = 8 * 1024;
export const TASK_GRAPH_MAX_EVIDENCE_ITEMS = 64;
export const TASK_GRAPH_EVENT_LIMIT = 100;
const SUBTASK_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const COMMIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

const GRAPH_STATE_SET = new Set(TASK_GRAPH_STATES);
const SUBTASK_STATE_SET = new Set(TASK_GRAPH_SUBTASK_STATES);
const INTEGRATION_STATE_SET = new Set(TASK_GRAPH_INTEGRATION_STATES);
const TERMINAL_SUBTASK_STATES = new Set(['SUCCEEDED', 'FAILED', 'STOPPED']);
const FAILED_SUBTASK_STATES = new Set(['FAILED', 'BLOCKED', 'STOPPED']);
// PENDING/READY/WAITING are frontier states derived from dependency facts.
// BLOCKED is also a valid explicit state (for an unschedulable subtask), so
// preserve it rather than silently recomputing it as READY/WAITING.
const NON_EXECUTING_SUBTASK_STATES = new Set(['PENDING', 'READY', 'WAITING']);

function now() {
  return new Date().toISOString();
}

// Keep Git invocation argument-vector based.  Returning the small
// spawnSync-compatible result shape preserves the distinction between a Git
// command's non-zero exit (used for branch-not-found probes) and a process
// start failure while avoiding shell-string execution.
function runGit(args, cwd, { timeoutMs = null } = {}) {
  try {
    const options = {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    };
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) options.timeout = Math.floor(timeoutMs);
    return {
      status: 0,
      stdout: execFileSync('git', args, options),
      stderr: '',
      error: undefined,
    };
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : null;
    return {
      status,
      stdout: `${error?.stdout || ''}`,
      stderr: `${error?.stderr || ''}`,
      error: status === null ? error : undefined,
    };
  }
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function repositoryRoot(root) {
  const supplied = resolve(`${root || process.cwd()}`);
  // macOS commonly exposes /tmp through a symlink to /private/tmp.  Keep the
  // root and every descendant in the same canonical namespace before running
  // the fail-closed path checks; otherwise a harmless alias is mistaken for
  // an escape when an existing Agent Bus is inspected or updated.
  return existsSync(supplied) ? realpathSync(supplied) : supplied;
}

function graphBusPath(root) {
  return join(repositoryRoot(root), '.agent-bus');
}

export function taskGraphStorePath(root) {
  const repository = repositoryRoot(root);
  const bus = graphBusPath(repository);
  assertContained(repository, bus);
  return join(bus, TASK_GRAPH_STORE_DIRECTORY);
}

export function taskGraphPath(root, parentTaskId) {
  const store = taskGraphStorePath(root);
  let id;
  try {
    id = validateTaskId(parentTaskId);
  } catch {
    throw runtimeError('TASK_GRAPH_INVALID', `Invalid Task Graph parent Task identifier: ${parentTaskId || '(empty)'}.`, {
      recoverable: false,
      stage: 'graph-validation',
      taskId: parentTaskId || null,
    });
  }
  const path = join(store, `${id}.json`);
  assertContained(store, path);
  return path;
}

export function validateSubtaskId(id) {
  if (typeof id !== 'string' || !SUBTASK_ID_PATTERN.test(id)) {
    throw runtimeError('TASK_GRAPH_INVALID', `Invalid Task Graph subtask identifier: ${id || '(empty)'}.`, {
      recoverable: false,
      stage: 'graph-validation',
    });
  }
  const lower = id.toLowerCase();
  const base = lower.split('.')[0];
  if (RESERVED_DEVICE_NAMES.has(base) || RESERVED_DEVICE_NAMES.has(lower)) {
    throw runtimeError('TASK_GRAPH_INVALID', `Invalid Task Graph subtask identifier: ${id}.`, {
      recoverable: false,
      stage: 'graph-validation',
    });
  }
  return id;
}

export function taskGraphWorktreesRoot(root) {
  const repository = repositoryRoot(root);
  const bus = graphBusPath(repository);
  assertContained(repository, bus);
  assertSafePath(repository, bus);
  const worktrees = join(bus, TASK_GRAPH_WORKTREES_DIRECTORY);
  assertContained(repository, worktrees);
  // Check the complete path before any caller creates a directory.  In
  // particular, a symlinked .agent-bus/worktrees must never be followed by a
  // recursive mkdir into a path outside the repository.
  assertSafePath(repository, worktrees);
  return worktrees;
}

export function taskGraphWorktreePath(root, parentTaskId, subtaskId) {
  const repository = repositoryRoot(root);
  const worktrees = taskGraphWorktreesRoot(repository);
  let validParentId;
  try {
    validParentId = validateTaskId(parentTaskId);
  } catch {
    throw runtimeError('TASK_GRAPH_INVALID', `Invalid Task Graph parent Task identifier: ${parentTaskId || '(empty)'}.`, {
      recoverable: false,
      stage: 'graph-validation',
      taskId: parentTaskId || null,
    });
  }
  let validSubId;
  try {
    validSubId = validateSubtaskId(subtaskId);
  } catch {
    throw runtimeError('TASK_GRAPH_INVALID', `Invalid Task Graph subtask identifier: ${subtaskId || '(empty)'}.`, {
      recoverable: false,
      stage: 'graph-validation',
      taskId: parentTaskId || null,
      details: { parentTaskId, subtaskId },
    });
  }
  const parentWorktrees = join(worktrees, validParentId);
  assertContained(worktrees, parentWorktrees);
  assertSafePath(repository, parentWorktrees);
  const path = join(parentWorktrees, validSubId);
  assertContained(parentWorktrees, path);
  if (existsSync(path)) assertSafePath(repository, path);
  return path;
}

export function taskGraphBranchName(parentTaskId, subtaskId) {
  let validParentId;
  try {
    validParentId = validateTaskId(parentTaskId);
  } catch {
    throw runtimeError('TASK_GRAPH_INVALID', `Invalid Task Graph parent Task identifier: ${parentTaskId || '(empty)'}.`, {
      recoverable: false,
      stage: 'graph-validation',
      taskId: parentTaskId || null,
    });
  }
  const validSubId = validateSubtaskId(subtaskId);
  return `coordinate-agents/${validParentId}/${validSubId}`;
}

export function taskGraphBranchRef(parentTaskId, subtaskId) {
  return `refs/heads/${taskGraphBranchName(parentTaskId, subtaskId)}`;
}

function graphParentIdentifier(parentTaskId) {
  try {
    return validateTaskId(parentTaskId);
  } catch {
    throw runtimeError('TASK_GRAPH_INVALID', `Invalid Task Graph parent Task identifier: ${parentTaskId || '(empty)'}.`, {
      recoverable: false,
      stage: 'graph-validation',
      taskId: parentTaskId || null,
    });
  }
}

/**
 * Integration has a path component that cannot be a valid subtask id. This
 * keeps the aggregate review worktree separate even when a graph contains a
 * subtask whose title happens to mention integration.
 */
export function taskGraphIntegrationWorktreePath(root, parentTaskId) {
  const repository = repositoryRoot(root);
  const worktrees = taskGraphWorktreesRoot(repository);
  const validParentId = graphParentIdentifier(parentTaskId);
  const parentWorktrees = join(worktrees, validParentId);
  assertContained(worktrees, parentWorktrees);
  assertSafePath(repository, parentWorktrees);
  const path = join(parentWorktrees, TASK_GRAPH_INTEGRATION_DIRECTORY);
  assertContained(parentWorktrees, path);
  if (existsSync(path)) assertSafePath(repository, path);
  return path;
}

export function taskGraphIntegrationBranchName(parentTaskId) {
  return `coordinate-agents/${graphParentIdentifier(parentTaskId)}/${TASK_GRAPH_INTEGRATION_DIRECTORY}`;
}

export function taskGraphIntegrationBranchRef(parentTaskId) {
  return `refs/heads/${taskGraphIntegrationBranchName(parentTaskId)}`;
}

export function captureGraphBaseCommit(root) {
  const repository = repositoryRoot(root);
  const result = runGit(['rev-parse', '--verify', 'HEAD^{commit}'], repository);
  if (result.error || result.status !== 0) {
    const errorDetails = (result.stderr || result.stdout || result.error?.message || '').trim();
    throw runtimeError('TASK_STATE_CONFLICT', `Failed to determine repository HEAD commit: ${errorDetails}`, {
      recoverable: false,
      root: repository,
    });
  }
  const commit = result.stdout.trim();
  if (!COMMIT_SHA_PATTERN.test(commit)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Invalid repository HEAD commit: ${commit}`, {
      recoverable: false,
      root: repository,
    });
  }
  return commit;
}

function normalizeCommitSha(value, label = 'commit') {
  const commit = `${value || ''}`.trim();
  if (!COMMIT_SHA_PATTERN.test(commit)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Invalid ${label}: ${commit || '(empty)'}`, {
      recoverable: false,
    });
  }
  return commit.toLowerCase();
}

function gitWorktreeEntries(output) {
  const entries = [];
  let current = null;
  for (const line of `${output || ''}`.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { path: line.slice('worktree '.length), head: null, branch: null };
    } else if (current && line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim();
    } else if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim();
    }
  }
  if (current) entries.push(current);
  return entries;
}

function canonicalPathForComparison(value) {
  const normalized = resolve(`${value || ''}`);
  // Git may print a different but equivalent spelling than Node receives
  // (for example a Windows 8.3 short path versus its long form, or /var
  // versus /private/var on macOS).  Canonicalize existing paths before
  // comparing identities; callers still perform the separate lstat/safety
  // checks that refuse symlinks and path escapes.
  try { return realpathSync.native(normalized); } catch { return normalized; }
}

function pathMatches(left, right) {
  const normalizedLeft = canonicalPathForComparison(left);
  const normalizedRight = canonicalPathForComparison(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function readWorktreeSessionRecord(worktreePath, sessionId) {
  if (!sessionId || !existsSync(worktreePath)) return null;
  try {
    const worktree = repositoryRoot(worktreePath);
    const bus = graphBusPath(worktree);
    const sessions = join(bus, 'sessions');
    const path = join(sessions, `${sessionId}.json`);
    assertContained(sessions, path);
    safeInternalStat(sessions, path);
    const record = JSON.parse(readInternalFile(sessions, path));
    if (!plainObject(record) || record.id !== sessionId) return null;
    const state = EXECUTION_SESSION_STATES.includes(record.state) ? record.state : null;
    if (!state) return null;
    return {
      id: record.id,
      agent: record.agent || null,
      command: record.command || null,
      resolvedCommand: record.resolvedCommand || null,
      cwd: record.cwd || worktree,
      pid: Number.isInteger(record.pid) ? record.pid : null,
      hostPid: Number.isInteger(record.hostPid) ? record.hostPid : null,
      state,
      exitCode: record.exitCode ?? null,
      signal: record.signal || null,
      error: boundedText(record.error),
      createdAt: record.createdAt || null,
      lastActivityAt: record.lastActivityAt || null,
      taskId: record.taskId || null,
      subtaskId: record.subtaskId || null,
      hostAlive: processIsAlive(record.hostPid),
    };
  } catch {
    return null;
  }
}

export function verifyDurableImplementationCommit(repository, graph, subtask) {
  const candidate = `${subtask.implementationCommit || ''}`.trim();
  const base = `${graph.baseCommit || graph.parentTask?.baseCommit || subtask.baseCommit || ''}`.trim();
  if (!COMMIT_SHA_PATTERN.test(candidate) || !COMMIT_SHA_PATTERN.test(base)) return false;
  if (candidate.toLowerCase() === base.toLowerCase()) return false;
  // A durable completion may outlive its worktree, but any recorded branch or
  // ref must still be the exact Runtime identity for this subtask.  Never
  // promote evidence attached to a user branch as a graph completion.
  const expectedBranch = taskGraphBranchName(graph.parentTaskId, subtask.id);
  const expectedRef = taskGraphBranchRef(graph.parentTaskId, subtask.id);
  if (subtask.branch && subtask.branch !== expectedBranch) return false;
  if (subtask.ref && subtask.ref !== expectedRef) return false;
  const present = runGit(['rev-parse', '--verify', `${candidate}^{commit}`], repository);
  if (present.error || present.status !== 0 || present.stdout.trim().toLowerCase() !== candidate.toLowerCase()) return false;
  const ancestor = runGit(['merge-base', '--is-ancestor', base, candidate], repository);
  if (ancestor.error || ancestor.status !== 0) return false;
  const recordedRef = subtask.ref || (subtask.branch ? expectedRef : null);
  if (recordedRef) {
    const branch = runGit(['rev-parse', '--verify', `${recordedRef}^{commit}`], repository);
    if (branch.error || branch.status !== 0) return false;
    const reachable = runGit(['merge-base', '--is-ancestor', candidate, branch.stdout.trim()], repository);
    if (reachable.error || reachable.status !== 0) return false;
  }
  return true;
}

function inspectGraphWorktree(root, parentTaskId, subtaskId, {
  probeGit = false,
  recordedPath = null,
  recordedBranch = null,
  recordedRef = null,
  timeoutMs = null,
} = {}) {
  const repository = repositoryRoot(root);
  // Derive the canonical identity before touching the filesystem.  If the
  // worktree root is itself unsafe (for example a symlink), path construction
  // must still return a bounded fact for status/recovery rather than throwing
  // before the caller can record the refusal.
  const expectedBranch = taskGraphBranchName(parentTaskId, subtaskId);
  const expectedRef = taskGraphBranchRef(parentTaskId, subtaskId);
  let expectedPath;
  let pathError = null;
  try {
    expectedPath = taskGraphWorktreePath(repository, parentTaskId, subtaskId);
  } catch (error) {
    pathError = error;
    expectedPath = join(repository, '.agent-bus', TASK_GRAPH_WORKTREES_DIRECTORY, parentTaskId, subtaskId);
  }
  let matchesRecord = null;
  if (recordedPath || recordedBranch || recordedRef) {
    try {
      matchesRecord = (!recordedPath || pathMatches(recordedPath, expectedPath))
        && (!recordedBranch || recordedBranch === taskGraphBranchName(parentTaskId, subtaskId))
        && (!recordedRef || recordedRef === expectedRef);
    } catch {
      matchesRecord = false;
    }
  }
  const worktree = {
    path: expectedPath,
    branch: expectedBranch,
    ref: expectedRef,
    recordedPath: recordedPath || null,
    recordedBranch: recordedBranch || null,
    recordedRef: recordedRef || null,
    matchesRecord,
    exists: false,
    safe: false,
    registered: false,
    owned: false,
    ownershipKnown: Boolean(probeGit && !pathError),
    head: null,
    registeredBranch: null,
    error: pathError ? boundedText(pathError.message || pathError) : null,
  };
  if (pathError) return worktree;
  try {
    const metadata = lstatSync(expectedPath);
    if (metadata.isSymbolicLink()) throw new Error('symbolic link or junction');
    assertSafePath(repository, expectedPath);
    worktree.exists = metadata.isDirectory();
    worktree.safe = worktree.exists;
    if (!worktree.exists) worktree.error = 'path is not a directory';
  } catch (error) {
    if (error?.code !== 'ENOENT') worktree.error = boundedText(error.message || error);
  }
  if (probeGit) {
    const listed = runGit(['worktree', 'list', '--porcelain'], repository, { timeoutMs });
    if (listed.error || listed.status !== 0) {
      worktree.ownershipKnown = false;
      worktree.error = boundedText(listed.stderr || listed.stdout || listed.error?.message || 'unable to inspect Git worktrees');
    } else {
      const canonical = resolve(expectedPath);
      const entry = gitWorktreeEntries(listed.stdout).find(candidate => pathMatches(candidate.path || '', canonical));
      if (entry) {
        worktree.registered = true;
        worktree.head = entry.head || null;
        worktree.registeredBranch = entry.branch || null;
        // A missing path can still be an owned stale Git registration. It is
        // safe to attempt removal when the exact Runtime branch matches; an
        // existing symlink, file, or path escape remains unowned and is never
        // touched.
        const missingSafePath = !worktree.exists && !worktree.error;
        worktree.owned = matchesRecord !== false
          && entry.branch === expectedRef
          && (worktree.safe || missingSafePath);
        if (matchesRecord === false) {
          worktree.error = 'recorded worktree identity does not match the canonical Runtime path';
        } else if (entry.branch !== expectedRef) {
          worktree.error = `unexpected registered branch: ${entry.branch || '(detached)'}`;
        }
      } else {
        worktree.owned = false;
        if (worktree.safe && !worktree.error) worktree.error = 'worktree path is not registered with Git';
      }
    }
  } else {
    // A status-only read cannot prove Git registration. Keep ownership false
    // until the explicit Git probe used by recovery/cleanup verifies the
    // exact Runtime branch and path.
    worktree.owned = false;
  }
  return worktree;
}

function inspectGraphIntegrationWorktree(root, parentTaskId, {
  probeGit = false,
  recordedPath = null,
  recordedBranch = null,
  recordedRef = null,
  timeoutMs = null,
} = {}) {
  const repository = repositoryRoot(root);
  const expectedBranch = taskGraphIntegrationBranchName(parentTaskId);
  const expectedRef = taskGraphIntegrationBranchRef(parentTaskId);
  let expectedPath;
  let pathError = null;
  try {
    expectedPath = taskGraphIntegrationWorktreePath(repository, parentTaskId);
  } catch (error) {
    pathError = error;
    expectedPath = join(repository, '.agent-bus', TASK_GRAPH_WORKTREES_DIRECTORY, parentTaskId, TASK_GRAPH_INTEGRATION_DIRECTORY);
  }
  let matchesRecord = null;
  if (recordedPath || recordedBranch || recordedRef) {
    try {
      matchesRecord = (!recordedPath || pathMatches(recordedPath, expectedPath))
        && (!recordedBranch || recordedBranch === expectedBranch)
        && (!recordedRef || recordedRef === expectedRef);
    } catch {
      matchesRecord = false;
    }
  }
  const worktree = {
    path: expectedPath,
    branch: expectedBranch,
    ref: expectedRef,
    recordedPath: recordedPath || null,
    recordedBranch: recordedBranch || null,
    recordedRef: recordedRef || null,
    matchesRecord,
    exists: false,
    safe: false,
    registered: false,
    owned: false,
    ownershipKnown: Boolean(probeGit && !pathError),
    head: null,
    registeredBranch: null,
    error: pathError ? boundedText(pathError.message || pathError) : null,
  };
  if (pathError) return worktree;
  try {
    const metadata = lstatSync(expectedPath);
    if (metadata.isSymbolicLink()) throw new Error('symbolic link or junction');
    assertSafePath(repository, expectedPath);
    worktree.exists = metadata.isDirectory();
    worktree.safe = worktree.exists;
    if (!worktree.exists) worktree.error = 'path is not a directory';
  } catch (error) {
    if (error?.code !== 'ENOENT') worktree.error = boundedText(error.message || error);
  }
  if (!probeGit) return worktree;

  const listed = runGit(['worktree', 'list', '--porcelain'], repository, { timeoutMs });
  if (listed.error || listed.status !== 0) {
    worktree.ownershipKnown = false;
    worktree.error = boundedText(listed.stderr || listed.stdout || listed.error?.message || 'unable to inspect Git worktrees');
    return worktree;
  }
  const entry = gitWorktreeEntries(listed.stdout).find(candidate => pathMatches(candidate.path || '', expectedPath));
  if (!entry) {
    worktree.owned = false;
    if (worktree.safe && !worktree.error) worktree.error = 'worktree path is not registered with Git';
    return worktree;
  }
  worktree.registered = true;
  worktree.head = entry.head || null;
  worktree.registeredBranch = entry.branch || null;
  const missingSafePath = !worktree.exists && !worktree.error;
  worktree.owned = matchesRecord !== false
    && entry.branch === expectedRef
    && (worktree.safe || missingSafePath);
  if (matchesRecord === false) {
    worktree.error = 'recorded integration worktree identity does not match the canonical Runtime path';
  } else if (entry.branch !== expectedRef) {
    worktree.error = `unexpected registered branch: ${entry.branch || '(detached)'}`;
  }
  return worktree;
}

function graphWorktreeConflict(message, details = {}) {
  return runtimeError('TASK_STATE_CONFLICT', message, {
    recoverable: true,
    ...details,
  });
}

/**
 * Verify a completion commit against the isolated worktree rather than
 * trusting an arbitrary commit string supplied by an Agent message.  The
 * commit must exist in the worktree repository, descend from the captured
 * graph base, and be reachable from the worktree HEAD.
 */
export function verifyGraphImplementationCommit(root, baseCommit, reportedCommit) {
  const repository = repositoryRoot(root);
  const base = normalizeCommitSha(baseCommit, 'graph base commit');
  const candidate = `${reportedCommit || ''}`.trim();
  if (!/^[0-9a-f]{7,64}$/i.test(candidate)) {
    throw runtimeError('AGENT_RUNTIME_ERROR', `IMPLEMENTATION_DONE did not provide a valid implementation commit: ${candidate || '(missing)'}`, {
      recoverable: true,
      root: repository,
      stage: 'completion',
    });
  }
  const resolved = runGit(['rev-parse', '--verify', `${candidate}^{commit}`], repository);
  if (resolved.error || resolved.status !== 0) {
    throw runtimeError('AGENT_RUNTIME_ERROR', `Implementation commit is not present in the isolated worktree: ${candidate}`, {
      recoverable: true,
      root: repository,
      stage: 'completion',
      details: (resolved.stderr || resolved.stdout || resolved.error?.message || '').trim(),
    });
  }
  const commit = normalizeCommitSha(resolved.stdout, 'resolved implementation commit');
  if (commit === base) {
    throw runtimeError('AGENT_RUNTIME_ERROR', `IMPLEMENTATION_DONE must report a commit after the graph base commit: ${commit}`, {
      recoverable: true,
      root: repository,
      stage: 'completion',
    });
  }
  const head = captureGraphBaseCommit(repository);
  const ancestorChecks = [
    ['base commit', ['merge-base', '--is-ancestor', base, commit]],
    ['worktree HEAD', ['merge-base', '--is-ancestor', commit, head]],
  ];
  for (const [label, args] of ancestorChecks) {
    const result = runGit(args, repository);
    if (result.error || result.status !== 0) {
      throw runtimeError('AGENT_RUNTIME_ERROR', `Implementation commit is not reachable from the isolated ${label}: ${commit}`, {
        recoverable: true,
        root: repository,
        stage: 'completion',
        details: (result.stderr || result.stdout || result.error?.message || '').trim(),
      });
    }
  }
  return commit;
}

export function ensureGraphBus(root) {
  const repository = repositoryRoot(root);
  const bus = graphBusPath(repository);
  assertSafePath(repository, bus);
  mkdirSync(bus, { recursive: true });
  assertSafePath(repository, bus);
  const directories = [
    'specs', 'reviews', 'evidence', 'releases', 'dedupe', 'locks', 'logs', 'tmp', 'launch',
    'tasks', 'task-graphs', 'events', 'sessions', 'worktrees',
  ];
  for (const directory of directories) {
    const path = join(bus, directory);
    assertSafePath(repository, path);
    mkdirSync(path, { recursive: true });
    assertSafePath(repository, path);
  }
  const cfgFile = join(bus, 'config.json');
  if (existsSync(cfgFile)) assertSafePath(repository, cfgFile);
  if (!existsSync(cfgFile)) writeConfig(bus, DEFAULT_CONFIG);
  const config = readConfig(bus);
  for (const agent of config.agents) {
    for (const directory of [
      `inbox/${agent.id}/new`,
      `inbox/${agent.id}/processing`,
      `inbox/${agent.id}/processed`,
      `quarantine/${agent.id}`,
      `state/${agent.id}`,
    ]) {
      const path = join(bus, directory);
      assertSafePath(repository, path);
      mkdirSync(path, { recursive: true });
      assertSafePath(repository, path);
    }
  }
  return bus;
}

export function ensureSubtaskWorktreeBus(mainRepository, worktreePath) {
  const repo = repositoryRoot(mainRepository);
  const requestedWorktree = resolve(worktreePath);
  assertContained(repo, requestedWorktree);
  assertSafePath(repo, requestedWorktree);
  const worktree = repositoryRoot(requestedWorktree);
  assertContained(repo, worktree);
  assertSafePath(repo, worktree);
  const mainBus = graphBusPath(repo);
  assertSafePath(repo, mainBus);
  const mainConfigPath = join(mainBus, 'config.json');
  const worktreeBus = graphBusPath(worktree);
  assertSafePath(repo, worktreeBus);
  mkdirSync(worktreeBus, { recursive: true });
  if (existsSync(mainConfigPath)) {
    assertSafePath(repo, mainConfigPath);
    const configContent = readInternalFile(mainBus, mainConfigPath);
    const worktreeConfigPath = join(worktreeBus, 'config.json');
    const worktreeTmp = join(worktreeBus, 'tmp');
    if (existsSync(worktreeConfigPath)) assertSafePath(worktree, worktreeConfigPath);
    assertSafePath(repo, worktreeTmp);
    atomicWrite(worktreeConfigPath, configContent, worktreeTmp);
  }
  ensureGraphBus(worktree);
}

export function ensureSubtaskWorktree(root, parentTaskId, subtaskId, baseCommit) {
  const repository = repositoryRoot(root);
  const worktreePath = taskGraphWorktreePath(repository, parentTaskId, subtaskId);
  const branchName = taskGraphBranchName(parentTaskId, subtaskId);
  const branchRef = taskGraphBranchRef(parentTaskId, subtaskId);
  const expectedHead = normalizeCommitSha(baseCommit, 'graph base commit');
  const worktreesRoot = taskGraphWorktreesRoot(repository);
  const parentWorktrees = dirname(worktreePath);
  assertSafePath(repository, worktreesRoot);
  assertSafePath(repository, parentWorktrees);

  let targetMetadata = null;
  try { targetMetadata = lstatSync(worktreePath); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (targetMetadata?.isSymbolicLink()) {
    throw graphWorktreeConflict(`Refusing symbolic link or junction at Task Graph worktree path: ${worktreePath}`, {
      taskId: parentTaskId,
      subtaskId,
      root: repository,
    });
  }

  if (targetMetadata) {
    assertSafePath(repository, worktreePath);
    if (!targetMetadata.isDirectory()) {
      throw graphWorktreeConflict(`Task Graph worktree path is not a directory: ${worktreePath}`, {
        taskId: parentTaskId,
        subtaskId,
        root: repository,
      });
    }
    const listResult = runGit(['worktree', 'list', '--porcelain'], repository);
    if (listResult.error || listResult.status !== 0) {
      throw graphWorktreeConflict(`Unable to inspect existing Git worktrees for ${worktreePath}.`, {
        taskId: parentTaskId,
        subtaskId,
        root: repository,
        details: (listResult.stderr || listResult.stdout || listResult.error?.message || '').trim(),
      });
    }
    let canonicalWorktree = resolve(worktreePath);
    try { canonicalWorktree = realpathSync(worktreePath); } catch { /* assertSafePath already rejected links. */ }
    const registered = gitWorktreeEntries(listResult.stdout).find(entry => {
      if (!entry.path) return false;
      let listedPath = resolve(entry.path.trim());
      try { listedPath = realpathSync(listedPath); } catch { /* Compare the lexical path below. */ }
      return pathMatches(listedPath, canonicalWorktree);
    });
    if (!registered) {
      throw graphWorktreeConflict(`Refusing to replace an existing non-Runtime worktree path: ${worktreePath}`, {
        taskId: parentTaskId,
        subtaskId,
        root: repository,
      });
    }
    if (registered.branch !== branchRef) {
      throw graphWorktreeConflict(`Existing Task Graph worktree is attached to unexpected branch ${registered.branch || '(detached)'}.`, {
        taskId: parentTaskId,
        subtaskId,
        root: repository,
        details: { expectedBranch: branchRef, actualBranch: registered.branch || null },
      });
    }
    if (registered.head?.toLowerCase() !== expectedHead) {
      throw graphWorktreeConflict(`Existing Task Graph worktree does not point at the captured base commit: ${worktreePath}`, {
        taskId: parentTaskId,
        subtaskId,
        root: repository,
        details: { expectedHead, actualHead: registered.head || null },
      });
    }
    return { worktreePath, branch: branchName, ref: branchRef, reused: true };
  }

  // Inspect the Git worktree registry without pruning it.  Stale metadata is
  // an explicit cleanup/recovery concern and must not be destructively
  // rewritten as a side effect of dispatch.
  const listResult = runGit(['worktree', 'list', '--porcelain'], repository);
  if (listResult.error || listResult.status !== 0) {
    throw graphWorktreeConflict(`Unable to inspect Git worktrees before creating ${worktreePath}.`, {
      taskId: parentTaskId,
      subtaskId,
      root: repository,
      details: (listResult.stderr || listResult.stdout || listResult.error?.message || '').trim(),
    });
  }
  const registeredTarget = gitWorktreeEntries(listResult.stdout).find(entry => pathMatches(entry.path || '', worktreePath));
  if (registeredTarget) {
    throw graphWorktreeConflict(`Git still registers the Runtime worktree path and requires explicit cleanup: ${worktreePath}`, {
      taskId: parentTaskId,
      subtaskId,
      root: repository,
      details: { registeredHead: registeredTarget.head || null, registeredBranch: registeredTarget.branch || null },
    });
  }
  assertSafePath(repository, parentWorktrees);
  mkdirSync(parentWorktrees, { recursive: true });
  assertSafePath(repository, parentWorktrees);

  const branchCheck = runGit(['rev-parse', '--verify', branchRef], repository);
  if (branchCheck.error) {
    throw graphWorktreeConflict(`Unable to inspect Git branch ${branchRef}.`, {
      taskId: parentTaskId,
      subtaskId,
      root: repository,
      details: branchCheck.error.message || String(branchCheck.error),
    });
  }
  const branchExists = !branchCheck.error && branchCheck.status === 0;

  if (branchExists) {
    const branchHead = branchCheck.stdout.trim().toLowerCase();
    if (branchHead !== expectedHead) {
      throw graphWorktreeConflict(`Existing Task Graph branch ${branchRef} does not point at the captured base commit.`, {
        taskId: parentTaskId,
        subtaskId,
        root: repository,
        details: { expectedHead, actualHead: branchHead },
      });
    }
  }

  const addArgs = branchExists
    ? ['worktree', 'add', worktreePath, branchRef]
    : ['worktree', 'add', '-b', branchName, worktreePath, baseCommit];

  const addResult = runGit(addArgs, repository);

  if (addResult.error || addResult.status !== 0) {
    const errorDetails = (addResult.stderr || addResult.stdout || addResult.error?.message || '').trim();
    throw runtimeError('TASK_STATE_CONFLICT', `Failed to create Git worktree for subtask ${subtaskId}: ${errorDetails}`, {
      recoverable: true,
      taskId: parentTaskId,
      subtaskId,
      root: repository,
    });
  }

  assertSafePath(repository, worktreePath);
  const verifyResult = runGit(['worktree', 'list', '--porcelain'], repository);
  const created = !verifyResult.error && verifyResult.status === 0
    ? gitWorktreeEntries(verifyResult.stdout).find(entry => {
      let listedPath = resolve(entry.path || '');
      try { listedPath = realpathSync(listedPath); } catch { /* The add command succeeded; final checks below report it. */ }
      return pathMatches(listedPath, worktreePath);
    })
    : null;
  if (!created || created.branch !== branchRef || created.head?.toLowerCase() !== expectedHead) {
    throw graphWorktreeConflict(`Created Git worktree failed Runtime ownership verification: ${worktreePath}`, {
      taskId: parentTaskId,
      subtaskId,
      root: repository,
      details: { expectedBranch: branchRef, actualBranch: created?.branch || null, expectedHead, actualHead: created?.head || null },
    });
  }
  return { worktreePath, branch: branchName, ref: branchRef, reused: false };
}

/**
 * Create the Runtime-owned aggregate worktree from the captured graph base.
 * Unlike a subtask worktree, the integration worktree is deliberately not
 * addressable by a user-provided subtask identifier.
 */
export function ensureTaskGraphIntegrationWorktree(root, parentTaskId, baseCommit) {
  const repository = repositoryRoot(root);
  const worktreePath = taskGraphIntegrationWorktreePath(repository, parentTaskId);
  const branchName = taskGraphIntegrationBranchName(parentTaskId);
  const branchRef = taskGraphIntegrationBranchRef(parentTaskId);
  const expectedHead = normalizeCommitSha(baseCommit, 'graph base commit');
  const worktreesRoot = taskGraphWorktreesRoot(repository);
  const parentWorktrees = dirname(worktreePath);
  assertSafePath(repository, worktreesRoot);
  assertSafePath(repository, parentWorktrees);

  let targetMetadata = null;
  try { targetMetadata = lstatSync(worktreePath); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  if (targetMetadata?.isSymbolicLink()) {
    throw graphWorktreeConflict(`Refusing symbolic link or junction at Task Graph integration worktree path: ${worktreePath}`, {
      taskId: parentTaskId,
      root: repository,
      stage: 'integration-worktree',
    });
  }

  const listWorktrees = () => {
    const result = runGit(['worktree', 'list', '--porcelain'], repository);
    if (result.error || result.status !== 0) {
      throw graphWorktreeConflict(`Unable to inspect existing Git worktrees for ${worktreePath}.`, {
        taskId: parentTaskId,
        root: repository,
        stage: 'integration-worktree',
        details: (result.stderr || result.stdout || result.error?.message || '').trim(),
      });
    }
    return gitWorktreeEntries(result.stdout);
  };

  if (targetMetadata) {
    assertSafePath(repository, worktreePath);
    if (!targetMetadata.isDirectory()) {
      throw graphWorktreeConflict(`Task Graph integration worktree path is not a directory: ${worktreePath}`, {
        taskId: parentTaskId,
        root: repository,
        stage: 'integration-worktree',
      });
    }
    const registered = listWorktrees().find(entry => pathMatches(entry.path || '', worktreePath));
    if (!registered) {
      throw graphWorktreeConflict(`Refusing to replace an existing non-Runtime integration worktree path: ${worktreePath}`, {
        taskId: parentTaskId,
        root: repository,
        stage: 'integration-worktree',
      });
    }
    if (registered.branch !== branchRef) {
      throw graphWorktreeConflict(`Existing Task Graph integration worktree is attached to unexpected branch ${registered.branch || '(detached)'}.`, {
        taskId: parentTaskId,
        root: repository,
        stage: 'integration-worktree',
        details: { expectedBranch: branchRef, actualBranch: registered.branch || null },
      });
    }
    if (registered.head?.toLowerCase() !== expectedHead) {
      throw graphWorktreeConflict(`Existing Task Graph integration worktree does not point at the captured base commit: ${worktreePath}`, {
        taskId: parentTaskId,
        root: repository,
        stage: 'integration-worktree',
        details: { expectedHead, actualHead: registered.head || null },
      });
    }
    return { worktreePath, branch: branchName, ref: branchRef, reused: true };
  }

  const registeredTarget = listWorktrees().find(entry => pathMatches(entry.path || '', worktreePath));
  if (registeredTarget) {
    throw graphWorktreeConflict(`Git still registers the Runtime integration worktree path and requires explicit cleanup: ${worktreePath}`, {
      taskId: parentTaskId,
      root: repository,
      stage: 'integration-worktree',
      details: { registeredHead: registeredTarget.head || null, registeredBranch: registeredTarget.branch || null },
    });
  }
  assertSafePath(repository, parentWorktrees);
  mkdirSync(parentWorktrees, { recursive: true });
  assertSafePath(repository, parentWorktrees);

  const branchCheck = runGit(['rev-parse', '--verify', branchRef], repository);
  if (branchCheck.error) {
    throw graphWorktreeConflict(`Unable to inspect Task Graph integration branch ${branchRef}.`, {
      taskId: parentTaskId,
      root: repository,
      stage: 'integration-worktree',
      details: branchCheck.error.message || String(branchCheck.error),
    });
  }
  const branchExists = branchCheck.status === 0;
  if (branchExists && branchCheck.stdout.trim().toLowerCase() !== expectedHead) {
    throw graphWorktreeConflict(`Existing Task Graph integration branch ${branchRef} does not point at the captured base commit.`, {
      taskId: parentTaskId,
      root: repository,
      stage: 'integration-worktree',
      details: { expectedHead, actualHead: branchCheck.stdout.trim().toLowerCase() },
    });
  }

  const addArgs = branchExists
    ? ['worktree', 'add', worktreePath, branchRef]
    : ['worktree', 'add', '-b', branchName, worktreePath, baseCommit];
  const added = runGit(addArgs, repository);
  if (added.error || added.status !== 0) {
    const errorDetails = (added.stderr || added.stdout || added.error?.message || '').trim();
    throw runtimeError('TASK_STATE_CONFLICT', `Failed to create Git integration worktree: ${errorDetails}`, {
      recoverable: true,
      taskId: parentTaskId,
      root: repository,
      stage: 'integration-worktree',
    });
  }

  assertSafePath(repository, worktreePath);
  const createdResult = runGit(['worktree', 'list', '--porcelain'], repository);
  const created = !createdResult.error && createdResult.status === 0
    ? gitWorktreeEntries(createdResult.stdout).find(entry => pathMatches(entry.path || '', worktreePath))
    : null;
  if (!created || created.branch !== branchRef || created.head?.toLowerCase() !== expectedHead) {
    throw graphWorktreeConflict(`Created Git integration worktree failed Runtime ownership verification: ${worktreePath}`, {
      taskId: parentTaskId,
      root: repository,
      stage: 'integration-worktree',
      details: { expectedBranch: branchRef, actualBranch: created?.branch || null, expectedHead, actualHead: created?.head || null },
    });
  }
  return { worktreePath, branch: branchName, ref: branchRef, reused: false };
}

// Descriptive aliases keep the aggregate worktree helpers discoverable to
// transports and downstream Runtime consumers.
export const ensureGraphIntegrationWorktree = ensureTaskGraphIntegrationWorktree;
export const taskGraphIntegrationPath = taskGraphIntegrationWorktreePath;

function ensureGraphStore(root, { create = false } = {}) {
  const repository = repositoryRoot(root);
  const bus = graphBusPath(repository);
  if (!existsSync(bus)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Agent Bus is not initialized: ${bus}`, { recoverable: true, root: repository });
  }
  assertSafePath(repository, bus);
  const store = taskGraphStorePath(repository);
  const tmp = join(bus, 'tmp');
  if (create) {
    mkdirSync(store, { recursive: true });
    assertSafePath(repository, store);
    mkdirSync(tmp, { recursive: true });
    assertSafePath(repository, tmp);
  } else {
    if (existsSync(store)) assertSafePath(repository, store);
    if (existsSync(tmp)) assertSafePath(repository, tmp);
  }
  return { repository, bus, store, tmp };
}

function boundedText(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const text = `${value}`.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  if (!text) return fallback;
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= TASK_GRAPH_MAX_REASON_BYTES) return text;
  return Buffer.from(text, 'utf8').subarray(0, TASK_GRAPH_MAX_REASON_BYTES).toString('utf8').replace(/[\uFFFD]+$/g, '');
}

function boundedEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, TASK_GRAPH_MAX_EVIDENCE_ITEMS).map(item => sanitizeRuntimeEventData(item));
}

function compareIds(left, right) {
  return left < right ? -1 : (left > right ? 1 : 0);
}

function dependencyStates(subtask, byId) {
  return subtask.dependsOn.map(id => ({ id, state: byId.get(id)?.state || 'MISSING' }));
}

function derivedWaitingReason(dependencies) {
  const unresolved = dependencies.filter(item => item.state !== 'SUCCEEDED').map(item => item.id).sort(compareIds);
  return unresolved.length > 0 ? `Waiting for dependencies: ${unresolved.join(', ')}.` : null;
}

function derivedBlockedReason(dependencies) {
  const blocked = dependencies
    .filter(item => FAILED_SUBTASK_STATES.has(item.state))
    .sort((left, right) => compareIds(left.id, right.id))
    .map(item => `${item.id} (${item.state})`);
  return blocked.length > 0 ? `Blocked by dependencies: ${blocked.join(', ')}.` : null;
}

function deriveFrontierState(subtask, byId) {
  const dependencies = dependencyStates(subtask, byId);
  if (dependencies.some(item => FAILED_SUBTASK_STATES.has(item.state))) {
    return { state: 'BLOCKED', reason: derivedBlockedReason(dependencies) };
  }
  if (dependencies.length === 0) return { state: 'READY', reason: 'Ready: no dependencies.' };
  if (dependencies.every(item => item.state === 'SUCCEEDED')) return { state: 'READY', reason: 'Ready: all dependencies succeeded.' };
  return { state: 'WAITING', reason: derivedWaitingReason(dependencies) };
}

function reconcileSubtasks(subtasks, { recoverBlockedIds = null } = {}) {
  const recoverBlocked = recoverBlockedIds instanceof Set
    ? recoverBlockedIds
    : new Set(Array.isArray(recoverBlockedIds) ? recoverBlockedIds : []);
  const result = subtasks.map(subtask => ({ ...subtask }));
  const byId = new Map(result.map(subtask => [subtask.id, subtask]));
  // Reconcile in dependency order until stable. A recovered prerequisite can
  // unblock a direct child, which must then unblock a grandchild in the same
  // locked transition; a single map pass would leave the deeper descendant
  // incorrectly BLOCKED until a second unrelated operation.
  for (let pass = 0; pass <= result.length; pass += 1) {
    let changed = false;
    for (let index = 0; index < result.length; index += 1) {
      const subtask = result[index];
      if (!NON_EXECUTING_SUBTASK_STATES.has(subtask.state)
        && !(subtask.state === 'BLOCKED' && recoverBlocked.has(subtask.id))) continue;
      const derived = deriveFrontierState(subtask, byId);
      if (subtask.state === derived.state && subtask.status === derived.state && subtask.reason === derived.reason) continue;
      const updated = {
        ...subtask,
        state: derived.state,
        status: derived.state,
        reason: derived.reason,
      };
      result[index] = updated;
      byId.set(updated.id, updated);
      changed = true;
    }
    if (!changed) break;
  }
  return result.sort((left, right) => compareIds(left.id, right.id));
}

function frontierFor(subtasks, maxConcurrency) {
  const groups = {
    ready: [],
    waiting: [],
    blocked: [],
    running: [],
    succeeded: [],
    failed: [],
    stopped: [],
  };
  const reasons = {};
  for (const subtask of [...subtasks].sort((left, right) => compareIds(left.id, right.id))) {
    const state = `${subtask.state || subtask.status || ''}`.toLowerCase();
    const key = state === 'pending' ? 'waiting' : state === 'failed' ? 'failed' : state;
    if (groups[key]) groups[key].push(subtask.id);
    reasons[subtask.id] = boundedText(subtask.reason);
  }
  const running = groups.running.length;
  const eligible = groups.ready.slice(0, Math.max(0, maxConcurrency - running));
  const capacityLimited = groups.ready.slice(eligible.length);
  return {
    ready: groups.ready,
    waiting: groups.waiting,
    blocked: groups.blocked,
    running: groups.running,
    succeeded: groups.succeeded,
    failed: groups.failed,
    stopped: groups.stopped,
    eligible,
    capacityLimited,
    maxConcurrency,
    runningCount: running,
    availableSlots: Math.max(0, maxConcurrency - running),
    reasons,
  };
}

function parentStateFor(previous, subtasks) {
  const states = subtasks.map(subtask => subtask.state);
  if (states.some(state => state === 'FAILED' || state === 'BLOCKED')) return 'ERROR';
  if (states.some(state => state === 'STOPPED')) return 'STOPPED';
  if (states.length > 0 && states.every(state => state === 'SUCCEEDED')) return 'REVIEWING';
  if (states.some(state => state === 'RUNNING')) return 'RUNNING';
  // A newly persisted graph remains CREATED even though its deterministic
  // frontier contains READY and WAITING subtasks.  Once a graph has moved out
  // of CREATED, keep its explicit lifecycle state until execution changes it.
  if (previous === 'CREATED' || previous === 'REVIEWING') return previous;
  if (states.some(state => ['READY', 'WAITING', 'BLOCKED'].includes(state))) return 'RUNNING';
  return previous || 'CREATED';
}

function graphRecordFromValidated(validated, intentMap = null) {
  const timestamp = now();
  const subtasks = validated.subtasks.map(subtask => ({
    id: subtask.id,
    subtaskId: subtask.id,
    parentTaskId: validated.parentTask.id,
    ...(subtask.title === undefined ? {} : { title: subtask.title }),
    implementer: subtask.implementer,
    spec: subtask.spec,
    dependsOn: [...subtask.dependsOn].sort(compareIds),
    state: 'PENDING',
    status: 'PENDING',
    reason: null,
    evidence: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  const reconciled = reconcileSubtasks(subtasks);
  const parentTask = {
    ...validated.parentTask,
    state: 'CREATED',
    status: 'CREATED',
    reason: null,
    evidence: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return {
    schemaVersion: TASK_GRAPH_SCHEMA_VERSION,
    kind: 'task-graph',
    id: validated.parentTask.id,
    parentTaskId: validated.parentTask.id,
    parentTask,
    state: 'CREATED',
    status: 'CREATED',
    reason: null,
    evidence: [],
    maxConcurrency: validated.maxConcurrency,
    ...(intentMap ? { intentMap } : {}),
    createdAt: timestamp,
    updatedAt: timestamp,
    subtasks: reconciled,
    frontier: frontierFor(reconciled, validated.maxConcurrency),
    integration: null,
    review: null,
    reviewHistory: [],
  };
}

function validateStoredIntegration(integration, parentTaskId) {
  if (!plainObject(integration)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} has a malformed integration record.`, { recoverable: false, taskId: parentTaskId });
  }
  if (integration.schemaVersion !== TASK_GRAPH_SCHEMA_VERSION || integration.kind !== 'task-graph-integration') {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} has an unsupported integration schema.`, { recoverable: false, taskId: parentTaskId });
  }
  if (integration.parentTaskId !== parentTaskId || !INTEGRATION_STATE_SET.has(integration.state) || integration.status !== integration.state) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} has an invalid integration state.`, { recoverable: false, taskId: parentTaskId });
  }
  for (const [label, value] of [
    ['integration base commit', integration.baseCommit],
    ['aggregate commit', integration.aggregateCommit],
    ['worktree head', integration.worktreeHead],
  ]) {
    if (value !== undefined && value !== null && !COMMIT_SHA_PATTERN.test(`${value}`)) {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} has an invalid ${label}.`, { recoverable: false, taskId: parentTaskId });
    }
  }
  for (const [label, value] of [
    ['worktreePath', integration.worktreePath],
    ['branch', integration.branch],
    ['ref', integration.ref],
    ['sourceFingerprint', integration.sourceFingerprint],
  ]) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} has an invalid integration ${label}.`, { recoverable: false, taskId: parentTaskId });
    }
  }
  for (const [label, value] of [
    ['appliedRefs', integration.appliedRefs],
    ['sourceRefs', integration.sourceRefs],
    ['appliedCommits', integration.appliedCommits],
    ['appliedSubtasks', integration.appliedSubtasks],
  ]) {
    if (value !== undefined && value !== null && (!Array.isArray(value) || value.length > TASK_GRAPH_MAX_SUBTASKS)) {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} has invalid integration ${label}.`, { recoverable: false, taskId: parentTaskId });
    }
  }
  if (integration.evidence !== undefined && integration.evidence !== null
    && (!Array.isArray(integration.evidence) || integration.evidence.length > TASK_GRAPH_MAX_EVIDENCE_ITEMS)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} has invalid integration evidence.`, { recoverable: false, taskId: parentTaskId });
  }
  if (integration.conflict !== undefined && integration.conflict !== null && !plainObject(integration.conflict)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} has an invalid integration conflict record.`, { recoverable: false, taskId: parentTaskId });
  }
  if (integration.cleanup !== undefined && integration.cleanup !== null && !plainObject(integration.cleanup)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} has an invalid integration cleanup record.`, { recoverable: false, taskId: parentTaskId });
  }
  return integration;
}

function validateStoredReview(review, parentTaskId) {
  if (review === undefined || review === null) return;
  if (!plainObject(review)
    || review.schemaVersion !== TASK_GRAPH_SCHEMA_VERSION
    || review.kind !== 'task-graph-review'
    || !['REVIEW_APPROVED', 'CHANGES_REQUESTED'].includes(review.decision)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} has an invalid review record.`, { recoverable: false, taskId: parentTaskId });
  }
  if (typeof review.reviewer !== 'string' || !review.reviewer) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} has an invalid review reviewer.`, { recoverable: false, taskId: parentTaskId });
  }
  if (review.feedback !== undefined && typeof review.feedback !== 'string') {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} has invalid review feedback.`, { recoverable: false, taskId: parentTaskId });
  }
  if (review.integrationCommit !== undefined && review.integrationCommit !== null
    && !COMMIT_SHA_PATTERN.test(`${review.integrationCommit}`)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} has an invalid review integration commit.`, { recoverable: false, taskId: parentTaskId });
  }
  if (review.evidence !== undefined && review.evidence !== null
    && (!Array.isArray(review.evidence) || review.evidence.length > TASK_GRAPH_MAX_EVIDENCE_ITEMS)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} has invalid review evidence.`, { recoverable: false, taskId: parentTaskId });
  }
}

function validateStoredGraph(record, parentTaskId = null) {
  if (!plainObject(record)) {
    throw runtimeError('TASK_STATE_CONFLICT', 'Persisted Task Graph record must be a JSON object.', { recoverable: false, taskId: parentTaskId });
  }
  if (record.schemaVersion !== TASK_GRAPH_SCHEMA_VERSION || record.kind !== 'task-graph') {
    throw runtimeError('TASK_STATE_CONFLICT', 'Persisted Task Graph record has an unsupported schema.', { recoverable: false, taskId: parentTaskId });
  }
  let id;
  try { id = validateTaskId(record.parentTaskId || record.id); } catch {
    throw runtimeError('TASK_STATE_CONFLICT', 'Persisted Task Graph record has an invalid parent Task identifier.', { recoverable: false, taskId: parentTaskId });
  }
  if (parentTaskId && id !== parentTaskId) {
    throw runtimeError('TASK_STATE_CONFLICT', `Persisted Task Graph identifier mismatch: ${id}.`, { recoverable: false, taskId: parentTaskId });
  }
  if (!GRAPH_STATE_SET.has(record.state) || record.status !== record.state) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has an invalid state.`, { recoverable: false, taskId: id });
  }
  if (!Number.isInteger(record.maxConcurrency) || record.maxConcurrency < 1 || record.maxConcurrency > TASK_GRAPH_MAX_CONCURRENCY) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has an invalid maxConcurrency.`, { recoverable: false, taskId: id });
  }
  for (const [label, value] of [
    ['graph base commit', record.baseCommit],
    ['parent base commit', record.parentTask?.baseCommit],
  ]) {
    if (value !== undefined && value !== null && !COMMIT_SHA_PATTERN.test(`${value}`)) {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has an invalid ${label}.`, { recoverable: false, taskId: id });
    }
  }
  if (record.baseCommit && record.parentTask?.baseCommit && `${record.baseCommit}`.toLowerCase() !== `${record.parentTask.baseCommit}`.toLowerCase()) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has conflicting base commit facts.`, { recoverable: false, taskId: id });
  }
  if (record.integration !== undefined && record.integration !== null) validateStoredIntegration(record.integration, id);
  validateStoredReview(record.review, id);
  if (record.reviewHistory !== undefined && (!Array.isArray(record.reviewHistory) || record.reviewHistory.length > TASK_GRAPH_MAX_EVIDENCE_ITEMS)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has invalid review history.`, { recoverable: false, taskId: id });
  }
  for (const review of record.reviewHistory || []) validateStoredReview(review, id);
  if (!plainObject(record.parentTask) || record.parentTask.id !== id) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has an invalid parent Task record.`, { recoverable: false, taskId: id });
  }
  if (!Array.isArray(record.subtasks) || record.subtasks.length === 0 || record.subtasks.length > TASK_GRAPH_MAX_SUBTASKS) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has no subtask records.`, { recoverable: false, taskId: id });
  }
  const ids = new Set();
  for (const subtask of record.subtasks) {
    if (!plainObject(subtask) || typeof subtask.id !== 'string' || ids.has(subtask.id)) {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has duplicate or malformed subtask records.`, { recoverable: false, taskId: id });
    }
    try {
      validateSubtaskId(subtask.id);
    } catch {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has an invalid subtask identifier: ${subtask.id}.`, { recoverable: false, taskId: id });
    }
    ids.add(subtask.id);
    if (subtask.subtaskId !== subtask.id || subtask.parentTaskId !== id || !SUBTASK_STATE_SET.has(subtask.state) || subtask.status !== subtask.state) {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has an invalid subtask record: ${subtask.id}.`, { recoverable: false, taskId: id });
    }
    if (subtask.baseCommit !== undefined && subtask.baseCommit !== null && !COMMIT_SHA_PATTERN.test(`${subtask.baseCommit}`)) {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has an invalid base commit for ${subtask.id}.`, { recoverable: false, taskId: id });
    }
    if (!Array.isArray(subtask.dependsOn) || new Set(subtask.dependsOn).size !== subtask.dependsOn.length || subtask.dependsOn.some(dependency => !ids.has(dependency) && dependency !== subtask.id)) {
      // Dependency existence is checked in a second pass because records are
      // allowed to be persisted in any deterministic order.
      if (!Array.isArray(subtask.dependsOn) || new Set(subtask.dependsOn).size !== subtask.dependsOn.length) {
        throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has invalid dependencies for ${subtask.id}.`, { recoverable: false, taskId: id });
      }
    }
  }
  for (const subtask of record.subtasks) {
    if (subtask.dependsOn.some(dependency => !ids.has(dependency) || dependency === subtask.id)) {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has an invalid dependency edge for ${subtask.id}.`, { recoverable: false, taskId: id });
    }
  }
  if (record.intentMap !== undefined) {
    let normalized;
    try {
      normalized = validateIntentMapV1(record.intentMap, { parentTaskId: id, subtasks: record.subtasks });
    } catch (error) {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has an invalid Intent Map: ${error.message || error}`, {
        recoverable: false,
        taskId: id,
      });
    }
    if (JSON.stringify(normalized) !== JSON.stringify(record.intentMap)) {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has a non-normalized or contradictory Intent Map.`, {
        recoverable: false,
        taskId: id,
      });
    }
  }
  return record;
}

function readStoredGraph(root, parentTaskId) {
  const path = taskGraphPath(root, parentTaskId);
  const store = taskGraphStorePath(root);
  if (!existsSync(path)) {
    throw runtimeError('TASK_NOT_FOUND', `Task Graph not found: ${parentTaskId}`, { recoverable: false, taskId: parentTaskId, root: resolve(root) });
  }
  try {
    safeInternalStat(store, path);
    return validateStoredGraph(JSON.parse(readInternalFile(store, path)), parentTaskId);
  } catch (error) {
    if (error?.code === 'TASK_NOT_FOUND' || error?.code === 'TASK_STATE_CONFLICT') throw error;
    throw runtimeError('TASK_STATE_CONFLICT', `Failed to load Task Graph ${parentTaskId}: ${error.message || error}`, { recoverable: false, taskId: parentTaskId });
  }
}

export function readTaskGraph(root, parentTaskId) {
  ensureGraphStore(root);
  return readStoredGraph(root, parentTaskId);
}

/**
 * Return facts that make a graph interruption/recovery decision explicit.
 * This function never treats a filename, free-form message, or product file
 * as proof of completion; only the durable subtask state, implementation
 * commit, evidence, Session record, and Runtime-owned worktree facts are
 * reported.
 */
export function inspectTaskGraphRecovery(root, record, { probeGit = false } = {}) {
  const graph = validateStoredGraph(record);
  const repository = repositoryRoot(root);
  return graph.subtasks
    .slice()
    .sort((left, right) => compareIds(left.id, right.id))
    .map(subtask => {
      const worktree = inspectGraphWorktree(repository, graph.parentTaskId, subtask.id, {
        probeGit,
        recordedPath: subtask.worktreePath || null,
        recordedBranch: subtask.branch || null,
        recordedRef: subtask.ref || null,
      });
      const session = worktree.safe ? readWorktreeSessionRecord(worktree.path, subtask.sessionId) : null;
      let sessionOwned = false;
      if (session) {
        try {
          sessionOwned = typeof session.cwd === 'string'
            && pathMatches(session.cwd, worktree.path)
            && session.taskId === graph.parentTaskId
            && session.subtaskId === subtask.id
            && session.agent === subtask.implementer;
        } catch {
          sessionOwned = false;
        }
      }
      const sessionHealthy = sessionOwned
        && ['starting', 'running', 'idle', 'busy'].includes(session.state)
        && Number.isInteger(session.hostPid)
        && session.hostPid > 0
        && session.hostAlive;
      const durableCompletionEvidence = subtask.state === 'SUCCEEDED'
        && typeof subtask.implementationCommit === 'string'
        && COMMIT_SHA_PATTERN.test(subtask.implementationCommit.trim())
        && Array.isArray(subtask.evidence)
        && subtask.evidence.some(item => item?.type === 'IMPLEMENTATION_DONE'
          && typeof item.relatedCommit === 'string'
          && item.relatedCommit.toLowerCase() === subtask.implementationCommit.toLowerCase());
      const commitVerified = durableCompletionEvidence && probeGit
        ? verifyDurableImplementationCommit(repository, graph, subtask)
        : (durableCompletionEvidence ? null : false);
      const hasCompletionEvidence = durableCompletionEvidence && (probeGit ? commitVerified : true);
      let classification = 'pending';
      let action = null;
      let recoverable = false;
      if (subtask.state === 'SUCCEEDED') {
        classification = hasCompletionEvidence ? 'completed' : 'completed-unverified';
        recoverable = !hasCompletionEvidence;
        action = recoverable ? 'inspect-evidence' : null;
      } else if (subtask.state === 'RUNNING') {
        if (sessionHealthy && worktree.safe && worktree.matchesRecord !== false && (probeGit ? worktree.owned : true)) {
          classification = 'running';
          action = 'resume-attach';
          recoverable = true;
        } else {
          classification = 'interrupted';
          action = 'resume-replace-session';
          recoverable = true;
        }
      } else if (subtask.state === 'FAILED') {
        classification = 'failed';
        action = 'resume-after-review';
        recoverable = true;
      } else if (subtask.state === 'STOPPED') {
        classification = 'stopped';
        action = 'resume-after-review';
        recoverable = true;
      } else if (subtask.state === 'BLOCKED') {
        classification = 'blocked';
        action = 'recover-dependency-first';
      } else if (subtask.state === 'READY' || subtask.state === 'WAITING' || subtask.state === 'PENDING') {
        classification = subtask.state.toLowerCase();
      }
      return {
        root: repository,
        parentTaskId: graph.parentTaskId,
        subtaskId: subtask.id,
        implementer: subtask.implementer,
        state: subtask.state,
        classification,
        recoverable,
        action,
        reason: boundedText(subtask.reason),
        lastError: subtask.lastError ? sanitizeRuntimeEventData(subtask.lastError) : null,
        implementationCommit: subtask.implementationCommit || null,
        completionEvidence: hasCompletionEvidence,
        commitVerified,
        worktree,
        session: sessionOwned ? session : (session ? { ...session, owned: false } : null),
        sessionOwned,
        sessionHealthy,
      };
    });
}

/**
 * Remove exactly one Runtime-owned graph worktree. Git branch/ref objects are
 * intentionally retained so successful commits and remote state are never
 * destroyed by cleanup. Missing resources are an idempotent success; an
 * ownership mismatch or failed Git removal is a durable cleanup failure.
 */
export function cleanupTaskGraphWorktree(root, parentTaskId, subtaskId, {
  recordedPath = null,
  recordedBranch = null,
  recordedRef = null,
  timeoutMs = 2_000,
} = {}) {
  const repository = repositoryRoot(root);
  const boundedTimeoutMs = Math.max(100, Math.min(10_000, Number.isFinite(timeoutMs) ? Math.floor(timeoutMs) : 2_000));
  const resource = inspectGraphWorktree(repository, parentTaskId, subtaskId, {
    probeGit: true,
    recordedPath,
    recordedBranch,
    recordedRef,
    timeoutMs: boundedTimeoutMs,
  });
  const recorded = resource.worktree || resource;
  const expectedPath = recorded.path || join(repository, '.agent-bus', TASK_GRAPH_WORKTREES_DIRECTORY, parentTaskId, subtaskId);
  // Even when the canonical path is already absent, a persisted path/branch
  // mismatch is an ownership failure rather than an idempotent success. Do
  // not let a stale or user-supplied record silently pass cleanup.
  if (recorded.matchesRecord === false) {
    const error = runtimeError('TASK_STATE_CONFLICT', `Refusing to remove non-Runtime Task Graph worktree: ${expectedPath}`, {
      recoverable: true,
      taskId: parentTaskId,
      subtaskId,
      root: repository,
      stage: 'cleanup',
      details: {
        path: expectedPath,
        registered: recorded.registered,
        branch: recorded.registeredBranch || null,
        matchesRecord: recorded.matchesRecord,
      },
    });
    return { status: 'FAILED', idempotent: false, worktree: recorded, error: serializeCleanupError(error) };
  }
  if (!recorded.exists && !recorded.registered && !recorded.error) {
    return { status: 'CLEANED', idempotent: true, worktree: recorded };
  }
  if (!recorded.owned) {
    const error = runtimeError('TASK_STATE_CONFLICT', `Refusing to remove non-Runtime Task Graph worktree: ${expectedPath}`, {
      recoverable: true,
      taskId: parentTaskId,
      subtaskId,
      root: repository,
      stage: 'cleanup',
      details: {
        path: expectedPath,
        registered: recorded.registered,
        branch: recorded.registeredBranch || null,
        matchesRecord: recorded.matchesRecord,
      },
    });
    return { status: 'FAILED', idempotent: false, worktree: recorded, error: serializeCleanupError(error) };
  }
  const removed = runGit(['worktree', 'remove', '--force', expectedPath], repository, { timeoutMs: boundedTimeoutMs });
  if (removed.error || removed.status !== 0) {
    const error = runtimeError('TASK_STATE_CONFLICT', `Failed to remove Runtime-owned Task Graph worktree: ${expectedPath}`, {
      recoverable: true,
      taskId: parentTaskId,
      subtaskId,
      root: repository,
      stage: 'cleanup',
      details: (removed.stderr || removed.stdout || removed.error?.message || '').trim(),
    });
    return { status: 'FAILED', idempotent: false, worktree: recorded, error: serializeCleanupError(error) };
  }
  const after = inspectGraphWorktree(repository, parentTaskId, subtaskId, {
    probeGit: true,
    recordedPath,
    recordedBranch,
    recordedRef,
    timeoutMs: boundedTimeoutMs,
  });
  if (after.exists || after.registered) {
    const error = runtimeError('TASK_STATE_CONFLICT', `Runtime-owned Task Graph worktree cleanup remains incomplete: ${expectedPath}`, {
      recoverable: true,
      taskId: parentTaskId,
      subtaskId,
      root: repository,
      stage: 'cleanup',
      details: { path: expectedPath, exists: after.exists, registered: after.registered },
    });
    return { status: 'FAILED', idempotent: false, worktree: after, error: serializeCleanupError(error) };
  }
  return { status: 'CLEANED', idempotent: false, worktree: after };
}

/** Remove only the exact Runtime-owned aggregate integration worktree. */
export function cleanupTaskGraphIntegrationWorktree(root, parentTaskId, {
  recordedPath = null,
  recordedBranch = null,
  recordedRef = null,
  timeoutMs = 2_000,
} = {}) {
  const repository = repositoryRoot(root);
  const boundedTimeoutMs = Math.max(100, Math.min(10_000, Number.isFinite(timeoutMs) ? Math.floor(timeoutMs) : 2_000));
  const recorded = inspectGraphIntegrationWorktree(repository, parentTaskId, {
    probeGit: true,
    recordedPath,
    recordedBranch,
    recordedRef,
    timeoutMs: boundedTimeoutMs,
  });
  const expectedPath = recorded.path || join(repository, '.agent-bus', TASK_GRAPH_WORKTREES_DIRECTORY, parentTaskId, TASK_GRAPH_INTEGRATION_DIRECTORY);
  const failure = message => {
    const error = runtimeError('TASK_STATE_CONFLICT', message, {
      recoverable: true,
      taskId: parentTaskId,
      root: repository,
      stage: 'integration-cleanup',
      details: {
        path: expectedPath,
        registered: recorded.registered,
        branch: recorded.registeredBranch || null,
        matchesRecord: recorded.matchesRecord,
      },
    });
    return { status: 'FAILED', idempotent: false, worktree: recorded, error: serializeCleanupError(error) };
  };
  if (recorded.matchesRecord === false) return failure(`Refusing to remove non-Runtime Task Graph integration worktree: ${expectedPath}`);
  if (!recorded.exists && !recorded.registered && !recorded.error) {
    return { status: 'CLEANED', idempotent: true, worktree: recorded };
  }
  if (!recorded.owned) return failure(`Refusing to remove non-Runtime Task Graph integration worktree: ${expectedPath}`);

  const removed = runGit(['worktree', 'remove', '--force', expectedPath], repository, { timeoutMs: boundedTimeoutMs });
  if (removed.error || removed.status !== 0) {
    const error = runtimeError('TASK_STATE_CONFLICT', `Failed to remove Runtime-owned Task Graph integration worktree: ${expectedPath}`, {
      recoverable: true,
      taskId: parentTaskId,
      root: repository,
      stage: 'integration-cleanup',
      details: (removed.stderr || removed.stdout || removed.error?.message || '').trim(),
    });
    return { status: 'FAILED', idempotent: false, worktree: recorded, error: serializeCleanupError(error) };
  }
  const after = inspectGraphIntegrationWorktree(repository, parentTaskId, {
    probeGit: true,
    recordedPath,
    recordedBranch,
    recordedRef,
    timeoutMs: boundedTimeoutMs,
  });
  if (after.exists || after.registered) {
    const error = runtimeError('TASK_STATE_CONFLICT', `Runtime-owned Task Graph integration cleanup remains incomplete: ${expectedPath}`, {
      recoverable: true,
      taskId: parentTaskId,
      root: repository,
      stage: 'integration-cleanup',
      details: { path: expectedPath, exists: after.exists, registered: after.registered },
    });
    return { status: 'FAILED', idempotent: false, worktree: after, error: serializeCleanupError(error) };
  }
  return { status: 'CLEANED', idempotent: false, worktree: after };
}

export const cleanupGraphIntegrationWorktree = cleanupTaskGraphIntegrationWorktree;

function serializeCleanupError(error) {
  return {
    code: error.code,
    message: boundedText(error.message, 'Task Graph cleanup failed'),
    recoverable: Boolean(error.recoverable),
    taskId: error.taskId || null,
    subtaskId: error.subtaskId || null,
    root: error.root || null,
    stage: error.stage || 'cleanup',
    details: typeof error.details === 'string' ? boundedText(error.details) : error.details || null,
  };
}

export function taskGraphSchedulingView(record) {
  const validated = validateStoredGraph(record);
  const subtasks = reconcileSubtasks(validated.subtasks);
  const frontier = frontierFor(subtasks, validated.maxConcurrency);
  const storedStates = validated.subtasks.map(subtask => ({
    id: subtask.id,
    state: subtask.state,
    reason: subtask.reason || null,
  }));
  const derivedStates = subtasks.map(subtask => ({
    id: subtask.id,
    state: subtask.state,
    reason: subtask.reason || null,
  }));
  if (!sameJson(storedStates, derivedStates) || !sameJson(validated.frontier, frontier)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${validated.parentTaskId} has contradictory persisted scheduling facts.`, {
      recoverable: false,
      taskId: validated.parentTaskId,
      stage: 'graph-scheduling',
    });
  }
  return { subtasks, frontier, wave: intentSchedulingWave(validated, frontier) };
}

/** Read one immutable scheduling snapshot while serialized with graph writers. */
export function readTaskGraphSchedulingSnapshot(root, parentTaskId) {
  const { repository, bus } = ensureGraphStore(root);
  const release = acquireConfigLock(bus);
  try {
    const graph = readStoredGraph(repository, parentTaskId);
    return { graph, scheduling: taskGraphSchedulingView(graph) };
  } finally {
    release();
  }
}

export function hasTaskGraph(root, parentTaskId) {
  try {
    const path = taskGraphPath(root, parentTaskId);
    return existsSync(path);
  } catch {
    return false;
  }
}

export function listTaskGraphs(root) {
  const { store } = ensureGraphStore(root);
  if (!existsSync(store)) return [];
  const records = [];
  for (const name of readdirSync(store).filter(item => item.endsWith('.json')).sort()) {
    const path = join(store, name);
    safeInternalStat(store, path);
    try {
      records.push(validateStoredGraph(JSON.parse(readInternalFile(store, path))));
    } catch (error) {
      if (error?.code === 'TASK_STATE_CONFLICT') throw error;
      throw runtimeError('TASK_STATE_CONFLICT', `Failed to load Task Graph record ${name}: ${error.message || error}`, { recoverable: false });
    }
  }
  return records.sort((left, right) => `${right.updatedAt || ''}`.localeCompare(`${left.updatedAt || ''}`));
}

function graphInputFromRecord(record) {
  return {
    schemaVersion: TASK_GRAPH_SCHEMA_VERSION,
    parentTask: {
      id: record.parentTask.id,
      title: record.parentTask.title,
      ...(record.parentTask.spec === undefined ? {} : { spec: record.parentTask.spec }),
      planner: record.parentTask.planner,
      ...(record.parentTask.implementer === undefined ? {} : { implementer: record.parentTask.implementer }),
      reviewer: record.parentTask.reviewer,
    },
    subtasks: record.subtasks.map(subtask => ({
      id: subtask.id,
      ...(subtask.title === undefined ? {} : { title: subtask.title }),
      implementer: subtask.implementer,
      spec: subtask.spec,
      dependsOn: [...subtask.dependsOn],
    })),
    maxConcurrency: record.maxConcurrency,
  };
}

export function createTaskGraph(root, input, { configuredAgents = [], validated = false, intentMap = null } = {}) {
  const graph = validated ? graphInputFromRecord(input) : input;
  const normalized = validated
    ? input
    : validateTaskGraphV1(graph, { configuredAgents });
  const normalizedIntentMap = validateIntentMapV1(intentMap, normalized);
  const { repository, bus, store, tmp } = ensureGraphStore(root, { create: true });
  const path = taskGraphPath(repository, normalized.parentTask.id);
  const taskPath = join(bus, 'tasks', `${normalized.parentTask.id}.json`);
  assertContained(bus, taskPath);
  const release = acquireConfigLock(bus);
  try {
    if (existsSync(path) || existsSync(taskPath)) {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph or Task already exists: ${normalized.parentTask.id}`, {
        recoverable: true,
        taskId: normalized.parentTask.id,
        root: repository,
      });
    }
    const record = graphRecordFromValidated(normalized, normalizedIntentMap);
    // atomicWrite publishes one aggregate record containing the durable parent
    // and all parent-scoped subtasks. No partially written graph is visible.
    atomicWrite(path, `${JSON.stringify(record, null, 2)}\n`, tmp);
    const event = appendRuntimeEvent(repository, {
      type: 'TASK_GRAPH_CREATED',
      taskId: record.parentTaskId,
      agentId: record.parentTask.planner,
      role: 'planner',
      data: {
        parentTaskId: record.parentTaskId,
        state: record.state,
        maxConcurrency: record.maxConcurrency,
        subtaskIds: record.subtasks.map(subtask => subtask.id),
        frontier: record.frontier,
      },
    });
    return { graph: record, event };
  } finally {
    release();
  }
}

function graphFacts(record) {
  const base = taskGraphDurableFacts({
    parentTask: record.parentTask,
    state: record.state,
    maxConcurrency: record.maxConcurrency,
    subtasks: record.subtasks,
  });
  return {
    parent: {
      ...base.parent,
      baseCommit: record.baseCommit || record.parentTask.baseCommit || null,
      reason: boundedText(record.parentTask.reason || record.reason),
      evidence: boundedEvidence(record.parentTask.evidence || record.evidence),
    },
    subtasks: base.subtasks.map(fact => {
      const subtask = record.subtasks.find(item => item.id === fact.subtaskId);
      return {
        ...fact,
        title: subtask?.title,
        spec: subtask?.spec,
        baseCommit: subtask?.baseCommit || record.baseCommit || record.parentTask?.baseCommit || null,
        worktreePath: subtask?.worktreePath || null,
        branch: subtask?.branch || null,
        ref: subtask?.ref || null,
        sessionId: subtask?.sessionId || null,
        effectiveCommand: subtask?.effectiveCommand || subtask?.command || null,
        resolvedCommand: subtask?.resolvedCommand || null,
        implementationCommit: subtask?.implementationCommit || null,
        reason: boundedText(subtask?.reason),
        evidence: boundedEvidence(subtask?.evidence),
      };
    }),
    integration: record.integration || null,
    review: record.review || null,
    reviewHistory: Array.isArray(record.reviewHistory) ? record.reviewHistory : [],
    intentCoverage: intentCoverageFacts(record),
  };
}

function parentTaskView(record) {
  const parent = record.parentTask;
  return {
    schemaVersion: 1,
    kind: 'task-graph-parent',
    graph: true,
    id: parent.id,
    parentTaskId: parent.id,
    title: parent.title,
    status: record.state,
    state: record.state,
    round: 1,
    planner: parent.planner,
    implementer: parent.implementer || null,
    reviewer: parent.reviewer,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    spec: parent.spec || '',
    baseCommit: record.baseCommit || parent.baseCommit || null,
    evidence: boundedEvidence(parent.evidence || record.evidence),
    lastError: record.state === 'ERROR' ? (record.reason || null) : null,
    maxConcurrency: record.maxConcurrency,
    subtaskIds: record.subtasks.map(subtask => subtask.id),
  };
}

export function taskGraphStatusPayload(root, record, { inspect = false, eventLimit = TASK_GRAPH_EVENT_LIMIT } = {}) {
  const events = inspect
    ? readRuntimeEvents(root, { taskId: record.parentTaskId, limit: eventLimit })
    : undefined;
  const integration = inspectTaskGraphIntegration(root, record, { probeGit: inspect });
  return {
    root: resolve(root),
    graphId: record.parentTaskId,
    parentTaskId: record.parentTaskId,
    state: record.state,
    status: record.status,
    baseCommit: record.baseCommit || record.parentTask?.baseCommit || null,
    graph: record,
    task: parentTaskView(record),
    parent: record.parentTask,
    subtasks: record.subtasks,
    frontier: record.frontier,
    facts: graphFacts(record),
    recovery: inspectTaskGraphRecovery(root, record),
    integration: record.integration || null,
    integrationFacts: integration,
    review: record.review || null,
    reviewHistory: Array.isArray(record.reviewHistory) ? record.reviewHistory : [],
    intentCoverage: intentCoverageFacts(record),
    ...(inspect ? { events } : {}),
  };
}

function integrationRecordTemplate(parentTaskId, timestamp = now()) {
  return {
    schemaVersion: TASK_GRAPH_SCHEMA_VERSION,
    kind: 'task-graph-integration',
    parentTaskId,
    state: 'PENDING',
    status: 'PENDING',
    reason: null,
    lastError: null,
    baseCommit: null,
    worktreePath: null,
    branch: null,
    ref: null,
    worktreeHead: null,
    aggregateCommit: null,
    sourceFingerprint: null,
    sourceRefs: [],
    appliedRefs: [],
    appliedCommits: [],
    appliedSubtasks: [],
    conflict: null,
    cleanup: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeIntegrationArray(value, limit = TASK_GRAPH_MAX_SUBTASKS) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map(item => typeof item === 'string'
    ? boundedText(item, '')
    : sanitizeRuntimeEventData(item));
}

function integrationErrorDetails(error) {
  return serializeRuntimeError(error, { includeLegacy: true });
}

/**
 * Update the durable integration state without changing the graph lifecycle
 * state. The graph lock serializes each applied commit so a coordinator
 * restart can inspect exactly how far the aggregate worktree progressed.
 */
export function setTaskGraphIntegration(root, parentTaskId, nextState, details = {}) {
  if (!INTEGRATION_STATE_SET.has(nextState)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Unsupported Task Graph integration state: ${nextState}`, {
      recoverable: false,
      taskId: parentTaskId,
      stage: 'graph-integration',
    });
  }
  const { repository, bus, tmp } = ensureGraphStore(root);
  const path = taskGraphPath(repository, parentTaskId);
  const release = acquireConfigLock(bus);
  try {
    const current = readStoredGraph(repository, parentTaskId);
    const previous = current.integration;
    if (details.expectedState !== undefined && (previous?.state || 'PENDING') !== details.expectedState) {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph integration for ${parentTaskId} is ${previous?.state || 'PENDING'}; expected ${details.expectedState}.`, {
        recoverable: true,
        taskId: parentTaskId,
        stage: 'graph-integration',
        details: { expectedState: details.expectedState, actualState: previous?.state || 'PENDING' },
      });
    }
    const timestamp = now();
    const base = previous || integrationRecordTemplate(parentTaskId, timestamp);
    const candidate = {
      ...base,
      ...Object.fromEntries(Object.entries(details).filter(([key]) => ![
        'expectedState', 'operation', 'reason', 'evidence', 'sourceRefs', 'appliedRefs',
        'appliedCommits', 'appliedSubtasks', 'conflict', 'cleanup', 'lastError',
      ].includes(key))),
      schemaVersion: TASK_GRAPH_SCHEMA_VERSION,
      kind: 'task-graph-integration',
      parentTaskId,
      state: nextState,
      status: nextState,
      reason: details.reason === undefined ? (base.reason || null) : boundedText(details.reason),
      lastError: details.lastError === undefined
        ? (base.lastError || null)
        : (details.lastError ? sanitizeRuntimeEventData(details.lastError) : null),
      sourceRefs: details.sourceRefs === undefined ? normalizeIntegrationArray(base.sourceRefs) : normalizeIntegrationArray(details.sourceRefs),
      appliedRefs: details.appliedRefs === undefined ? normalizeIntegrationArray(base.appliedRefs) : normalizeIntegrationArray(details.appliedRefs),
      appliedCommits: details.appliedCommits === undefined ? normalizeIntegrationArray(base.appliedCommits) : normalizeIntegrationArray(details.appliedCommits),
      appliedSubtasks: details.appliedSubtasks === undefined ? normalizeIntegrationArray(base.appliedSubtasks) : normalizeIntegrationArray(details.appliedSubtasks),
      conflict: details.conflict === undefined ? (base.conflict || null) : (details.conflict ? sanitizeRuntimeEventData(details.conflict) : null),
      cleanup: details.cleanup === undefined ? (base.cleanup || null) : (details.cleanup ? sanitizeRuntimeEventData(details.cleanup) : null),
      evidence: details.evidence === undefined ? normalizeIntegrationArray(base.evidence, TASK_GRAPH_MAX_EVIDENCE_ITEMS) : normalizeIntegrationArray(details.evidence, TASK_GRAPH_MAX_EVIDENCE_ITEMS),
    };
    const withoutTimestamps = value => ({ ...value, updatedAt: null, createdAt: null });
    const changed = !sameJson(withoutTimestamps(base), withoutTimestamps(candidate));
    if (!changed) return { graph: current, integration: previous || null, changed: false, event: null };
    const next = {
      ...current,
      integration: { ...candidate, updatedAt: timestamp },
      updatedAt: timestamp,
    };
    atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`, tmp);
    const event = appendRuntimeEvent(repository, {
      type: 'TASK_GRAPH_INTEGRATION_STATE_CHANGED',
      taskId: parentTaskId,
      agentId: current.parentTask.planner,
      role: 'planner',
      data: {
        from: previous?.state || null,
        to: nextState,
        operation: details.operation || null,
        baseCommit: candidate.baseCommit || null,
        worktreePath: candidate.worktreePath || null,
        branch: candidate.branch || null,
        ref: candidate.ref || null,
        aggregateCommit: candidate.aggregateCommit || null,
        sourceFingerprint: candidate.sourceFingerprint || null,
        appliedRefs: candidate.appliedRefs,
        conflict: candidate.conflict,
        cleanup: candidate.cleanup,
        lastError: candidate.lastError,
      },
    });
    return { graph: next, integration: next.integration, changed: true, event };
  } finally {
    release();
  }
}

function reviewRecordEqual(left, right) {
  return Boolean(left && right)
    && left.decision === right.decision
    && left.feedback === right.feedback
    && left.integrationCommit === right.integrationCommit
    && sameJson(left.evidence || [], right.evidence || []);
}

/** Persist graph review decisions at the same boundary as single-Task review. */
export function setTaskGraphReview(root, parentTaskId, decision, details = {}) {
  const normalizedDecision = `${decision || ''}`.trim().toUpperCase();
  if (!['REVIEW_APPROVED', 'CHANGES_REQUESTED'].includes(normalizedDecision)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Unsupported Task Graph review decision: ${decision || '(empty)'}`, {
      recoverable: false,
      taskId: parentTaskId,
      stage: 'graph-review',
    });
  }
  const feedback = details.feedback === undefined ? '' : boundedText(details.feedback, '');
  if (normalizedDecision === 'CHANGES_REQUESTED' && !feedback) {
    throw runtimeError('TASK_STATE_CONFLICT', 'CHANGES_REQUESTED requires review feedback.', {
      recoverable: false,
      taskId: parentTaskId,
      stage: 'graph-review',
    });
  }
  const { repository, bus, tmp } = ensureGraphStore(root);
  const path = taskGraphPath(repository, parentTaskId);
  const release = acquireConfigLock(bus);
  try {
    const current = readStoredGraph(repository, parentTaskId);
    const integration = current.integration;
    if (!integration || integration.state !== 'SUCCEEDED') {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} must have a successful integration before review.`, {
        recoverable: true,
        taskId: parentTaskId,
        stage: 'graph-review',
        details: { integrationState: integration?.state || null },
      });
    }
    if (current.state === 'STOPPED' || (current.state === 'APPROVED' && current.review?.decision !== normalizedDecision)) {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} is ${current.state} and cannot record this review decision.`, {
        recoverable: false,
        taskId: parentTaskId,
        stage: 'graph-review',
      });
    }
    const timestamp = now();
    const review = {
      schemaVersion: TASK_GRAPH_SCHEMA_VERSION,
      kind: 'task-graph-review',
      decision: normalizedDecision,
      reviewer: current.parentTask.reviewer,
      feedback,
      integrationCommit: integration.aggregateCommit || null,
      integrationWorktreePath: integration.worktreePath || null,
      integrationBranch: integration.branch || null,
      integrationRef: integration.ref || null,
      evidence: details.evidence === undefined || details.evidence === null
        ? [{ type: 'TASK_GRAPH_INTEGRATION', integrationCommit: integration.aggregateCommit || null, appliedRefs: integration.appliedRefs || [] }]
        : normalizeIntegrationArray(
          Array.isArray(details.evidence) ? details.evidence : [details.evidence],
          TASK_GRAPH_MAX_EVIDENCE_ITEMS,
        ),
      decidedAt: timestamp,
    };
    const nextState = normalizedDecision === 'REVIEW_APPROVED' ? 'APPROVED' : 'REVIEWING';
    const sameDecision = reviewRecordEqual(current.review, review) && current.state === nextState;
    if (sameDecision) return { graph: current, review: current.review, changed: false, event: null };
    const history = [...(Array.isArray(current.reviewHistory) ? current.reviewHistory : []), review]
      .slice(-TASK_GRAPH_MAX_EVIDENCE_ITEMS);
    const next = {
      ...current,
      state: nextState,
      status: nextState,
      review,
      reviewHistory: history,
      parentTask: {
        ...current.parentTask,
        state: nextState,
        status: nextState,
      },
      updatedAt: timestamp,
    };
    atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`, tmp);
    const event = appendRuntimeEvent(repository, {
      type: normalizedDecision,
      taskId: parentTaskId,
      agentId: current.parentTask.reviewer,
      role: 'reviewer',
      data: {
        graph: true,
        decision: normalizedDecision,
        feedback,
        integrationCommit: review.integrationCommit,
        appliedRefs: integration.appliedRefs || [],
        evidence: review.evidence,
      },
    });
    return { graph: next, review, changed: true, event };
  } finally {
    release();
  }
}

function integrationSourceBaseCommit(graph) {
  const values = [
    graph.baseCommit,
    graph.parentTask?.baseCommit,
    ...graph.subtasks.map(subtask => subtask.baseCommit),
  ].filter(value => value !== undefined && value !== null && `${value}`.trim());
  if (values.length === 0) return null;
  const normalized = values.map(value => normalizeCommitSha(value, 'graph base commit'));
  const first = normalized[0];
  if (normalized.some(value => value !== first)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${graph.parentTaskId} has conflicting base commit facts for integration.`, {
      recoverable: true,
      taskId: graph.parentTaskId,
      stage: 'graph-integration',
      details: { baseCommits: normalized },
    });
  }
  return first;
}

/**
 * Verify every required source before creating the aggregate worktree. The
 * source ref must be the exact Runtime branch for that subtask and must still
 * reach the recorded IMPLEMENTATION_DONE commit.
 */
export function verifyTaskGraphIntegrationSources(root, graph) {
  const record = validateStoredGraph(graph);
  const repository = repositoryRoot(root);
  const baseCommit = integrationSourceBaseCommit(record);
  if (!baseCommit) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${record.parentTaskId} has no captured base commit for integration.`, {
      recoverable: true,
      taskId: record.parentTaskId,
      root: repository,
      stage: 'graph-integration',
      details: { requiredFact: 'baseCommit' },
    });
  }
  const unresolved = record.subtasks
    .filter(subtask => subtask.state !== 'SUCCEEDED')
    .map(subtask => ({ id: subtask.id, state: subtask.state, reason: boundedText(subtask.reason) }));
  if (unresolved.length > 0) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${record.parentTaskId} cannot integrate until every required subtask succeeds.`, {
      recoverable: true,
      taskId: record.parentTaskId,
      root: repository,
      stage: 'graph-integration',
      details: { baseCommit, unresolved },
    });
  }

  const sources = [];
  for (const subtask of [...record.subtasks].sort((left, right) => compareIds(left.id, right.id))) {
    const expectedBranch = taskGraphBranchName(record.parentTaskId, subtask.id);
    const expectedRef = taskGraphBranchRef(record.parentTaskId, subtask.id);
    const evidence = Array.isArray(subtask.evidence) && subtask.evidence.some(item => item?.type === 'IMPLEMENTATION_DONE'
      && typeof item.relatedCommit === 'string'
      && item.relatedCommit.toLowerCase() === `${subtask.implementationCommit || ''}`.toLowerCase());
    if (!evidence) {
      throw runtimeError('TASK_STATE_CONFLICT', `Subtask ${record.parentTaskId}/${subtask.id} lacks verified IMPLEMENTATION_DONE evidence.`, {
        recoverable: true,
        taskId: record.parentTaskId,
        subtaskId: subtask.id,
        root: repository,
        stage: 'graph-integration',
        details: { state: subtask.state, implementationCommit: subtask.implementationCommit || null, expectedRef },
      });
    }
    if (subtask.branch !== expectedBranch || subtask.ref !== expectedRef) {
      throw runtimeError('TASK_STATE_CONFLICT', `Subtask ${record.parentTaskId}/${subtask.id} does not have the exact Runtime source ref required for integration.`, {
        recoverable: true,
        taskId: record.parentTaskId,
        subtaskId: subtask.id,
        root: repository,
        stage: 'graph-integration',
        details: { expectedBranch, actualBranch: subtask.branch || null, expectedRef, actualRef: subtask.ref || null },
      });
    }
    const commit = `${subtask.implementationCommit || ''}`.trim();
    if (!COMMIT_SHA_PATTERN.test(commit)) {
      throw runtimeError('TASK_STATE_CONFLICT', `Subtask ${record.parentTaskId}/${subtask.id} has no valid implementation commit for integration.`, {
        recoverable: true,
        taskId: record.parentTaskId,
        subtaskId: subtask.id,
        root: repository,
        stage: 'graph-integration',
        details: { implementationCommit: subtask.implementationCommit || null, expectedRef },
      });
    }
    const refResult = runGit(['rev-parse', '--verify', `${expectedRef}^{commit}`], repository);
    if (refResult.error || refResult.status !== 0) {
      throw runtimeError('TASK_STATE_CONFLICT', `Subtask ${record.parentTaskId}/${subtask.id} source ref is missing: ${expectedRef}`, {
        recoverable: true,
        taskId: record.parentTaskId,
        subtaskId: subtask.id,
        root: repository,
        stage: 'graph-integration',
        details: (refResult.stderr || refResult.stdout || refResult.error?.message || '').trim(),
      });
    }
    const refCommit = normalizeCommitSha(refResult.stdout, `source ref for ${subtask.id}`);
    const candidate = normalizeCommitSha(commit, `implementation commit for ${subtask.id}`);
    if (candidate === baseCommit) {
      throw runtimeError('TASK_STATE_CONFLICT', `Subtask ${record.parentTaskId}/${subtask.id} implementation commit is the graph base commit.`, {
        recoverable: true,
        taskId: record.parentTaskId,
        subtaskId: subtask.id,
        root: repository,
        stage: 'graph-integration',
        details: { baseCommit, implementationCommit: candidate, expectedRef },
      });
    }
    for (const [label, args] of [
      ['base commit', ['merge-base', '--is-ancestor', baseCommit, candidate]],
      ['source ref', ['merge-base', '--is-ancestor', candidate, refCommit]],
    ]) {
      const result = runGit(args, repository);
      if (result.error || result.status !== 0) {
        throw runtimeError('TASK_STATE_CONFLICT', `Subtask ${record.parentTaskId}/${subtask.id} implementation commit is not reachable from its verified ${label}.`, {
          recoverable: true,
          taskId: record.parentTaskId,
          subtaskId: subtask.id,
          root: repository,
          stage: 'graph-integration',
          details: { baseCommit, implementationCommit: candidate, expectedRef, refCommit, git: (result.stderr || result.stdout || result.error?.message || '').trim() },
        });
      }
    }
    sources.push({
      order: sources.length,
      subtaskId: subtask.id,
      implementer: subtask.implementer,
      branch: expectedBranch,
      ref: expectedRef,
      commit: candidate,
      refCommit,
      evidence: boundedEvidence(subtask.evidence),
    });
  }
  const sourceFingerprint = createHash('sha256')
    .update(JSON.stringify(sources.map(source => ({ subtaskId: source.subtaskId, ref: source.ref, commit: source.commit }))))
    .digest('hex');
  return { repository, parentTaskId: record.parentTaskId, baseCommit, sources, sourceFingerprint };
}

export function inspectTaskGraphIntegration(root, graph, { probeGit = false, timeoutMs = null } = {}) {
  const record = validateStoredGraph(graph);
  if (!record.integration) return null;
  const integration = validateStoredIntegration(record.integration, record.parentTaskId);
  const worktree = inspectGraphIntegrationWorktree(repositoryRoot(root), record.parentTaskId, {
    probeGit,
    recordedPath: integration.worktreePath || null,
    recordedBranch: integration.branch || null,
    recordedRef: integration.ref || null,
    timeoutMs,
  });
  let clean = null;
  let files = [];
  let diffStat = null;
  const head = integration.aggregateCommit || integration.worktreeHead || worktree.head || null;
  const baseCommit = integration.baseCommit || record.baseCommit || record.parentTask?.baseCommit || null;
  if (probeGit && worktree.safe && worktree.exists) {
    const status = runGit(['status', '--porcelain=v1', '--untracked-files=all'], worktree.path, { timeoutMs });
    clean = !status.error && status.status === 0 && !status.stdout.trim();
  }
  if (probeGit && worktree.safe && worktree.exists && baseCommit && head && COMMIT_SHA_PATTERN.test(`${baseCommit}`) && COMMIT_SHA_PATTERN.test(`${head}`)) {
    const changed = runGit(['diff', '--name-only', `${baseCommit}..${head}`], worktree.path, { timeoutMs });
    if (!changed.error && changed.status === 0) {
      files = changed.stdout.split(/\r?\n/).map(value => boundedText(value)).filter(Boolean).slice(0, TASK_GRAPH_MAX_EVIDENCE_ITEMS);
    }
    const stat = runGit(['diff', '--stat', `${baseCommit}..${head}`], worktree.path, { timeoutMs });
    if (!stat.error && stat.status === 0) diffStat = boundedText(stat.stdout);
  }
  return {
    root: repositoryRoot(root),
    parentTaskId: record.parentTaskId,
    state: integration.state,
    status: integration.status,
    baseCommit: integration.baseCommit || null,
    worktreePath: integration.worktreePath || worktree.path,
    branch: integration.branch || worktree.branch,
    ref: integration.ref || worktree.ref,
    worktreeHead: integration.worktreeHead || worktree.head || null,
    aggregateCommit: integration.aggregateCommit || null,
    sourceFingerprint: integration.sourceFingerprint || null,
    sourceRefs: integration.sourceRefs || [],
    appliedRefs: integration.appliedRefs || [],
    appliedCommits: integration.appliedCommits || [],
    appliedSubtasks: integration.appliedSubtasks || [],
    conflict: integration.conflict || null,
    cleanup: integration.cleanup || null,
    lastError: integration.lastError || null,
    evidence: integration.evidence || [],
    worktree,
    clean,
    diff: { baseCommit, head, files, stat: diffStat },
  };
}

function gitConflictFacts(worktreePath, source, result, appliedRefs) {
  const status = runGit(['status', '--porcelain=v1', '--untracked-files=all'], worktreePath);
  const unmerged = runGit(['diff', '--name-only', '--diff-filter=U'], worktreePath);
  const cherryPickHead = runGit(['rev-parse', '--verify', 'CHERRY_PICK_HEAD'], worktreePath);
  const lines = `${unmerged.status === 0 ? unmerged.stdout : status.stdout || ''}`
    .split(/\r?\n/)
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => value.replace(/^[ MARC?!U][ MARC?!U]\s+/, ''))
    .map(value => boundedText(value, 1024))
    .filter(Boolean);
  return {
    state: 'CONFLICTED',
    inProgress: cherryPickHead.status === 0,
    subtaskId: source.subtaskId,
    order: source.order,
    ref: source.ref,
    branch: source.branch,
    commit: source.commit,
    appliedRefs: normalizeIntegrationArray(appliedRefs),
    files: [...new Set(lines)].slice(0, TASK_GRAPH_MAX_EVIDENCE_ITEMS),
    status: boundedText(status.stdout),
    stdout: boundedText(result.stdout),
    stderr: boundedText(result.stderr || result.error?.message),
    detectedAt: now(),
  };
}

function integrationErrorWithFacts(code, message, parentTaskId, root, details = {}) {
  return runtimeError(code, message, {
    recoverable: true,
    taskId: parentTaskId,
    root,
    stage: 'graph-integration',
    details,
  });
}

/**
 * Apply all verified subtask commits to a fresh aggregate worktree. Every
 * successful cherry-pick is persisted before the next one starts; a conflict
 * deliberately leaves Git's in-progress state in place for inspection.
 */
export function integrateTaskGraph(root, parentTaskId, { timeoutMs = 2_000 } = {}) {
  const repository = repositoryRoot(root);
  let graph = readTaskGraph(repository, parentTaskId);
  const prepared = verifyTaskGraphIntegrationSources(repository, graph);
  const prior = graph.integration;
  if (prior?.state === 'SUCCEEDED') {
    if (prior.sourceFingerprint === prepared.sourceFingerprint && prior.baseCommit?.toLowerCase() === prepared.baseCommit.toLowerCase()) {
      return {
        repository,
        parentTaskId,
        graph,
        integration: inspectTaskGraphIntegration(repository, graph, { probeGit: true, timeoutMs }),
        sources: prepared.sources,
        idempotent: true,
      };
    }
    throw integrationErrorWithFacts('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} already has a successful integration for different source commits.`, parentTaskId, repository, {
      integration: prior,
      requestedSourceFingerprint: prepared.sourceFingerprint,
    });
  }
  if (prior?.state === 'RUNNING') {
    throw integrationErrorWithFacts('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} integration is already RUNNING; inspect or reconcile it before retrying.`, parentTaskId, repository, {
      integration: prior,
    });
  }
  if (prior?.state === 'FAILED' && (prior.conflict || prior.appliedRefs?.length || prior.worktreePath)) {
    throw integrationErrorWithFacts('WORKTREE_CONFLICT', `Task Graph ${parentTaskId} has a failed integration that requires explicit cleanup or conflict resolution.`, parentTaskId, repository, {
      integration: prior,
    });
  }
  if (['STOPPED', 'APPROVED'].includes(graph.state)) {
    throw integrationErrorWithFacts('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} is ${graph.state} and cannot start integration.`, parentTaskId, repository, {
      graphState: graph.state,
    });
  }

  const identity = {
    worktreePath: taskGraphIntegrationWorktreePath(repository, parentTaskId),
    branch: taskGraphIntegrationBranchName(parentTaskId),
    ref: taskGraphIntegrationBranchRef(parentTaskId),
  };
  setTaskGraphIntegration(repository, parentTaskId, 'RUNNING', {
    expectedState: prior?.state || 'PENDING',
    baseCommit: prepared.baseCommit,
    worktreePath: identity.worktreePath,
    branch: identity.branch,
    ref: identity.ref,
    sourceFingerprint: prepared.sourceFingerprint,
    sourceRefs: prepared.sources.map(source => ({
      order: source.order,
      subtaskId: source.subtaskId,
      branch: source.branch,
      ref: source.ref,
      commit: source.commit,
      refCommit: source.refCommit,
    })),
    appliedRefs: [],
    appliedCommits: [],
    appliedSubtasks: [],
    aggregateCommit: null,
    worktreeHead: prepared.baseCommit,
    conflict: null,
    cleanup: null,
    lastError: null,
    reason: `Integrating ${prepared.sources.length} verified subtask commit(s).`,
    operation: 'graph-integrate',
  });

  let worktreeInfo = null;
  let applied = [];
  const boundedTimeoutMs = Math.max(100, Math.min(10_000, Number.isFinite(timeoutMs) ? Math.floor(timeoutMs) : 2_000));
  try {
    worktreeInfo = ensureTaskGraphIntegrationWorktree(repository, parentTaskId, prepared.baseCommit);
    const worktree = inspectGraphIntegrationWorktree(repository, parentTaskId, {
      probeGit: true,
      recordedPath: identity.worktreePath,
      recordedBranch: identity.branch,
      recordedRef: identity.ref,
      timeoutMs: boundedTimeoutMs,
    });
    if (!worktree.owned || !worktree.safe || !worktree.exists) {
      throw integrationErrorWithFacts('TASK_STATE_CONFLICT', `Runtime integration worktree failed ownership verification: ${identity.worktreePath}`, parentTaskId, repository, {
        worktree,
      });
    }
    setTaskGraphIntegration(repository, parentTaskId, 'RUNNING', {
      expectedState: 'RUNNING',
      worktreePath: worktreeInfo.worktreePath,
      branch: worktreeInfo.branch,
      ref: worktreeInfo.ref,
      worktreeHead: worktree.head || prepared.baseCommit,
      operation: 'graph-integrate',
    });

    for (const source of prepared.sources) {
      const result = runGit(['cherry-pick', '--no-edit', source.commit], worktreeInfo.worktreePath, { timeoutMs: boundedTimeoutMs });
      if (result.error || result.status !== 0) {
        const conflict = gitConflictFacts(worktreeInfo.worktreePath, source, result, applied);
        const error = integrationErrorWithFacts('WORKTREE_CONFLICT', `Failed to apply subtask ${source.subtaskId} commit in the integration worktree.`, parentTaskId, repository, {
          worktreePath: worktreeInfo.worktreePath,
          branch: worktreeInfo.branch,
          ref: worktreeInfo.ref,
          source,
          appliedRefs: applied,
          conflict,
        });
        setTaskGraphIntegration(repository, parentTaskId, 'FAILED', {
          expectedState: 'RUNNING',
          aggregateCommit: applied.length > 0 ? applied.at(-1).aggregateCommit : prepared.baseCommit,
          worktreeHead: captureGraphBaseCommit(worktreeInfo.worktreePath),
          conflict,
          lastError: integrationErrorDetails(error),
          reason: error.message,
          operation: 'graph-integrate',
        });
        throw error;
      }
      const aggregateCommit = captureGraphBaseCommit(worktreeInfo.worktreePath);
      const appliedRef = {
        order: source.order,
        subtaskId: source.subtaskId,
        branch: source.branch,
        ref: source.ref,
        commit: source.commit,
        aggregateCommit,
        appliedAt: now(),
      };
      applied = [...applied, appliedRef];
      setTaskGraphIntegration(repository, parentTaskId, 'RUNNING', {
        expectedState: 'RUNNING',
        appliedRefs: applied,
        appliedCommits: applied.map(item => item.commit),
        appliedSubtasks: applied.map(item => item.subtaskId),
        aggregateCommit,
        worktreeHead: aggregateCommit,
        reason: `Applied ${applied.length} of ${prepared.sources.length} verified subtask commit(s).`,
        operation: 'graph-integrate',
      });
    }

    const aggregateCommit = captureGraphBaseCommit(worktreeInfo.worktreePath);
    const integrationRef = runGit(['rev-parse', '--verify', `${worktreeInfo.ref}^{commit}`], repository);
    if (integrationRef.error || integrationRef.status !== 0 || integrationRef.stdout.trim().toLowerCase() !== aggregateCommit.toLowerCase()) {
      throw integrationErrorWithFacts('TASK_STATE_CONFLICT', `Integration branch did not retain the aggregate commit for ${parentTaskId}.`, parentTaskId, repository, {
        ref: worktreeInfo.ref,
        expected: aggregateCommit,
        actual: integrationRef.stdout.trim() || null,
      });
    }
    const completed = setTaskGraphIntegration(repository, parentTaskId, 'SUCCEEDED', {
      expectedState: 'RUNNING',
      appliedRefs: applied,
      appliedCommits: applied.map(item => item.commit),
      appliedSubtasks: applied.map(item => item.subtaskId),
      aggregateCommit,
      worktreeHead: aggregateCommit,
      conflict: null,
      lastError: null,
      reason: `Integrated ${applied.length} verified subtask commit(s) in deterministic order.`,
      evidence: [{
        type: 'TASK_GRAPH_INTEGRATION',
        baseCommit: prepared.baseCommit,
        aggregateCommit,
        appliedRefs: applied,
      }],
      operation: 'graph-integrate',
    });
    graph = completed.graph;
    return {
      repository,
      parentTaskId,
      graph,
      integration: inspectTaskGraphIntegration(repository, graph, { probeGit: true, timeoutMs: boundedTimeoutMs }),
      sources: prepared.sources,
      idempotent: false,
    };
  } catch (error) {
    const normalized = error?.code ? error : integrationErrorWithFacts('AGENT_RUNTIME_ERROR', error?.message || String(error), parentTaskId, repository, {
      worktreePath: worktreeInfo?.worktreePath || identity.worktreePath,
      branch: worktreeInfo?.branch || identity.branch,
      ref: worktreeInfo?.ref || identity.ref,
    });
    try {
      const latest = readTaskGraph(repository, parentTaskId);
      if (latest.integration?.state === 'RUNNING') {
        setTaskGraphIntegration(repository, parentTaskId, 'FAILED', {
          expectedState: 'RUNNING',
          worktreePath: worktreeInfo?.worktreePath || identity.worktreePath,
          branch: worktreeInfo?.branch || identity.branch,
          ref: worktreeInfo?.ref || identity.ref,
          aggregateCommit: applied.at(-1)?.aggregateCommit || latest.integration.aggregateCommit || null,
          worktreeHead: applied.at(-1)?.aggregateCommit || latest.integration.worktreeHead || prepared.baseCommit,
          lastError: integrationErrorDetails(normalized),
          reason: normalized.message,
          operation: 'graph-integrate',
        });
      }
    } catch {
      // Preserve the primary integration error. The durable state write is
      // retried by an explicit inspect/reconcile operation if it failed too.
    }
    throw normalized;
  }
}

export const integrateTaskGraphCommits = integrateTaskGraph;

/** Update only the explicit parent graph lifecycle state under the graph lock. */
export function setTaskGraphState(root, parentTaskId, nextState, details = {}) {
  if (!GRAPH_STATE_SET.has(nextState)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Unsupported Task Graph state: ${nextState}`, {
      recoverable: false,
      taskId: parentTaskId,
    });
  }
  const { repository, bus, tmp } = ensureGraphStore(root);
  const path = taskGraphPath(repository, parentTaskId);
  const release = acquireConfigLock(bus);
  try {
    const current = readStoredGraph(repository, parentTaskId);
    if (details.expectedState !== undefined && current.state !== details.expectedState) {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} is ${current.state}; expected ${details.expectedState}.`, {
        recoverable: true,
        taskId: parentTaskId,
        stage: 'graph-recovery',
        details: { expectedState: details.expectedState, actualState: current.state },
      });
    }
    const reason = details.reason === undefined ? current.reason : boundedText(details.reason);
    const evidence = details.evidence === undefined ? current.evidence : boundedEvidence(details.evidence);
    const candidate = {
      ...current,
      state: nextState,
      status: nextState,
      reason,
      evidence,
      parentTask: {
        ...current.parentTask,
        state: nextState,
        status: nextState,
        reason,
        evidence,
      },
    };
    const changed = !sameJson({ ...current, updatedAt: null, parentTask: { ...current.parentTask, updatedAt: null } }, {
      ...candidate,
      updatedAt: null,
      parentTask: { ...candidate.parentTask, updatedAt: null },
    });
    if (!changed) return { graph: current, changed: false, event: null };
    const timestamp = now();
    const next = {
      ...candidate,
      updatedAt: timestamp,
      parentTask: { ...candidate.parentTask, updatedAt: timestamp },
    };
    atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`, tmp);
    const event = appendRuntimeEvent(repository, {
      type: 'TASK_GRAPH_STATUS_CHANGED',
      taskId: parentTaskId,
      agentId: current.parentTask.planner,
      role: 'planner',
      data: {
        from: current.state,
        to: nextState,
        reason,
        evidence,
        operation: details.operation || null,
      },
    });
    return { graph: next, changed: true, event };
  } finally {
    release();
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function setTaskGraphSubtaskState(root, parentTaskId, subtaskId, nextState, details = {}) {
  if (!SUBTASK_STATE_SET.has(nextState)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Unsupported Task Graph subtask state: ${nextState}`, { recoverable: false, taskId: parentTaskId });
  }
  const { repository, bus, tmp } = ensureGraphStore(root);
  const path = taskGraphPath(repository, parentTaskId);
  const release = acquireConfigLock(bus);
  try {
    const current = readStoredGraph(repository, parentTaskId);
    const target = current.subtasks.find(subtask => subtask.id === subtaskId);
    if (!target) {
      throw runtimeError('TASK_NOT_FOUND', `Task Graph subtask not found: ${parentTaskId}/${subtaskId}`, {
        recoverable: false,
        taskId: parentTaskId,
        details: { parentTaskId, subtaskId },
      });
    }
    if (details.expectedState !== undefined && target.state !== details.expectedState) {
      const code = details.expectedState === 'READY' && target.state === 'RUNNING'
        ? 'TASK_ALREADY_RUNNING'
        : 'TASK_STATE_CONFLICT';
      throw runtimeError(code, `Task Graph subtask ${parentTaskId}/${subtaskId} is ${target.state}; expected ${details.expectedState}.`, {
        recoverable: code !== 'TASK_ALREADY_RUNNING',
        taskId: parentTaskId,
        subtaskId,
        details: { expectedState: details.expectedState, actualState: target.state },
      });
    }
    if (details.requireAvailableSlot === true && nextState === 'RUNNING' && target.state !== 'RUNNING') {
      const runningCount = current.subtasks.filter(subtask => subtask.state === 'RUNNING').length;
      if (runningCount >= current.maxConcurrency) {
        throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} has no available concurrency slot for ${subtaskId}.`, {
          recoverable: true,
          taskId: parentTaskId,
          subtaskId,
          stage: 'graph-scheduling',
          details: {
            maxConcurrency: current.maxConcurrency,
            runningCount,
            availableSlots: 0,
          },
        });
      }
    }
    if (details.requireIntentCompatible === true && nextState === 'RUNNING' && target.state !== 'RUNNING') {
      for (const running of current.subtasks.filter(subtask => subtask.state === 'RUNNING').sort((left, right) => compareIds(left.id, right.id))) {
        const conflict = writeIntentConflictBetween(current, target.id, running.id);
        if (!conflict) continue;
        throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${parentTaskId} cannot run ${subtaskId} concurrently with ${running.id} because their write intents conflict.`, {
          recoverable: true,
          taskId: parentTaskId,
          subtaskId,
          stage: 'graph-scheduling',
          details: { conflict },
        });
      }
    }
    const reason = details.reason === undefined ? target.reason : boundedText(details.reason);
    const evidence = details.evidence === undefined ? target.evidence : boundedEvidence(details.evidence);
    const suppliedBaseCommit = details.baseCommit === undefined || details.baseCommit === null
      ? details.baseCommit
      : normalizeCommitSha(details.baseCommit, 'graph base commit');
    const candidateSubtask = {
      ...target,
      ...(details.worktreePath !== undefined ? { worktreePath: details.worktreePath } : {}),
      ...(details.branch !== undefined ? { branch: details.branch } : {}),
      ...(details.ref !== undefined ? { ref: details.ref } : {}),
      ...(details.baseCommit !== undefined ? { baseCommit: suppliedBaseCommit } : {}),
      ...(details.sessionId !== undefined ? { sessionId: details.sessionId } : {}),
      ...(details.effectiveCommand !== undefined ? { effectiveCommand: details.effectiveCommand } : {}),
      ...(details.resolvedCommand !== undefined ? { resolvedCommand: details.resolvedCommand } : {}),
      ...(details.command !== undefined ? { command: details.command } : {}),
      ...(details.implementationCommit !== undefined ? { implementationCommit: details.implementationCommit } : {}),
      ...(details.dispatch !== undefined ? { dispatch: details.dispatch } : {}),
      ...(details.lastError !== undefined ? { lastError: details.lastError } : {}),
      ...(details.recovery !== undefined ? { recovery: sanitizeRuntimeEventData(details.recovery) } : {}),
      ...(details.cleanup !== undefined ? { cleanup: sanitizeRuntimeEventData(details.cleanup) } : {}),
      ...(details.spec !== undefined ? { spec: details.spec } : {}),
      state: nextState,
      status: nextState,
      reason,
      evidence,
    };
    const nextSubtasks = current.subtasks.map(subtask => subtask.id === subtaskId
      ? { ...candidateSubtask, updatedAt: current.updatedAt }
      : { ...subtask });
    const reconciled = reconcileSubtasks(nextSubtasks, { recoverBlockedIds: details.recoverBlockedIds });
    const nextStateForParent = GRAPH_STATE_SET.has(details.parentStateOverride)
      ? details.parentStateOverride
      : parentStateFor(current.state, reconciled);
    const effectiveBaseCommit = suppliedBaseCommit || current.baseCommit || current.parentTask?.baseCommit || null;
    const candidateGraph = {
      ...current,
      ...(effectiveBaseCommit ? { baseCommit: effectiveBaseCommit } : {}),
      state: nextStateForParent,
      status: nextStateForParent,
      reason: nextStateForParent === 'ERROR' ? boundedText(details.reason) || current.reason : current.reason,
      parentTask: {
        ...current.parentTask,
        ...(effectiveBaseCommit ? { baseCommit: effectiveBaseCommit } : {}),
        state: nextStateForParent,
        status: nextStateForParent,
      },
      subtasks: reconciled,
      frontier: frontierFor(reconciled, current.maxConcurrency),
    };
    const normalizeForComparison = item => ({
      ...item,
      updatedAt: null,
      parentTask: { ...item.parentTask, updatedAt: null },
      subtasks: item.subtasks.map(s => ({ ...s, updatedAt: null })),
    });
    const changed = !sameJson(normalizeForComparison(current), normalizeForComparison(candidateGraph));
    if (!changed) return { graph: current, changed: false, events: [] };
    const timestamp = now();
    const next = {
      ...candidateGraph,
      updatedAt: timestamp,
      parentTask: {
        ...candidateGraph.parentTask,
        updatedAt: timestamp,
      },
      subtasks: reconciled.map(subtask => subtask.id === subtaskId ? { ...subtask, updatedAt: timestamp } : subtask),
    };
    atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`, tmp);

    const beforeById = new Map(current.subtasks.map(subtask => [subtask.id, subtask]));
    const changedSubtasks = reconciled.filter(subtask => {
      const before = beforeById.get(subtask.id);
      return !before
        || before.state !== subtask.state
        || before.status !== subtask.status
        || !sameJson(before.reason, subtask.reason)
        || !sameJson(before.evidence, subtask.evidence)
        || !sameJson({ ...before, updatedAt: null }, { ...subtask, updatedAt: null });
    });
    // Record the requested transition first, then deterministic dependency
    // frontier transitions. This keeps an interruption-replayable causal
    // order while making automatic READY/WAITING/BLOCKED changes explicit.
    changedSubtasks.sort((left, right) => {
      if (left.id === subtaskId) return -1;
      if (right.id === subtaskId) return 1;
      return compareIds(left.id, right.id);
    });
    const events = changedSubtasks.map(subtask => {
      const before = beforeById.get(subtask.id);
      return appendRuntimeEvent(repository, {
        type: 'TASK_GRAPH_SUBTASK_STATE_CHANGED',
        taskId: parentTaskId,
        subtaskId: subtask.id,
        agentId: subtask.implementer,
        role: subtask.id === subtaskId ? 'implementer' : 'planner',
        data: {
          from: before?.state || null,
          to: subtask.state,
          reason: subtask.reason,
          evidence: subtask.evidence,
          parentState: nextStateForParent,
          triggerSubtaskId: subtaskId,
          derived: subtask.id !== subtaskId,
          baseCommit: subtask.baseCommit || null,
          worktreePath: subtask.worktreePath || null,
          branch: subtask.branch || null,
          ref: subtask.ref || null,
          sessionId: subtask.sessionId || null,
          effectiveCommand: subtask.effectiveCommand || subtask.command || null,
          resolvedCommand: subtask.resolvedCommand || null,
          implementationCommit: subtask.implementationCommit || null,
          lastError: subtask.lastError ? sanitizeRuntimeEventData(subtask.lastError) : null,
          recovery: subtask.recovery ? sanitizeRuntimeEventData(subtask.recovery) : null,
          cleanup: subtask.cleanup ? sanitizeRuntimeEventData(subtask.cleanup) : null,
          dispatch: subtask.dispatch ? sanitizeRuntimeEventData(subtask.dispatch) : null,
        },
      });
    });
    if (current.state !== nextStateForParent) {
      events.push(appendRuntimeEvent(repository, {
        type: 'TASK_GRAPH_STATUS_CHANGED',
        taskId: parentTaskId,
        subtaskId,
        agentId: current.parentTask.planner,
        role: 'planner',
        data: { from: current.state, to: nextStateForParent, subtaskId },
      }));
    }
    return { graph: next, changed: true, events };
  } finally {
    release();
  }
}

export function taskGraphSubtaskState(root, parentTaskId, subtaskId, nextState, details = {}) {
  return setTaskGraphSubtaskState(root, parentTaskId, subtaskId, nextState, details).graph;
}
