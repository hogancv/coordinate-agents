import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  assertContained,
  assertSafePath,
  atomicWrite,
  readInternalFile,
  safeInternalStat,
} from './config.mjs';
import {
  jsonSuccess,
  normalizeRuntimeError,
  runtimeError,
  serializeRuntimeError,
} from './runtime-contract.mjs';
import { redactOutput } from '../adapters/executable.mjs';
import { runtimeSessionClose, runtimeSessionOpen } from './session-service.mjs';
import { listRecords } from './session-manager.mjs';
import { ROLE_PROMPT_VERSION, workspaceRolePrompt } from './role-prompts.mjs';

export const WORKSPACE_TASK_PROMPT_VERSION = ROLE_PROMPT_VERSION;
export const WORKSPACE_TASK_SLOTS = Object.freeze([
  Object.freeze({ slot: 'codex', agent: 'codex', role: 'planner-reviewer' }),
  Object.freeze({ slot: 'antigravity', agent: 'antigravity', role: 'implementer' }),
]);
export const WORKSPACE_TASK_STATUSES = Object.freeze([
  'STARTING',
  'RUNNING',
  'DEGRADED',
  'EXITED',
  'CLOSED',
  'ERROR',
]);

const ACTIVE_SESSION_STATES = new Set(['starting', 'running', 'idle', 'busy']);
const TERMINAL_SESSION_STATES = new Set(['exited', 'failed']);
const WORKSPACE_TASK_ID_PATTERN = /^workspace-[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const SESSION_ID_PATTERN = /^session_[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const MAX_ERROR_BYTES = 4 * 1024;
const MAX_HISTORY = 32;

function now() {
  return new Date().toISOString();
}

function localTitleTimestamp(date = new Date()) {
  const pad = value => `${value}`.padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function repositoryRoot(root) {
  const supplied = resolve(`${root || process.cwd()}`);
  try {
    const metadata = lstatSync(supplied);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', `Workspace root is not a regular directory: ${supplied}`, {
        recoverable: false,
        root: supplied,
      });
    }
  } catch (error) {
    if (error?.code === 'WORKSPACE_TASK_STATE_CONFLICT') throw error;
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', `Workspace root is unavailable: ${supplied}`, {
      recoverable: false,
      root: supplied,
    });
  }
  const repository = realpathSync(supplied);
  const bus = join(repository, '.agent-bus');
  if (!existsSync(bus)) {
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', `Agent Bus is not initialized: ${bus}`, {
      recoverable: true,
      root: repository,
    });
  }
  assertSafePath(repository, bus);
  return repository;
}

function workspaceTaskDirectory(root, { create = false } = {}) {
  const repository = repositoryRoot(root);
  const bus = join(repository, '.agent-bus');
  const directory = join(bus, 'workspace-tasks');
  assertContained(bus, directory);
  if (create) {
    mkdirSync(directory, { recursive: true });
    assertSafePath(repository, directory);
  } else if (existsSync(directory)) {
    const metadata = lstatSync(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', `Unsafe Workspace Task directory: ${directory}`, {
        recoverable: true,
        root: repository,
      });
    }
    assertSafePath(repository, directory);
  }
  return { repository, bus, directory };
}

export function workspaceTaskStorePath(root, options = {}) {
  return workspaceTaskDirectory(root, options).directory;
}

export function validateWorkspaceTaskId(id) {
  if (typeof id !== 'string' || !WORKSPACE_TASK_ID_PATTERN.test(id)) {
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', `Invalid Workspace Task id: ${id || '(empty)'}`, {
      recoverable: false,
      taskId: id || null,
    });
  }
  return id;
}

function validateSessionId(id, { allowNull = true } = {}) {
  if (id === null && allowNull) return null;
  if (typeof id !== 'string' || !SESSION_ID_PATTERN.test(id)) {
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', `Invalid Workspace Session id: ${id || '(empty)'}`, {
      recoverable: false,
    });
  }
  return id;
}

function defaultSessions() {
  return Object.fromEntries(WORKSPACE_TASK_SLOTS.map(({ slot, agent, role }) => [slot, {
    slot,
    agent,
    role,
    sessionId: null,
  }]));
}

function validateSessionSlot(slot, expected) {
  if (!slot || typeof slot !== 'object' || Array.isArray(slot)) {
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', `Workspace Task ${expected.slot} session slot is invalid.`, { recoverable: false });
  }
  if (slot.agent !== expected.agent || slot.role !== expected.role) {
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', `Workspace Task ${expected.slot} session slot is not the fixed ${expected.agent} role.`, { recoverable: false });
  }
  validateSessionId(slot.sessionId);
  return {
    slot: expected.slot,
    agent: expected.agent,
    role: expected.role,
    sessionId: slot.sessionId || null,
  };
}

function validateWorkspaceTaskRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', 'Workspace Task record must be a JSON object.', { recoverable: false });
  }
  if (value.schemaVersion !== 1) {
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', `Unsupported Workspace Task schemaVersion: ${value.schemaVersion}.`, { recoverable: false, taskId: value.id || null });
  }
  validateWorkspaceTaskId(value.id);
  for (const key of ['title', 'promptVersion', 'createdAt', 'updatedAt']) {
    if (typeof value[key] !== 'string' || value[key].trim() === '') {
      throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', `Workspace Task record is missing ${key}.`, {
        recoverable: false,
        taskId: value.id,
      });
    }
  }
  if (!WORKSPACE_TASK_STATUSES.includes(value.status)) {
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', `Workspace Task ${value.id} has invalid status ${value.status}.`, {
      recoverable: false,
      taskId: value.id,
    });
  }
  if (!value.sessions || typeof value.sessions !== 'object' || Array.isArray(value.sessions)) {
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', `Workspace Task ${value.id} is missing its session pair.`, {
      recoverable: false,
      taskId: value.id,
    });
  }
  const sessions = Object.fromEntries(WORKSPACE_TASK_SLOTS.map(expected => [
    expected.slot,
    validateSessionSlot(value.sessions[expected.slot], expected),
  ]));
  const sessionHistory = Array.isArray(value.sessionHistory)
    ? value.sessionHistory.slice(-MAX_HISTORY).map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      return {
        codexSessionId: entry.codexSessionId ? validateSessionId(entry.codexSessionId, { allowNull: false }) : null,
        antigravitySessionId: entry.antigravitySessionId ? validateSessionId(entry.antigravitySessionId, { allowNull: false }) : null,
        closedAt: typeof entry.closedAt === 'string' ? entry.closedAt : null,
      };
    }).filter(Boolean)
    : [];
  const error = value.error && typeof value.error === 'object' && !Array.isArray(value.error)
    ? serializeRuntimeError(value.error, { includeLegacy: true })
    : null;
  return {
    schemaVersion: 1,
    id: value.id,
    title: redactOutput(value.title, 512),
    status: value.status,
    promptVersion: redactOutput(value.promptVersion, 64),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    sessions,
    sessionHistory,
    error,
  };
}

function workspaceTaskFile(root, id, { create = false } = {}) {
  const { directory } = workspaceTaskDirectory(root, { create });
  validateWorkspaceTaskId(id);
  const path = join(directory, `${id}.json`);
  assertContained(directory, path);
  return path;
}

function writeWorkspaceTask(root, record) {
  const repository = repositoryRoot(root);
  const validated = validateWorkspaceTaskRecord(record);
  const path = workspaceTaskFile(repository, validated.id, { create: true });
  atomicWrite(path, `${JSON.stringify(validated, null, 2)}\n`, join(repository, '.agent-bus', 'tmp'));
  return validated;
}

function readWorkspaceTaskRecord(root, id) {
  const repository = repositoryRoot(root);
  const path = workspaceTaskFile(repository, id);
  if (!existsSync(path)) {
    throw runtimeError('WORKSPACE_TASK_NOT_FOUND', `Workspace Task not found: ${id}`, {
      recoverable: false,
      taskId: id,
      root: repository,
    });
  }
  try {
    const directory = workspaceTaskDirectory(repository).directory;
    safeInternalStat(directory, path);
    return validateWorkspaceTaskRecord(JSON.parse(readInternalFile(join(repository, '.agent-bus'), path)));
  } catch (error) {
    if (error?.code === 'WORKSPACE_TASK_NOT_FOUND' || error?.code === 'WORKSPACE_TASK_STATE_CONFLICT') throw error;
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', `Failed to load Workspace Task ${id}: ${error.message || String(error)}`, {
      recoverable: false,
      taskId: id,
      root: repository,
    });
  }
}

export function listWorkspaceTaskRecords(root) {
  const { directory } = workspaceTaskDirectory(root);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => {
      const path = join(directory, name);
      try {
        safeInternalStat(directory, path);
        return validateWorkspaceTaskRecord(JSON.parse(readInternalFile(directory, path)));
      } catch (error) {
        throw normalizeRuntimeError(error, 'WORKSPACE_TASK_STATE_CONFLICT');
      }
    })
    .sort((left, right) => `${right.updatedAt}`.localeCompare(`${left.updatedAt}`));
}

function normalizeLanguage(language) {
  return `${language || 'en'}`.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

function sessionFactMap(root) {
  const sessions = join(repositoryRoot(root), '.agent-bus', 'sessions');
  if (!existsSync(sessions)) return new Map();
  try {
    return new Map(listRecords(root).map(record => [record.id, record]));
  } catch {
    return new Map();
  }
}

function sessionView(slot, facts) {
  const fact = slot.sessionId ? facts.get(slot.sessionId) : null;
  return {
    slot: slot.slot,
    agent: slot.agent,
    role: slot.role,
    sessionId: slot.sessionId,
    state: fact?.state || null,
    status: fact?.state || null,
    createdAt: fact?.createdAt || null,
    lastActivityAt: fact?.lastActivityAt || null,
    exitCode: fact?.exitCode ?? null,
    signal: fact?.signal || null,
    error: fact?.error ? redactOutput(fact.error, MAX_ERROR_BYTES) : null,
  };
}

function statusFromFacts(record, sessions) {
  if (record.status === 'ERROR' || record.status === 'CLOSED') return record.status;
  const states = sessions.map(session => session.state).filter(Boolean);
  const active = states.filter(state => ACTIVE_SESSION_STATES.has(state)).length;
  if (active === 2) return 'RUNNING';
  if (active === 1) return 'DEGRADED';
  if (record.status === 'STARTING') return states.some(state => TERMINAL_SESSION_STATES.has(state)) ? 'ERROR' : 'STARTING';
  if (states.length === 2 && states.every(state => TERMINAL_SESSION_STATES.has(state))) return 'EXITED';
  return record.status;
}

function workspaceTaskView(record, facts = new Map()) {
  const sessions = Object.fromEntries(WORKSPACE_TASK_SLOTS.map(expected => [
    expected.slot,
    sessionView(record.sessions[expected.slot], facts),
  ]));
  return {
    id: record.id,
    title: record.title,
    status: statusFromFacts(record, Object.values(sessions)),
    promptVersion: record.promptVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sessions,
    sessionIds: Object.fromEntries(WORKSPACE_TASK_SLOTS.map(({ slot }) => [slot, record.sessions[slot].sessionId])),
    sessionHistory: record.sessionHistory,
    error: record.error,
  };
}

export async function readWorkspaceTasks(root) {
  const repository = repositoryRoot(root);
  const facts = sessionFactMap(repository);
  return listWorkspaceTaskRecords(repository).map(record => workspaceTaskView(record, facts));
}

export async function readWorkspaceTask(root, id) {
  const repository = repositoryRoot(root);
  const record = readWorkspaceTaskRecord(repository, id);
  return workspaceTaskView(record, sessionFactMap(repository));
}

async function closeSessionIds(root, sessionIds) {
  const results = [];
  const errors = [];
  for (const sessionId of [...new Set(sessionIds.filter(Boolean))]) {
    try {
      const result = await runtimeSessionClose({
        root,
        sessionId,
        graceful: false,
        timeoutMs: 1_000,
      });
      results.push(result.session || null);
    } catch (error) {
      errors.push(normalizeRuntimeError(error, 'WORKSPACE_TASK_CLOSE_FAILED'));
    }
  }
  return { results, errors };
}

function sessionIdsFor(record) {
  return WORKSPACE_TASK_SLOTS.map(({ slot }) => record.sessions[slot].sessionId).filter(Boolean);
}

function updateRecord(record, update = {}) {
  return {
    ...record,
    ...update,
    updatedAt: now(),
  };
}

function initialWorkspaceTask() {
  const id = `workspace-${randomUUID().replaceAll('-', '')}`;
  const timestamp = now();
  return {
    schemaVersion: 1,
    id,
    title: `Task · ${localTitleTimestamp()} · ${id.slice(-6)}`,
    status: 'STARTING',
    promptVersion: WORKSPACE_TASK_PROMPT_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    sessions: defaultSessions(),
    sessionHistory: [],
    error: null,
  };
}

async function discoverTaskSessions(root, taskId) {
  try {
    return listRecords(root).filter(record => record.taskId === taskId);
  } catch {
    return [];
  }
}

async function openWorkspaceSlot(root, record, slot, language) {
  const expected = WORKSPACE_TASK_SLOTS.find(item => item.slot === slot);
  const prompt = workspaceRolePrompt(expected.agent, language);
  const opened = await runtimeSessionOpen({
    root,
    agent: expected.agent,
    initialPrompt: prompt,
    language,
    taskId: record.id,
    subtaskId: slot,
    reuseExisting: false,
  });
  const sessionState = `${opened?.session?.state || ''}`;
  if (!opened?.session?.id || opened.reused || !ACTIVE_SESSION_STATES.has(sessionState)) {
    throw runtimeError('WORKSPACE_TASK_START_FAILED', `Workspace Task ${record.id} did not receive a fresh ${expected.agent} Session.`, {
      recoverable: true,
      taskId: record.id,
      agent: expected.agent,
      sessionId: opened?.session?.id || null,
      details: { state: sessionState || null },
    });
  }
  record.sessions[slot].sessionId = opened.session.id;
  writeWorkspaceTask(root, record);
  return opened.session;
}

async function rollbackTaskSessions(root, record) {
  const discovered = await discoverTaskSessions(root, record.id);
  return closeSessionIds(root, [
    ...sessionIdsFor(record),
    ...discovered.map(session => session.id),
  ]);
}

async function attachDiscoveredSessions(root, record) {
  const discovered = await discoverTaskSessions(root, record.id);
  for (const session of discovered) {
    const slot = WORKSPACE_TASK_SLOTS.find(item => item.agent === session.agent);
    if (slot && !record.sessions[slot.slot].sessionId) record.sessions[slot.slot].sessionId = session.id;
  }
  return discovered;
}

function failureRecord(record, error) {
  const normalized = normalizeRuntimeError(error, 'WORKSPACE_TASK_START_FAILED');
  return updateRecord(record, {
    status: 'ERROR',
    error: serializeRuntimeError(normalized, { includeLegacy: true }),
  });
}

function workspaceStartError(record, error) {
  const normalized = normalizeRuntimeError(error, 'WORKSPACE_TASK_START_FAILED');
  if (normalized.code === 'WORKSPACE_TASK_START_FAILED') return normalized;
  return runtimeError('WORKSPACE_TASK_START_FAILED', `Workspace Task ${record.id} could not start its terminal pair: ${normalized.message}`, {
    recoverable: normalized.recoverable,
    taskId: record.id,
    agent: normalized.agent,
    sessionId: normalized.sessionId,
    details: serializeRuntimeError(normalized, { includeLegacy: true }),
  });
}

export async function runtimeWorkspaceTaskCreate(input = {}) {
  const root = repositoryRoot(input.root);
  const language = normalizeLanguage(input.language);
  let record = initialWorkspaceTask();
  writeWorkspaceTask(root, record);
  try {
    await openWorkspaceSlot(root, record, 'codex', language);
    await openWorkspaceSlot(root, record, 'antigravity', language);
    record = updateRecord(record, { status: 'RUNNING', error: null });
    writeWorkspaceTask(root, record);
    return jsonSuccess('workspace.task.create', {
      workspaceTask: workspaceTaskView(record, sessionFactMap(root)),
    });
  } catch (error) {
    await attachDiscoveredSessions(root, record);
    const rollback = await rollbackTaskSessions(root, record);
    const normalized = workspaceStartError(record, error);
    if (rollback.errors.length > 0) normalized.details = {
      startup: normalized.details,
      rollback: rollback.errors.map(item => serializeRuntimeError(item, { includeLegacy: true })),
    };
    record = failureRecord(record, normalized);
    writeWorkspaceTask(root, record);
    throw normalized;
  }
}

export async function runtimeWorkspaceTaskClose(input = {}) {
  const root = repositoryRoot(input.root);
  let record = readWorkspaceTaskRecord(root, input.workspaceTaskId || input.id);
  const closed = await closeSessionIds(root, sessionIdsFor(record));
  record.status = 'CLOSED';
  record.error = closed.errors.length > 0
    ? serializeRuntimeError(closed.errors[0], { includeLegacy: true })
    : null;
  record.updatedAt = now();
  writeWorkspaceTask(root, record);
  return jsonSuccess('workspace.task.close', {
    workspaceTask: workspaceTaskView(record, sessionFactMap(root)),
    closedSessions: closed.results,
    closeErrors: closed.errors.map(error => serializeRuntimeError(error, { includeLegacy: true })),
  });
}

export async function runtimeWorkspaceTaskRestart(input = {}) {
  const root = repositoryRoot(input.root);
  const language = normalizeLanguage(input.language);
  let record = readWorkspaceTaskRecord(root, input.workspaceTaskId || input.id);
  const oldSessionIds = sessionIdsFor(record);
  const closed = await closeSessionIds(root, oldSessionIds);
  const stillActive = closed.results.filter(session => ACTIVE_SESSION_STATES.has(`${session?.state || ''}`));
  if (closed.errors.length > 0 || stillActive.length > 0) {
    const error = closed.errors[0] || runtimeError('WORKSPACE_TASK_CLOSE_FAILED', `Workspace Task ${record.id} still has an active Session.`, {
      recoverable: true,
      taskId: record.id,
    });
    record.status = 'ERROR';
    record.error = serializeRuntimeError(error, { includeLegacy: true });
    record.updatedAt = now();
    writeWorkspaceTask(root, record);
    throw error;
  }

  if (oldSessionIds.length > 0) {
    record.sessionHistory = [
      ...record.sessionHistory,
      {
        codexSessionId: record.sessions.codex.sessionId,
        antigravitySessionId: record.sessions.antigravity.sessionId,
        closedAt: now(),
      },
    ].slice(-MAX_HISTORY);
  }
  record.sessions = defaultSessions();
  record.status = 'STARTING';
  record.error = null;
  record.updatedAt = now();
  writeWorkspaceTask(root, record);
  try {
    await openWorkspaceSlot(root, record, 'codex', language);
    await openWorkspaceSlot(root, record, 'antigravity', language);
    record = updateRecord(record, { status: 'RUNNING', error: null });
    writeWorkspaceTask(root, record);
    return jsonSuccess('workspace.task.restart', {
      workspaceTask: workspaceTaskView(record, sessionFactMap(root)),
      closedSessions: closed.results,
    });
  } catch (error) {
    await attachDiscoveredSessions(root, record);
    const rollback = await rollbackTaskSessions(root, record);
    const normalized = workspaceStartError(record, error);
    if (rollback.errors.length > 0) normalized.details = {
      startup: normalized.details,
      rollback: rollback.errors.map(item => serializeRuntimeError(item, { includeLegacy: true })),
    };
    record = failureRecord(record, normalized);
    writeWorkspaceTask(root, record);
    throw normalized;
  }
}

export { validateWorkspaceTaskRecord };
