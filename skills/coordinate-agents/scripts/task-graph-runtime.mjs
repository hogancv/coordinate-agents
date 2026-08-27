import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  acquireConfigLock,
  assertContained,
  assertSafePath,
  atomicWrite,
  readInternalFile,
  safeInternalStat,
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
export const TASK_GRAPH_MAX_REASON_BYTES = 8 * 1024;
export const TASK_GRAPH_MAX_EVIDENCE_ITEMS = 64;
export const TASK_GRAPH_EVENT_LIMIT = 100;

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

function graphBusPath(root) {
  return join(resolve(root), '.agent-bus');
}

export function taskGraphStorePath(root) {
  const repository = resolve(root);
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

function ensureGraphStore(root, { create = false } = {}) {
  const repository = resolve(root);
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
      reason: boundedText(record.parentTask.reason || record.reason),
      evidence: boundedEvidence(record.parentTask.evidence || record.evidence),
    },
    subtasks: base.subtasks.map(fact => {
      const subtask = record.subtasks.find(item => item.id === fact.subtaskId);
      return {
        ...fact,
        title: subtask?.title,
        spec: subtask?.spec,
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
    const reason = details.reason === undefined ? target.reason : boundedText(details.reason);
    const evidence = details.evidence === undefined ? target.evidence : boundedEvidence(details.evidence);
    const beforeState = target.state;
    if (beforeState === nextState && sameJson(target.reason, reason) && sameJson(target.evidence, evidence)) {
      return { graph: current, changed: false, events: [] };
    }
    const nextSubtasks = current.subtasks.map(subtask => subtask.id === subtaskId
      ? {
        ...subtask,
        state: nextState,
        status: nextState,
        reason,
        evidence,
        updatedAt: now(),
      }
      : { ...subtask });
    const reconciled = reconcileSubtasks(nextSubtasks);
    const nextStateForParent = parentStateFor(current.state, reconciled);
    const timestamp = now();
    const next = {
      ...current,
      state: nextStateForParent,
      status: nextStateForParent,
      reason: nextStateForParent === 'ERROR' ? boundedText(details.reason) || current.reason : current.reason,
      updatedAt: timestamp,
      parentTask: {
        ...current.parentTask,
        state: nextStateForParent,
        status: nextStateForParent,
        updatedAt: timestamp,
      },
      subtasks: reconciled,
      frontier: frontierFor(reconciled, current.maxConcurrency),
    };
    const changed = !sameJson(current, next);
    if (changed) atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`, tmp);
    if (!changed) return { graph: current, changed: false, events: [] };

    const beforeById = new Map(current.subtasks.map(subtask => [subtask.id, subtask]));
    const changedSubtasks = reconciled.filter(subtask => {
      const before = beforeById.get(subtask.id);
      return !before
        || before.state !== subtask.state
        || before.status !== subtask.status
        || !sameJson(before.reason, subtask.reason)
        || !sameJson(before.evidence, subtask.evidence);
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
