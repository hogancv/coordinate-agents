import { createHash, randomUUID } from 'node:crypto';
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
import { redactOutput } from '../adapters/executable.mjs';

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

export const TASK_TRANSITIONS = Object.freeze({
  CREATED: Object.freeze(['PLANNING', 'SPEC_READY', 'IMPLEMENTING', 'ERROR', 'STOPPED']),
  PLANNING: Object.freeze(['SPEC_READY', 'IMPLEMENTING', 'ERROR', 'STOPPED']),
  SPEC_READY: Object.freeze(['IMPLEMENTING', 'ERROR', 'STOPPED']),
  IMPLEMENTING: Object.freeze(['WAITING_IMPLEMENTER', 'REVIEWING', 'ERROR', 'STOPPED']),
  WAITING_IMPLEMENTER: Object.freeze(['REVIEWING', 'ERROR', 'STOPPED']),
  REVIEWING: Object.freeze(['APPROVED', 'CHANGES_REQUESTED', 'ERROR', 'STOPPED']),
  CHANGES_REQUESTED: Object.freeze(['IMPLEMENTING', 'ERROR', 'STOPPED']),
  ERROR: Object.freeze(['PLANNING', 'SPEC_READY', 'STOPPED']),
  STOPPED: Object.freeze(['PLANNING', 'SPEC_READY']),
  APPROVED: Object.freeze([]),
});

export const TASK_DISPATCHABLE_STATUSES = Object.freeze([
  'CREATED',
  'PLANNING',
  'SPEC_READY',
  'CHANGES_REQUESTED',
]);

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
  if (task.sessionId !== null && typeof task.sessionId !== 'string') task.sessionId = null;
  if (!Object.prototype.hasOwnProperty.call(task, 'sessionId')) task.sessionId = null;
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
    sessionId: input.sessionId || null,
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

export function assertTaskTransition(currentStatus, nextStatus, taskId = null) {
  if (currentStatus === nextStatus) return true;
  if (!TASK_STATUS_SET.has(currentStatus) || !TASK_STATUS_SET.has(nextStatus)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Invalid Task transition ${currentStatus} -> ${nextStatus}.`, { recoverable: false, taskId });
  }
  if (!TASK_TRANSITIONS[currentStatus]?.includes(nextStatus)) {
    const code = ['IMPLEMENTING', 'WAITING_IMPLEMENTER'].includes(currentStatus)
      ? 'TASK_ALREADY_RUNNING'
      : 'TASK_STATE_CONFLICT';
    throw runtimeError(code, `Task ${taskId || ''} cannot transition from ${currentStatus} to ${nextStatus}.`.trim(), {
      recoverable: false,
      taskId,
    });
  }
  return true;
}

export function setTaskStatus(root, id, status, details = {}) {
  if (!TASK_STATUS_SET.has(status)) {
    throw runtimeError('TASK_STATE_CONFLICT', `Unsupported task status: ${status}`, { recoverable: false, taskId: id });
  }
  return updateTask(root, id, task => {
    assertTaskTransition(task.status, status, task.id);
    return {
      ...task,
      ...details,
      status,
    };
  });
}

export function prepareTaskForDispatch(root, id, spec = undefined) {
  let task = readTask(root, id);
  if (!TASK_DISPATCHABLE_STATUSES.includes(task.status)) {
    if (task.status === 'ERROR') {
      throw runtimeError('TASK_STATE_CONFLICT', `Task ${task.id} is in ERROR; run task resume before dispatch.`, {
        recoverable: true,
        taskId: task.id,
      });
    }
    if (['IMPLEMENTING', 'WAITING_IMPLEMENTER'].includes(task.status)) {
      throw runtimeError('TASK_ALREADY_RUNNING', `Task ${task.id} is already running.`, {
        recoverable: false,
        taskId: task.id,
      });
    }
    throw runtimeError('TASK_STATE_CONFLICT', `Task ${task.id} cannot be dispatched from ${task.status}.`, {
      recoverable: false,
      taskId: task.id,
    });
  }

  if (spec !== undefined) {
    const nextSpec = `${spec}`.trim();
    if (!nextSpec) {
      throw runtimeError('TASK_STATE_CONFLICT', `Task ${task.id} requires a non-empty specification.`, {
        recoverable: false,
        taskId: task.id,
      });
    }
    task = updateTask(root, id, current => ({ ...current, spec: nextSpec }));
  }
  if (!`${task.spec || ''}`.trim()) {
    throw runtimeError('TASK_STATE_CONFLICT', `Task ${task.id} requires an approved specification before dispatch.`, {
      recoverable: false,
      taskId: task.id,
    });
  }
  if (task.status === 'CREATED' || task.status === 'PLANNING') {
    task = setTaskStatus(root, id, 'SPEC_READY');
  }
  return task;
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
      const nextStatus = task.spec ? 'SPEC_READY' : 'PLANNING';
      assertTaskTransition(task.status, nextStatus, task.id);
      return {
        ...task,
        status: nextStatus,
        round: task.round + 1,
        lastError: null,
      };
    }
    if (task.status === 'CREATED') {
      assertTaskTransition(task.status, 'PLANNING', task.id);
      return { ...task, status: 'PLANNING' };
    }
    if (task.status === 'SPEC_READY') return task;
    return task;
  });
}

function parseBusMessage(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^"|"$/g, '');
  }
  return { fields, body: match[2].trim() };
}

function implementationCommit(fields, body) {
  if (fields.related_commit && /^[a-zA-Z0-9._/-]{4,128}$/.test(fields.related_commit)) return fields.related_commit;
  const match = body.match(/(?:implementationCommit|implementation[-_ ]commit|commit)\s*[:=]\s*([a-f0-9]{7,64})/i);
  return match ? match[1] : null;
}

function evidenceId(messagePath, fields) {
  return fields.id || createHash('sha256').update(messagePath).digest('hex').slice(0, 16);
}

function escapeRegex(value) {
  return `${value}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function implementationMessages(root, task) {
  const bus = taskBusPath(root);
  const inbox = join(bus, 'inbox', task.planner);
  const messages = [];
  for (const stage of ['new', 'processing', 'processed']) {
    const directory = join(inbox, stage);
    if (!existsSync(directory)) continue;
    for (const name of readdirSync(directory).filter(item => item.endsWith('.md')).sort()) {
      const path = join(directory, name);
      try {
        safeInternalStat(bus, path);
        const parsed = parseBusMessage(readInternalFile(taskBusPath(root), path));
        if (!parsed || parsed.fields.type !== 'IMPLEMENTATION_DONE') continue;
        if (parsed.fields.from !== task.implementer || parsed.fields.to !== task.planner) continue;
        const refersToTask = parsed.fields.dedupe_key?.includes(task.id)
          || new RegExp(`(?:^|\\n)Task ID\\s*:\\s*${escapeRegex(task.id)}(?:\\s|$)`, 'i').test(parsed.body);
        if (!refersToTask) continue;
        messages.push({ path, ...parsed });
      } catch {
        // Invalid or quarantined messages are Agent Bus diagnostics, not a
        // reason to make an unrelated Task unreadable.
      }
    }
  }
  return messages.sort((a, b) => `${a.fields.created_at || ''}`.localeCompare(`${b.fields.created_at || ''}`));
}

/**
 * Promote a durable IMPLEMENTATION_DONE message into the product-facing Task
 * record.  The Bus remains the transport; this function is the explicit
 * mapping that prevents the two state surfaces from drifting.
 */
export function syncTaskFromAgentBus(root, id) {
  const task = readTask(root, id);
  if (!['IMPLEMENTING', 'WAITING_IMPLEMENTER'].includes(task.status)) return task;
  const message = implementationMessages(root, task).at(-1);
  if (!message) return task;
  const idValue = evidenceId(message.path, message.fields);
  if (task.implementationMessage?.id === idValue) return task;
  const commit = implementationCommit(message.fields, message.body);
  const evidence = {
    type: 'IMPLEMENTATION_DONE',
    id: idValue,
    path: resolve(message.path),
    relatedCommit: commit,
    details: redactOutput(message.body, 8 * 1024),
    createdAt: message.fields.created_at || now(),
  };
  return setTaskStatus(root, id, 'REVIEWING', {
    implementationCommit: commit || task.implementationCommit || null,
    evidence: [...(Array.isArray(task.evidence) ? task.evidence : []), evidence],
    implementationMessage: {
      id: idValue,
      type: message.fields.type,
      from: message.fields.from,
      to: message.fields.to,
      path: resolve(message.path),
    },
    lastError: null,
  });
}

export function recordReviewDecision(root, id, decision, { feedback = '', evidence = null } = {}) {
  const task = readTask(root, id);
  if (task.status !== 'REVIEWING') {
    throw runtimeError('TASK_STATE_CONFLICT', `Task ${task.id} must be REVIEWING before a review decision.`, {
      recoverable: false,
      taskId: task.id,
    });
  }
  const normalizedDecision = `${decision || ''}`.trim().toUpperCase();
  const reviewRecord = {
    decision: normalizedDecision,
    feedback: `${feedback || ''}`.trim(),
    implementationCommit: task.implementationCommit || null,
    evidence: evidence || null,
    round: task.round,
    decidedAt: now(),
  };
  if (normalizedDecision === 'REVIEW_APPROVED') {
    return setTaskStatus(root, id, 'APPROVED', {
      reviewDecision: normalizedDecision,
      reviewFeedback: reviewRecord.feedback,
      reviewHistory: [...(Array.isArray(task.reviewHistory) ? task.reviewHistory : []), reviewRecord],
    });
  }
  if (normalizedDecision === 'CHANGES_REQUESTED') {
    if (!reviewRecord.feedback) {
      throw runtimeError('TASK_STATE_CONFLICT', 'CHANGES_REQUESTED requires review feedback.', {
        recoverable: false,
        taskId: task.id,
      });
    }
    return setTaskStatus(root, id, 'CHANGES_REQUESTED', {
      round: task.round + 1,
      reviewDecision: normalizedDecision,
      reviewFeedback: reviewRecord.feedback,
      reviewHistory: [...(Array.isArray(task.reviewHistory) ? task.reviewHistory : []), reviewRecord],
    });
  }
  throw runtimeError('TASK_STATE_CONFLICT', `Unsupported review decision: ${decision || '(empty)'}`, {
    recoverable: false,
    taskId: task.id,
  });
}

export function stopTask(root, id, reason = null) {
  return updateTask(root, id, task => {
    if (task.status === 'APPROVED') {
      throw runtimeError('TASK_STATE_CONFLICT', `Approved task cannot be stopped: ${task.id}`, { recoverable: false, taskId: task.id });
    }
    assertTaskTransition(task.status, 'STOPPED', task.id);
    return { ...task, status: 'STOPPED', stopReason: reason ? `${reason}` : null };
  });
}

export function taskIsTerminal(task) {
  return TERMINAL_TASK_STATUSES.has(task?.status);
}
