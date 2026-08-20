import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  assertContained,
  assertSafePath,
  atomicWrite,
  readInternalFile,
  safeInternalStat,
} from './config.mjs';
import { normalizeRuntimeError, runtimeError, serializeRuntimeError } from './runtime-contract.mjs';

export const TASK_STATUSES = Object.freeze([
  'CREATED',
  'PLANNING',
  'SPEC_READY',
  'IMPLEMENTING',
  'WAITING_IMPLEMENTER',
  'REVIEWING',
  'CHANGES_REQUESTED',
  'APPROVED',
  'ERROR',
  'STOPPED',
]);

const TASK_STATUS_SET = new Set(TASK_STATUSES);
const TERMINAL_TASK_STATUSES = new Set(['APPROVED', 'STOPPED']);

function now() {
  return new Date().toISOString();
}

export function taskStorePath(root) {
  return join(resolve(root), '.agent-bus', 'tasks');
}

function taskBusPath(root) {
  return join(resolve(root), '.agent-bus');
}

export function validateTaskId(id) {
  if (typeof id !== 'string' || !/^task-[a-zA-Z0-9][a-zA-Z0-9_-]{1,127}$/.test(id)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Invalid task id: ${id || '(empty)'}`, { recoverable: false });
  }
  return id;
}

export function ensureTaskStore(root) {
  const repository = resolve(root);
  const bus = taskBusPath(repository);
  if (!existsSync(bus)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Agent Bus is not initialized: ${bus}`, { recoverable: true });
  }
  assertSafePath(repository, bus);
  const tasks = taskStorePath(repository);
  assertContained(bus, tasks);
  mkdirSync(tasks, { recursive: true });
  assertSafePath(repository, tasks);
  return tasks;
}

function taskFile(root, id) {
  const tasks = ensureTaskStore(root);
  validateTaskId(id);
  const path = join(tasks, `${id}.json`);
  assertContained(tasks, path);
  return path;
}

function validateTaskRecord(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw runtimeError('TASK_STATE_CONFLICT', 'Task record must be a JSON object.', { recoverable: false });
  }
  for (const key of ['id', 'title', 'planner', 'implementer', 'reviewer', 'createdAt', 'updatedAt']) {
    if (typeof task[key] !== 'string' || task[key].trim() === '') {
      throw runtimeError('TASK_STATE_CONFLICT', `Task record is missing ${key}.`, { recoverable: false, taskId: task.id });
    }
  }
  validateTaskId(task.id);
  if (!TASK_STATUS_SET.has(task.status)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task ${task.id} has invalid status ${task.status}.`, { recoverable: false, taskId: task.id });
  }
  if (!Number.isInteger(task.round) || task.round < 1) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task ${task.id} has invalid round.`, { recoverable: false, taskId: task.id });
  }
  if (typeof task.spec !== 'string') task.spec = '';
  if (task.implementationCommit !== null && typeof task.implementationCommit !== 'string') task.implementationCommit = null;
  if (!Array.isArray(task.evidence)) task.evidence = [];
  if (task.lastError !== null && typeof task.lastError !== 'object') task.lastError = null;
  return task;
}

function writeTask(root, task) {
  validateTaskRecord(task);
  const destination = taskFile(root, task.id);
  const bus = taskBusPath(root);
  atomicWrite(destination, `${JSON.stringify(task, null, 2)}\n`, join(bus, 'tmp'));
  return task;
}

export function readTask(root, id) {
  const path = taskFile(root, id);
  if (!existsSync(path)) {
    throw runtimeError('TASK_NOT_FOUND', `Task not found: ${id}`, { recoverable: false, taskId: id });
  }
  try {
    safeInternalStat(taskStorePath(root), path);
    return validateTaskRecord(JSON.parse(readInternalFile(taskStorePath(root), path)));
  } catch (error) {
    if (error?.code === 'TASK_NOT_FOUND') throw error;
    if (error?.code === 'TASK_STATE_CONFLICT') throw error;
    throw runtimeError('TASK_STATE_CONFLICT', `Failed to load task ${id}: ${error.message || String(error)}`, { recoverable: false, taskId: id });
  }
}

export function listTasks(root) {
  const tasks = ensureTaskStore(root);
  const records = [];
  for (const name of readdirSync(tasks)) {
    if (!name.endsWith('.json')) continue;
    const path = join(tasks, name);
    safeInternalStat(tasks, path);
    try {
      records.push(validateTaskRecord(JSON.parse(readInternalFile(tasks, path))));
    } catch (error) {
      throw normalizeRuntimeError(error, 'TASK_STATE_CONFLICT');
    }
  }
  return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function resolveTaskId(root, id = null) {
  if (id) return validateTaskId(id);
  const tasks = listTasks(root);
  const candidate = tasks.find(task => !TERMINAL_TASK_STATUSES.has(task.status)) || tasks[0];
  if (!candidate) throw runtimeError('TASK_NOT_FOUND', 'No task exists for this project.', { recoverable: false });
  return candidate.id;
}

export function createTask(root, input = {}) {
  const tasks = ensureTaskStore(root);
  const title = `${input.title ?? input.task ?? ''}`.trim();
  if (!title) throw runtimeError('TASK_STATE_CONFLICT', 'Task title is required.', { recoverable: false });
  const task = {
    schemaVersion: 1,
    id: input.id ? validateTaskId(input.id) : `task-${randomUUID()}`,
    title,
    status: 'CREATED',
    round: Number.isInteger(input.round) && input.round > 0 ? input.round : 1,
    planner: `${input.planner || 'codex'}`,
    implementer: `${input.implementer || 'antigravity'}`,
    reviewer: `${input.reviewer || 'codex'}`,
    createdAt: now(),
    updatedAt: now(),
    spec: `${input.spec || ''}`,
    implementationCommit: input.implementationCommit || null,
    evidence: Array.isArray(input.evidence) ? input.evidence : [],
    lastError: input.lastError || null,
  };
  if (existsSync(join(tasks, `${task.id}.json`))) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task already exists: ${task.id}`, { recoverable: true, taskId: task.id });
  }
  return writeTask(root, task);
}

export function updateTask(root, id, update) {
  const current = readTask(root, id);
  const next = typeof update === 'function' ? update({ ...current }) : { ...current, ...update };
  next.id = current.id;
  next.updatedAt = now();
  return writeTask(root, next);
}

export function setTaskStatus(root, id, status, details = {}) {
  if (!TASK_STATUS_SET.has(status)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Unsupported task status: ${status}`, { recoverable: false, taskId: id });
  }
  return updateTask(root, id, task => ({
    ...task,
    ...details,
    status,
  }));
}

export function markTaskError(root, id, error, details = {}) {
  const normalized = normalizeRuntimeError(error);
  return updateTask(root, id, task => ({
    ...task,
    ...details,
    status: 'ERROR',
    lastError: serializeRuntimeError(normalized, { includeLegacy: true }),
  }));
}

export function resumeTask(root, id) {
  return updateTask(root, id, task => {
    if (task.status === 'APPROVED') {
      throw runtimeError('TASK_STATE_CONFLICT', `Approved task cannot be resumed: ${task.id}`, { recoverable: false, taskId: task.id });
    }
    if (task.status === 'ERROR' || task.status === 'STOPPED') {
      return {
        ...task,
        status: task.spec ? 'IMPLEMENTING' : 'PLANNING',
        round: task.round + 1,
        lastError: null,
      };
    }
    if (task.status === 'CREATED') return { ...task, status: 'PLANNING' };
    if (task.status === 'SPEC_READY') return { ...task, status: 'IMPLEMENTING' };
    return task;
  });
}

export function stopTask(root, id, reason = null) {
  return updateTask(root, id, task => {
    if (task.status === 'APPROVED') {
      throw runtimeError('TASK_STATE_CONFLICT', `Approved task cannot be stopped: ${task.id}`, { recoverable: false, taskId: task.id });
    }
    return { ...task, status: 'STOPPED', stopReason: reason ? `${reason}` : null };
  });
}

export function taskIsTerminal(task) {
  return TERMINAL_TASK_STATUSES.has(task?.status);
}
