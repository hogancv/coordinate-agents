import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
  TASK_GRAPH_STATES,
  TASK_GRAPH_SUBTASK_STATES,
  taskGraphDurableFacts,
  validateTaskGraphV1,
} from './task-graph-contract.mjs';
import { runtimeError } from './runtime-contract.mjs';
import {
  appendRuntimeEvent,
  readRuntimeEvents,
  sanitizeRuntimeEventData,
} from './runtime-events.mjs';
import { validateTaskId } from './task-runtime.mjs';

export const TASK_GRAPH_STORE_DIRECTORY = 'task-graphs';
export const TASK_GRAPH_WORKTREES_DIRECTORY = 'worktrees';
export const TASK_GRAPH_MAX_REASON_BYTES = 8 * 1024;
export const TASK_GRAPH_MAX_EVIDENCE_ITEMS = 64;
export const TASK_GRAPH_EVENT_LIMIT = 100;
const SUBTASK_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const COMMIT_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

const GRAPH_STATE_SET = new Set(TASK_GRAPH_STATES);
const SUBTASK_STATE_SET = new Set(TASK_GRAPH_SUBTASK_STATES);
const TERMINAL_SUBTASK_STATES = new Set(['SUCCEEDED', 'FAILED', 'STOPPED']);
const FAILED_SUBTASK_STATES = new Set(['FAILED', 'BLOCKED', 'STOPPED']);
// PENDING/READY/WAITING are frontier states derived from dependency facts.
// BLOCKED is also a valid explicit state (for an unschedulable subtask), so
// preserve it rather than silently recomputing it as READY/WAITING.
const NON_EXECUTING_SUBTASK_STATES = new Set(['PENDING', 'READY', 'WAITING']);

function now() {
  return new Date().toISOString();
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

export function captureGraphBaseCommit(root) {
  const repository = repositoryRoot(root);
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
  });
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

function pathMatches(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
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
  const resolved = spawnSync('git', ['rev-parse', '--verify', `${candidate}^{commit}`], {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
  });
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
    const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8', windowsHide: true });
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
    const listResult = spawnSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repository,
      encoding: 'utf8',
      windowsHide: true,
    });
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
  const listResult = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
  });
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

  const branchCheck = spawnSync('git', ['rev-parse', '--verify', branchRef], {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
  });
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

  const addResult = spawnSync('git', addArgs, {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
  });

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
  const verifyResult = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repository,
    encoding: 'utf8',
    windowsHide: true,
  });
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

function reconcileSubtasks(subtasks) {
  const byId = new Map(subtasks.map(subtask => [subtask.id, subtask]));
  return subtasks
    .map(subtask => {
      if (!NON_EXECUTING_SUBTASK_STATES.has(subtask.state)) return { ...subtask };
      const derived = deriveFrontierState(subtask, byId);
      return {
        ...subtask,
        state: derived.state,
        status: derived.state,
        reason: derived.reason,
      };
    })
    .sort((left, right) => compareIds(left.id, right.id));
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

function graphRecordFromValidated(validated) {
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
    createdAt: timestamp,
    updatedAt: timestamp,
    subtasks: reconciled,
    frontier: frontierFor(reconciled, validated.maxConcurrency),
  };
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
  if (!Number.isInteger(record.maxConcurrency) || record.maxConcurrency < 1) {
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
  if (!plainObject(record.parentTask) || record.parentTask.id !== id) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has an invalid parent Task record.`, { recoverable: false, taskId: id });
  }
  if (!Array.isArray(record.subtasks) || record.subtasks.length === 0) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has no subtask records.`, { recoverable: false, taskId: id });
  }
  const ids = new Set();
  for (const subtask of record.subtasks) {
    if (!plainObject(subtask) || typeof subtask.id !== 'string' || ids.has(subtask.id)) {
      throw runtimeError('TASK_STATE_CONFLICT', `Task Graph ${id} has duplicate or malformed subtask records.`, { recoverable: false, taskId: id });
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

export function createTaskGraph(root, input, { configuredAgents = [], validated = false } = {}) {
  const graph = validated ? graphInputFromRecord(input) : input;
  const normalized = validated
    ? input
    : validateTaskGraphV1(graph, { configuredAgents });
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
    const record = graphRecordFromValidated(normalized);
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
    ...(inspect ? { events } : {}),
  };
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
      ...(details.spec !== undefined ? { spec: details.spec } : {}),
      state: nextState,
      status: nextState,
      reason,
      evidence,
    };
    const nextSubtasks = current.subtasks.map(subtask => subtask.id === subtaskId
      ? { ...candidateSubtask, updatedAt: current.updatedAt }
      : { ...subtask });
    const reconciled = reconcileSubtasks(nextSubtasks);
    const nextStateForParent = parentStateFor(current.state, reconciled);
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
