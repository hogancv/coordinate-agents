import { collaborationTransition, validateCollaborationEvents } from './workspace-collaboration.mjs';
import { notifyWorkspaceReceipt } from './workspace-notifications.mjs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';
import {
  acquireConfigLock,
  assertContained,
  assertSafePath,
  atomicWrite,
  readInternalFile,
  reapDeadConfigOwner,
  safeInternalStat,
} from './config.mjs';
import {
  jsonSuccess,
  normalizeRuntimeError,
  runtimeError,
  serializeRuntimeError,
} from './runtime-contract.mjs';
import { redactOutput } from '../adapters/executable.mjs';
import { getExecutionSessionManager, runtimeSessionClose, runtimeSessionOpen, runtimeWorkspaceCustomSessionOpen } from './session-service.mjs';
import { resolveCustomTaskConfig, validateCustomWorkspaceConfig, composeCustomPrompt, customPromptInput } from './workspace-custom-config.mjs';
import { listRecords, readRecord } from './session-manager.mjs';
import { WORKSPACE_ROLE_PROMPT_VERSION, workspaceRolePrompt } from './workspace-role-prompts.mjs';
import { codexConversationId, readCodexConversation } from './codex-conversation.mjs';
import { manualConfirmationCurrent, resumeStateFromSessions, workspaceResumeView, validateRoundRuntime, validateWorkspaceResume } from './workspace-resume-state.mjs';
import { applyNativeIdentityObservation, createNativeIdentityReceiver, nativeIdentityView,
  validateNativeConversations, validateRuntimeGeneration } from './workspace-native-identity.mjs';

export const WORKSPACE_TASK_PROMPT_VERSION = WORKSPACE_ROLE_PROMPT_VERSION;
export const WORKSPACE_TASK_SLOTS = Object.freeze([
  Object.freeze({ slot: 'codex', agent: 'codex', role: 'planner-reviewer' }),
  Object.freeze({ slot: 'antigravity', agent: 'antigravity', role: 'implementer' }),
]);
const CUSTOM_TASK_SLOTS = Object.freeze(['terminal1', 'terminal2'].map(slot => Object.freeze({ slot, agent: 'workspace-custom', role: 'custom' })));
function taskSlots(record) { return record.mode === 'custom' ? CUSTOM_TASK_SLOTS : WORKSPACE_TASK_SLOTS; }
function sessionBelongsToTask(root, record, session, expected = null) {
  const slot = expected || taskSlots(record).find(item => item.agent === session.agent && (record.mode !== 'custom' || item.slot === session.subtaskId));
  return Boolean(slot && session.taskId === record.id && session.agent === slot.agent
    && (record.mode !== 'custom' || session.subtaskId === slot.slot)
    && repositoryRoot(session.cwd) === repositoryRoot(root));
}
export const WORKSPACE_TASK_STATUSES = Object.freeze([
  'STARTING',
  'AWAITING_INPUT',
  'RUNNING',
  'DEGRADED',
  'EXITED',
  'CLOSED',
  'ERROR',
]);

export const WORKSPACE_COOPERATION_STATUSES = Object.freeze([
  'IDLE', 'SENT', 'WORKING', 'DONE', 'REVIEWING', 'APPROVED', 'CHANGES_REQUESTED', 'FAILED',
]);
const ROUND_ID_PATTERN = /^round-[a-zA-Z0-9_-]{1,128}$/;
const REPORT_TRANSITIONS = {
  SENT: ['WORKING', 'DONE', 'FAILED'],
  WORKING: ['DONE', 'FAILED'],
  DONE: ['REVIEWING', 'FAILED'],
  REVIEWING: ['APPROVED', 'CHANGES_REQUESTED', 'FAILED'],
};

const STARTUP_STATES = new Set(['WAITING', 'TRUST_REQUIRED', 'AUTH_REQUIRED', 'INJECTING', 'READY']);
function initialStartup(language) {
  return { language, slots: { codex: 'WAITING', antigravity: 'WAITING' } };
}
function validateStartup(value) {
  if (value === undefined || value === null) return null; // Legacy pairs already received their prompts.
  if (!value || !['en', 'zh-CN'].includes(value.language) || !value.slots
    || WORKSPACE_TASK_SLOTS.some(({ slot }) => !STARTUP_STATES.has(value.slots[slot]))) {
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', 'Invalid Workspace startup state.', { recoverable: false });
  }
  return { language: value.language, slots: Object.fromEntries(WORKSPACE_TASK_SLOTS.map(({ slot }) => [slot, value.slots[slot]])) };
}
function startupStatus(record) {
  const states = Object.values(record.startup.slots);
  return states.every(state => state === 'READY') ? 'RUNNING'
    : states.some(state => ['TRUST_REQUIRED', 'AUTH_REQUIRED'].includes(state)) ? 'AWAITING_INPUT' : 'STARTING';
}

function idleCooperation(revision = 0) {
  return { status: 'IDLE', roundId: null, revision, summary: '', updatedAt: null };
}

function validateCooperation(value) {
  if (value === undefined) return idleCooperation(); // Existing task records remain readable.
  if (!value || !WORKSPACE_COOPERATION_STATUSES.includes(value.status)
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || (value.status === 'IDLE' ? value.roundId !== null : !ROUND_ID_PATTERN.test(value.roundId || ''))
    || typeof value.summary !== 'string' || Buffer.byteLength(value.summary) > 2048
    || (value.updatedAt !== null && (typeof value.updatedAt !== 'string' || Number.isNaN(Date.parse(value.updatedAt))))) {
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', 'Invalid Workspace cooperation state.', { recoverable: false });
  }
  return { status: value.status, roundId: value.roundId, revision: value.revision,
    summary: redactOutput(value.summary, 2048), updatedAt: value.updatedAt };
}

const ACTIVE_SESSION_STATES = new Set(['starting', 'running', 'idle', 'busy']);
const EXECUTOR_RECEIPT_TASK_STATUSES = new Set(['STARTING', 'AWAITING_INPUT', 'RUNNING', 'DEGRADED']);
const TERMINAL_SESSION_STATES = new Set(['exited', 'failed']);
const WORKSPACE_TASK_ID_PATTERN = /^workspace-[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const SESSION_ID_PATTERN = /^session_[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const MAX_ERROR_BYTES = 4 * 1024;
const MAX_HISTORY = 32;
// Recent events stay in the Task transaction; older events are immutable pages.
const COLLABORATION_PAGE_SIZE = 128;
const WORKSPACE_STARTUP_TIMEOUT_MS = 20_000;
const WORKSPACE_READY_QUIET_MS = 900;
const ANSI_ESCAPE_PATTERN = /(?:\u001B\][^\u0007]*?(?:\u0007|\u001B\\)|\u001B\[[0-?]*[ -/]*[@-~]|\u001B[@-_]|\u009B[0-?]*[ -/]*[@-~])/g;

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
  const repository = realpathSync.native(supplied);
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

function defaultSessions(record = {}) {
  return Object.fromEntries(taskSlots(record).map(({ slot, agent, role }) => [slot, {
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
  if (slot.runtimeGeneration !== undefined && !slot.sessionId) {
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', 'Runtime generation requires a Session association.', { recoverable: false });
  }
  return {
    slot: expected.slot,
    agent: expected.agent,
    role: expected.role,
    sessionId: slot.sessionId || null,
    ...(slot.runtimeGeneration !== undefined ? { runtimeGeneration: validateRuntimeGeneration(slot.runtimeGeneration) } : {}),
  };
}

function validateWorkspaceTaskRecord(value, { root } = {}) {
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
  const mode = value.mode === undefined ? 'default' : value.mode;
  if (!['default', 'custom'].includes(mode)) throw new Error('Invalid Workspace task mode.');
  const custom = mode === 'custom' ? validateCustomWorkspaceConfig(value.custom) : null;
  if (mode === 'custom' && (value.cooperation != null || value.startup != null || (value.collaborationEvents != null && (!Array.isArray(value.collaborationEvents) || value.collaborationEvents.length)))) throw new Error('Custom tasks cannot contain default collaboration startup or rounds.');
  const cooperation = mode === 'custom' ? null : validateCooperation(value.cooperation);
  const collaborationEvents = mode === 'custom' ? [] : validateCollaborationEvents(value.collaborationEvents, value.id, cooperation.revision);
  const collaborationArchive = value.collaborationArchive ?? { pageCount: 0, eventCount: 0, lastRevision: 0 };
  if (!collaborationArchive || !Number.isSafeInteger(collaborationArchive.pageCount) || collaborationArchive.pageCount < 0
    || !Number.isSafeInteger(collaborationArchive.eventCount) || collaborationArchive.eventCount !== collaborationArchive.pageCount * COLLABORATION_PAGE_SIZE
    || !Number.isSafeInteger(collaborationArchive.lastRevision) || collaborationArchive.lastRevision < 0
    || (collaborationArchive.pageCount === 0 ? collaborationArchive.lastRevision !== 0
      : mode === 'custom' || collaborationArchive.lastRevision < collaborationArchive.eventCount || collaborationArchive.lastRevision > cooperation.revision)
    || (collaborationEvents.length && collaborationEvents[0].revision <= collaborationArchive.lastRevision)) {
    throw new Error('Invalid Workspace collaboration archive.');
  }
  const slots = taskSlots({ mode });
  if (Object.keys(value.sessions).some(slot => !slots.some(expected => expected.slot === slot))) throw new Error('Unexpected Workspace task slot.');
  const sessions = Object.fromEntries(slots.map(expected => [
    expected.slot,
    validateSessionSlot(value.sessions[expected.slot], expected),
  ]));
  const ids = Object.values(sessions).map(session => session.sessionId).filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new Error('Workspace terminals must have distinct Sessions.');
  const sessionHistory = Array.isArray(value.sessionHistory)
    ? value.sessionHistory.slice(-MAX_HISTORY).map(entry => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      return {
        ...(mode === 'custom' ? {
          terminal1SessionId: entry.terminal1SessionId ? validateSessionId(entry.terminal1SessionId, { allowNull: false }) : null,
          terminal2SessionId: entry.terminal2SessionId ? validateSessionId(entry.terminal2SessionId, { allowNull: false }) : null,
        } : {
        codexSessionId: entry.codexSessionId ? validateSessionId(entry.codexSessionId, { allowNull: false }) : null,
        antigravitySessionId: entry.antigravitySessionId ? validateSessionId(entry.antigravitySessionId, { allowNull: false }) : null,
        }),
        closedAt: typeof entry.closedAt === 'string' ? entry.closedAt : null,
      };
    }).filter(Boolean)
    : [];
  if (value.archivedAt !== undefined && (typeof value.archivedAt !== 'string' || Number.isNaN(Date.parse(value.archivedAt)) || value.status !== 'CLOSED')) {
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', 'Invalid archived Workspace Task record.', { recoverable: false, taskId: value.id });
  }
  const error = value.error && typeof value.error === 'object' && !Array.isArray(value.error)
    ? serializeRuntimeError(value.error, { includeLegacy: true })
    : null;
  return {
    schemaVersion: 1,
    mode,
    ...(custom ? { custom } : {}),
    id: value.id,
    title: redactOutput(value.title, 512),
    status: value.status,
    promptVersion: redactOutput(value.promptVersion, 64),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(value.archivedAt ? { archivedAt: value.archivedAt } : {}),
    sessions,
    ...(mode !== 'custom' ? { resume: validateWorkspaceResume(value.resume) } : {}),
    ...(value.runtimeFencing === true ? { runtimeFencing: true } : {}),
    ...(value.nativeConversations !== undefined ? { nativeConversations: validateNativeConversations(value.nativeConversations,
      { projectRoot: root, taskId: value.id, mode }) } : {}),
    cooperation,
    ...(mode !== 'custom' ? { roundRuntime: validateRoundRuntime(value.roundRuntime) } : {}),
    collaborationEvents,
    ...(mode === 'custom' ? {} : { collaborationArchive: { pageCount: collaborationArchive.pageCount,
      eventCount: collaborationArchive.eventCount, lastRevision: collaborationArchive.lastRevision } }),
    startup: mode === 'custom' ? null : validateStartup(value.startup),
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

function collaborationArchiveDirectory(root, id) {
  validateWorkspaceTaskId(id);
  const directory = join(workspaceTaskDirectory(root).directory, 'collaboration-history', id);
  assertSafePath(root, directory);
  return directory;
}

function compactCollaborationHistory(root, record) {
  if (record.mode === 'custom' || record.collaborationEvents.length <= COLLABORATION_PAGE_SIZE) return record;
  const directory = collaborationArchiveDirectory(root, record.id);
  mkdirSync(directory, { recursive: true });
  const archive = { ...record.collaborationArchive };
  let offset = 0;
  while (record.collaborationEvents.length - offset > COLLABORATION_PAGE_SIZE) {
    const events = record.collaborationEvents.slice(offset, offset + COLLABORATION_PAGE_SIZE);
    const path = join(directory, `${archive.pageCount + 1}.json`);
    assertSafePath(root, path);
    // Publish the page before the Task pointer. Failed Task commits leave only
    // unreferenced pages, which a later writer can safely replace under the lock.
    atomicWrite(path, `${JSON.stringify(events)}\n`, join(root, '.agent-bus', 'tmp'));
    archive.pageCount++;
    archive.eventCount += events.length;
    archive.lastRevision = events.at(-1).revision;
    offset += events.length;
  }
  return { ...record, collaborationEvents: record.collaborationEvents.slice(offset), collaborationArchive: archive };
}

function readCollaborationPage(root, record, page) {
  const path = join(collaborationArchiveDirectory(root, record.id), `${page}.json`);
  const events = validateCollaborationEvents(JSON.parse(readInternalFile(join(root, '.agent-bus'), path)), record.id, record.collaborationArchive.lastRevision);
  if (events.length !== COLLABORATION_PAGE_SIZE
    || (page === record.collaborationArchive.pageCount && events.at(-1).revision !== record.collaborationArchive.lastRevision)) {
    throw new Error('Invalid Workspace collaboration archive page.');
  }
  return events;
}

function writeWorkspaceTask(root, record, { replaceCooperation = false, resetCooperation = false, replaceStartup = false, replaceTitle = false, eventSummary, executorReceipt = false } = {}) {
  const repository = repositoryRoot(root);
  const path = workspaceTaskFile(repository, record.id, { create: true });
  // Reuse the existing short file transaction lock for every task-file writer.
  // No Session RPC or asynchronous work runs while this lock is held.
  const bus = join(repository, '.agent-bus');
  assertSafePath(repository, join(bus, 'locks', 'config'));
  const release = acquireConfigLock(bus);
  try {
    const current = existsSync(path) ? readWorkspaceTaskRecord(repository, record.id) : null;
    let base = record;
    if (replaceCooperation && current) {
      if ((current.status !== 'RUNNING' && !(executorReceipt && executorReceiptAvailable(current))) || current.archivedAt
        || taskSlots(record).some(({ slot }) => current.sessions[slot].sessionId !== record.sessions[slot].sessionId
          || current.sessions[slot].runtimeGeneration !== record.sessions[slot].runtimeGeneration)) {
        throw new Error('Task pair changed during cooperation update; dispatch input may have been sent. Do not resend automatically.');
      }
      if (executorReceipt && current.resume) {
        const round = current.roundRuntime, owner = current.sessions.antigravity;
        if (!round || round.roundId !== current.cooperation.roundId || round.sessionId !== owner.sessionId
          || round.runtimeGeneration !== owner.runtimeGeneration || record.cooperation.roundId !== current.cooperation.roundId
          || record.cooperation.revision !== current.cooperation.revision + 1) throw new Error('Executor round or cooperation revision changed before receipt commit.');
      }
      // A receipt may only change cooperation fields, never restore stale Sessions or lifecycle state.
      base = { ...current, roundRuntime: record.roundRuntime, resume: record.resume, updatedAt: record.updatedAt };
    }
    if (replaceStartup && current) {
      if (!['STARTING', 'AWAITING_INPUT'].includes(current.status) || current.archivedAt
        || taskSlots(record).some(({ slot }) => current.sessions[slot].sessionId !== record.sessions[slot].sessionId)) {
        throw new Error('Task pair changed during startup; no automatic retry will run.');
      }
      base = { ...current, status: record.status, startup: record.startup, error: record.error, updatedAt: record.updatedAt };
    }
    if (replaceTitle && current) {
      if (current.archivedAt) throw new Error('Cannot rename an archived Workspace Task.');
      base = { ...current, title: record.title, updatedAt: record.updatedAt };
    } else if (current) {
      // Session/startup snapshots must not undo a name changed in the meantime.
      base = { ...base, title: current.title };
    }
    const cooperation = record.mode === 'custom' ? null : resetCooperation ? idleCooperation((current?.cooperation?.revision || 0) + 1)
      : (!replaceCooperation && current ? current.cooperation : record.cooperation);
    // One atomic record commits the receipt, recent history and archive pointer.
    // Lifecycle writes retain the latest history even when their snapshot is stale.
    const collaborationEvents = [...(current?.collaborationEvents || record.collaborationEvents || [])];
    if (replaceCooperation && current) {
      const event = collaborationTransition(record.id, current.cooperation, { ...cooperation, summary: eventSummary ?? cooperation.summary });
      if (event) collaborationEvents.push(event);
    }
    // Identity facts have a separate authenticated writer. Lifecycle/startup/
    // receipt snapshots must never erase or replace newer durable bindings.
    const nativeConversations = current?.nativeConversations ?? record.nativeConversations;
    if (record.resume) {
      const target = record.resume.conversationId;
      if (listWorkspaceTaskRecords(repository).some(other => other.id !== record.id
        && (other.resume?.conversationId === target || other.nativeConversations?.codex?.binding.conversationId === target))) {
        throw new Error('Codex conversation is already bound to another Workspace Task.');
      }
    }
    const validated = compactCollaborationHistory(repository, validateWorkspaceTaskRecord({ ...base, cooperation, collaborationEvents,
      collaborationArchive: current?.collaborationArchive ?? record.collaborationArchive,
      ...(nativeConversations !== undefined ? { nativeConversations } : {}) }, { root: repository }));
    atomicWrite(path, `${JSON.stringify(validated, null, 2)}\n`, join(repository, '.agent-bus', 'tmp'));
    Object.assign(record, validated); // Keep lifecycle responses consistent with persisted receipts.
    return validated;
  } finally { release(); }
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
    return validateWorkspaceTaskRecord(JSON.parse(readInternalFile(join(repository, '.agent-bus'), path)), { root: repository });
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
  const { directory, repository } = workspaceTaskDirectory(root);
  if (!existsSync(directory)) return [];
  // Filename order is the tie-breaker for the stable timestamp sort below.
  // Compare timestamps directly without locale-aware collation or coercion.
  return readdirSync(directory)
    .filter(name => name.endsWith('.json'))
    .sort()
    .map(name => {
      const path = join(directory, name);
      try {
        return validateWorkspaceTaskRecord(JSON.parse(readInternalFile(directory, path)), { root: repository });
      } catch (error) {
        throw normalizeRuntimeError(error, 'WORKSPACE_TASK_STATE_CONFLICT');
      }
    })
    .sort((left, right) => (right.updatedAt > left.updatedAt ? 1 : right.updatedAt < left.updatedAt ? -1 : 0));
}

function normalizeLanguage(language) {
  return `${language || 'en'}`.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

// Performance optimization: When target sessionIds are provided (e.g. single task reads),
// perform O(1) targeted file reads via readRecord instead of scanning all sessions with listRecords.
function sessionFactMap(root, sessionIds = null) {
  const sessions = join(repositoryRoot(root), '.agent-bus', 'sessions');
  if (!existsSync(sessions)) return new Map();
  try {
    if (Array.isArray(sessionIds)) {
      const facts = new Map();
      for (const id of sessionIds) {
        if (!id) continue;
        try {
          const record = readRecord(root, id);
          if (record.id === id) facts.set(id, record);
        } catch {
          // Ignore missing or inaccessible session records
        }
      }
      return facts;
    }
    return new Map(listRecords(root).map(record => [record.id, record]));
  } catch {
    return new Map();
  }
}

function sessionView(root, record, slot, facts, nativeConversation) {
  const candidate = slot.sessionId ? facts.get(slot.sessionId) : null;
  let fact = null;
  try {
    if (candidate && candidate.id === slot.sessionId && typeof candidate.cwd === 'string' && candidate.cwd.trim()
      && sessionBelongsToTask(root, record, candidate, slot)) fact = candidate;
  } catch { /* Missing, invalid or foreign repositories provide no Session evidence. */ }
  return {
    // Record availability includes ownership, not a liveness probe.
    recordAvailable: Boolean(fact),
    slot: slot.slot,
    agent: slot.agent,
    role: slot.role,
    sessionId: slot.sessionId,
    ...(slot.runtimeGeneration ? { runtimeGeneration: slot.runtimeGeneration } : {}),
    ...(slot.role !== 'custom' ? { nativeIdentity: { ...nativeIdentityView(nativeConversation),
      discovery: fact?.nativeIdentityCapture || { state: 'UNAVAILABLE', reason: 'NO_CAPTURE_SOURCE' } } } : {}),
    state: fact?.state || null,
    status: fact?.state || null,
    createdAt: fact?.createdAt || null,
    lastActivityAt: fact?.lastActivityAt || null,
    exitCode: fact?.exitCode ?? null,
    signal: fact?.signal || null,
    error: fact?.error ? redactOutput(fact.error, MAX_ERROR_BYTES) : (TERMINAL_SESSION_STATES.has(fact?.state) ? workspaceTerminalFailure(slot.agent, fact?.outputTail) : null),
    startupFailure: TERMINAL_SESSION_STATES.has(fact?.state) && workspaceTerminalFailure(slot.agent, fact?.outputTail)?.includes('workspace routing discovery timed out') ? 'account-init-timeout' : null,
    backend: fact?.backend || null,
    diagnostics: fact?.diagnostics || null,
    cols: fact?.cols ?? null,
    rows: fact?.rows ?? null,
  };
}

function statusFromFacts(record, sessions) {
  if (record.status === 'ERROR' || record.status === 'CLOSED') return record.status;
  if (record.startup && Object.values(record.startup.slots).some(state => state !== 'READY')) return record.status;
  const states = sessions.map(session => session.state).filter(Boolean);
  if (record.mode === 'custom' && record.status === 'STARTING') return states.some(state => TERMINAL_SESSION_STATES.has(state)) ? 'ERROR' : 'STARTING';
  const active = states.filter(state => ACTIVE_SESSION_STATES.has(state)).length;
  if (active === 2) return 'RUNNING';
  if (active === 1) return 'DEGRADED';
  if (record.status === 'STARTING') return states.some(state => TERMINAL_SESSION_STATES.has(state)) ? 'ERROR' : 'STARTING';
  if (states.length === 2 && states.every(state => TERMINAL_SESSION_STATES.has(state))) return 'EXITED';
  return record.status;
}

function workspaceTaskView(root, record, facts = new Map(), { includeHistory = true, historyPage = null } = {}) {
  const sessions = Object.fromEntries(taskSlots(record).map(expected => [
    expected.slot,
    sessionView(root, record, record.sessions[expected.slot], facts, record.nativeConversations?.[expected.slot]),
  ]));
  const codexFact = sessions.codex?.recordAvailable ? facts.get(sessions.codex.sessionId) : null;
  const executorFact = sessions.antigravity?.recordAvailable ? facts.get(sessions.antigravity.sessionId) : null;
  if (record.mode !== 'custom' && manualConfirmationCurrent(record, codexFact)) {
    sessions.codex.nativeIdentity.verification = { state: 'MANUAL_CONFIRMED', reason: 'USER_CONFIRMED_STATUS',
      confirmedAt: record.resume.verification.confirmedAt };
  }
  return {
    id: record.id,
    mode: record.mode,
    ...(record.mode !== 'custom' ? { resume: workspaceResumeView(record, codexFact, executorFact) } : {}),
    ...(record.runtimeFencing ? { runtimeFencing: true } : {}),
    ...(record.custom ? { custom: record.custom } : {}),
    title: record.title,
    status: statusFromFacts(record, Object.values(sessions)),
    promptVersion: record.promptVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.archivedAt ? { archivedAt: record.archivedAt } : {}),
    sessions,
    cooperation: record.cooperation,
    ...(record.mode !== 'custom' ? { roundRuntime: record.roundRuntime || null } : {}),
    ...(includeHistory ? { collaborationEvents: record.collaborationEvents,
      collaborationHistory: { archivedEvents: record.collaborationArchive?.eventCount || 0,
        previousPage: historyPage === null ? record.collaborationArchive?.pageCount || null : historyPage > 1 ? historyPage - 1 : null } } : {}),
    startup: record.startup,
    sessionIds: Object.fromEntries(taskSlots(record).map(({ slot }) => [slot, record.sessions[slot].sessionId])),
    sessionHistory: record.sessionHistory,
    error: record.error,
  };
}

export async function readWorkspaceTasks(root, { includeArchived = false } = {}) {
  const repository = repositoryRoot(root);
  const records = listWorkspaceTaskRecords(repository).filter(record => includeArchived || !record.archivedAt);
  // Pass targeted session IDs for all matching tasks to sessionFactMap to avoid scanning all workspace session files
  const sessionIds = [...new Set(records.flatMap(record => sessionIdsFor(record)))];
  const facts = sessionFactMap(repository, sessionIds);
  return records.map(record => workspaceTaskView(root, record, facts, { includeHistory: false }));
}

export async function readWorkspaceTask(root, id, { historyPage = null } = {}) {
  const repository = repositoryRoot(root);
  let record = readWorkspaceTaskRecord(repository, id);
  if (historyPage !== null) {
    const page = typeof historyPage === 'number' ? historyPage : typeof historyPage === 'string' && /^[1-9]\d*$/.test(historyPage) ? Number(historyPage) : NaN;
    if (!Number.isSafeInteger(page) || page < 1 || page > (record.collaborationArchive?.pageCount || 0)) {
      throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', 'Invalid Workspace collaboration history page.', { recoverable: false, taskId: id });
    }
    historyPage = page;
    record = { ...record, collaborationEvents: readCollaborationPage(repository, record, page) };
  }
  // Pass targeted session IDs to sessionFactMap to avoid scanning all workspace session files
  const sessionIds = sessionIdsFor(record);
  return workspaceTaskView(root, record, sessionFactMap(repository, sessionIds), { historyPage });
}

// Internal Host/Adapter composition point. Deliberately not registered as a
// Runtime operation, HTTP action or workspace-message command. The default
// receiver alone has no trusted source. A verifier is trusted executable code, never
// a user-supplied source name/flag in an observation or project configuration.
export function createWorkspaceNativeIdentityStore({ root, verifyAttestation } = {}) {
  const repository = repositoryRoot(root);
  return createNativeIdentityReceiver({ projectRoot: repository, verifyAttestation,
    commit(observation) {
      const bus = join(repository, '.agent-bus');
      assertSafePath(repository, join(bus, 'locks', 'config'));
      assertSafePath(repository, join(bus, 'tmp'));
      const release = acquireConfigLock(bus);
      try {
        const task = readWorkspaceTaskRecord(repository, observation.taskId);
        const session = readRecord(repository, observation.sessionId);
        const updated = applyNativeIdentityObservation(task, session, observation, listWorkspaceTaskRecords(repository));
        const validated = validateWorkspaceTaskRecord(updated, { root: repository });
        const path = workspaceTaskFile(repository, task.id);
        atomicWrite(path, `${JSON.stringify(validated, null, 2)}\n`, join(bus, 'tmp'));
        return nativeIdentityView(validated.nativeConversations[observation.slot]);
      } finally { release(); }
    },
  });
}

// Trusted Host composition only; not registered with HTTP, RPC or workspace-message.
// The Host's private native-event receiver has already authenticated the launch
// capability and inspected exact native metadata outside the config transaction.
export function createWorkspaceCodexIdentityObserver({ root, session }) {
  const repository = repositoryRoot(root);
  return async evidence => {
    const task = readWorkspaceTaskRecord(repository, session.taskId);
    const prior = task.nativeConversations?.codex;
    const observation = { schemaVersion: 1, projectRoot: repository, taskId: session.taskId,
      slot: 'codex', adapter: 'codex-cli', sessionId: session.id, runtimeGeneration: session.runtimeGeneration,
      conversationId: evidence.conversationId, source: evidence.source, observedAt: evidence.observedAt,
      sequence: (prior?.lastObservation.sequence || 0) + 1, expectedRevision: prior?.revision || 0 };
    const token = Symbol('owned-native-event');
    return createWorkspaceNativeIdentityStore({ root: repository,
      verifyAttestation: value => value === token ? observation : null }).observe(token);
  };
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
  return taskSlots(record).map(({ slot }) => record.sessions[slot].sessionId).filter(Boolean);
}

function updateRecord(record, update = {}) {
  return {
    ...record,
    ...update,
    updatedAt: now(),
  };
}

function initialWorkspaceTask(language, mode = 'default', custom = null) {
  const id = `workspace-${randomUUID().replaceAll('-', '')}`;
  const timestamp = now();
  return {
    schemaVersion: 1,
    id,
    title: `Task · ${localTitleTimestamp()} · ${id.slice(-6)}`,
    status: 'STARTING',
    promptVersion: mode === 'custom' ? 'custom-terminal-v1' : WORKSPACE_TASK_PROMPT_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    mode,
    ...(custom ? { custom } : {}),
    sessions: defaultSessions({ mode }),
    startup: mode === 'custom' ? null : initialStartup(language),
    sessionHistory: [],
    error: null,
  };
}

async function discoverTaskSessions(root, task) {
  try {
    return listRecords(root).filter(record => {
      try { return sessionBelongsToTask(root, task, record); } catch { return false; }
    });
  } catch {
    return [];
  }
}

function workspaceTerminalMarker(agent) {
  return agent === 'codex' ? 'Ask Codex to do anything' : '? for shortcuts';
}

export function normalizeWorkspaceTerminalOutput(output) {
  return `${output || ''}`.replace(ANSI_ESCAPE_PATTERN, '');
}

let startupTerminalConstructor;
export async function renderWorkspaceStartupScreen(output, { cols = 120, rows = 30 } = {}) {
  if (!startupTerminalConstructor) {
    // Reuse the bundled terminal parser to read the current screen after cursor redraws.
    // Agent output is fed as terminal data, never evaluated as JavaScript.
    const context = vm.createContext({ setTimeout, clearTimeout, queueMicrotask, performance, document: {},
      navigator: { userAgent: 'CoordinateWorkspace', appVersion: '1', platform: 'Win32', language: 'en-US' } });
    context.window = context;
    vm.runInContext(readFileSync(new URL('../../../inspector/web-workspace/vendor/xterm.js', import.meta.url), 'utf8'), context);
    startupTerminalConstructor = context.Terminal;
  }
  const terminal = new startupTerminalConstructor({ cols: Math.max(10, Math.min(1000, cols || 120)), rows: Math.max(10, Math.min(500, rows || 30)), scrollback: 0 });
  try {
    await new Promise(done => terminal.write(`${output || ''}`, done));
    const screen = terminal.buffer.active;
    return Array.from({ length: terminal.rows }, (_, index) => screen.getLine(screen.baseY + index)?.translateToString(true) || '').join('\n');
  } finally { terminal.dispose(); }
}

function workspaceTerminalFailure(agent, output) {
  if (agent !== 'codex') return null;
  const match = normalizeWorkspaceTerminalOutput(output).match(/Error:\s*(account\/read failed during TUI bootstrap:[^\r\n]*)/i);
  return match ? redactOutput(match[1], 1024) : null;
}

function workspaceTerminalNeedsTrust(agent, output) {
  const normalized = normalizeWorkspaceTerminalOutput(output);
  const prompts = agent === 'codex'
    ? ['Trust this folder?', 'Trust and continue']
    : ['Do you trust the contents of this project?', 'Yes, I trust this folder'];
  const trustIndex = Math.max(...prompts.map(value => normalized.lastIndexOf(value)));
  const progressIndex = Math.max(...['Starting MCP servers', 'Signing in...', 'Generating...'].map(value => normalized.lastIndexOf(value)));
  return trustIndex >= 0 && trustIndex > normalized.lastIndexOf(workspaceTerminalMarker(agent)) && trustIndex > progressIndex;
}

export function workspaceTerminalReady(agent, output) {
  const marker = workspaceTerminalMarker(agent);
  const normalized = normalizeWorkspaceTerminalOutput(output);
  if (workspaceTerminalFailure(agent, normalized)) return false;
  if (agent === 'codex' && /OpenAI Codex[^\n]*(?:\n[^\n]*){0,4}\bloading\b/i.test(normalized)) return false;
  if (workspaceTerminalNeedsTrust(agent, normalized)) return false;
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex < 0) return false;
  const loadingMarkers = agent === 'codex'
    ? ['Starting MCP servers', 'esc to interrupt']
    : ['Signing in...', 'Generating...', 'esc to cancel'];
  const lastLoadingIndex = Math.max(...loadingMarkers.map(value => normalized.lastIndexOf(value)));
  // Some interactive CLIs paint the input line before MCP/login work is
  // complete. The prompt is ready only when the most recent loading marker
  // precedes the most recent input marker in the PTY byte stream. Full-screen
  // TUIs may redraw the loading screen without replaying the loading phrase;
  // in that case the quiet-period check below is the stability guard.
  return lastLoadingIndex < 0 || lastLoadingIndex < markerIndex;
}

function workspaceTerminalAuthRequired(agent, output) {
  return agent === 'antigravity' && /currently\s+not\s+signed\s+in|select\s+login\s+method|google\s+oauth/i.test(output);
}

function workspaceTerminalAuthSelection(agent, output) {
  const normalized = normalizeWorkspaceTerminalOutput(output);
  const prompts = agent === 'codex'
    ? ['Sign in with ChatGPT', 'Sign in to Codex', 'Provide an API key']
    : ['Select login method:', 'Google OAuth'];
  const index = Math.max(...prompts.map(value => normalized.lastIndexOf(value)));
  return index >= 0 && index > normalized.lastIndexOf(workspaceTerminalMarker(agent));
}

async function waitForWorkspaceTerminalReady(root, session, agent, taskId, { timeoutMs = WORKSPACE_STARTUP_TIMEOUT_MS } = {}) {
  const manager = getExecutionSessionManager();
  const deadline = Date.now() + timeoutMs;
  let markerSeen = false;
  let authObserved = false;
  let lastOutput = null;
  let quietSince = null;
  let latest = session;

  while (Date.now() < deadline) {
    try {
      const inspected = await manager.inspect(root, session.id, { maxLines: 160, maxBytes: 24 * 1024 });
      latest = inspected.session || latest;
      const rawOutput = inspected.output?.output || '';
      const startupError = workspaceTerminalFailure(agent, rawOutput);
      if (startupError) throw runtimeError('WORKSPACE_TASK_START_FAILED', `${agent} CLI startup failed: ${startupError}`, { recoverable: true, taskId, agent, sessionId: session.id, stage: 'account-bootstrap' });
      if (!ACTIVE_SESSION_STATES.has(`${latest?.state || ''}`)) {
        throw runtimeError('WORKSPACE_TASK_START_FAILED', `Workspace Task ${taskId} ${agent} Session exited before its interactive prompt was ready.`, {
          recoverable: true,
          taskId,
          agent,
          sessionId: session.id,
          details: { state: latest?.state || null },
        });
      }

      const output = await renderWorkspaceStartupScreen(rawOutput, latest);
      if (workspaceTerminalNeedsTrust(agent, output)) return { session: latest, state: 'TRUST_REQUIRED' };
      if (workspaceTerminalAuthSelection(agent, output)) return { session: latest, state: 'AUTH_REQUIRED' };
      // Antigravity can print its unauthenticated banner while its keyring
      // auth is still being loaded. Treat that output as an observation, not
      // an immediate failure; a real login can complete before the prompt is
      // ready. A lingering banner becomes a recoverable sign-in state after
      // the bounded readiness window; the terminal stays available.
      authObserved ||= workspaceTerminalAuthRequired(agent, output);
      const ready = workspaceTerminalReady(agent, output);
      markerSeen = ready;
      // Title animations and cursor-only redraws advance the raw PTY cursor
      // without changing the prompt. Wait for stable terminal text instead.
      if (markerSeen && output === lastOutput) {
        quietSince ??= Date.now();
        if (Date.now() - quietSince >= WORKSPACE_READY_QUIET_MS) return { session: latest, state: 'READY' };
      } else {
        quietSince = null;
      }
      lastOutput = output;
    } catch (error) {
      if (error?.code === 'WORKSPACE_TASK_START_FAILED' || error?.code === 'AUTH_REQUIRED') throw error;
      // A detached host can briefly be unavailable between its socket bind
      // and first output. Keep this bounded readiness probe retryable.
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 100));
  }

  // Keep the existing terminal interactive for sign-in or slow initialization.
  return { session: latest, state: authObserved ? 'AUTH_REQUIRED' : 'WAITING' };
}

function workspaceSlotPrompt(record, slot, language) {
  const expected = WORKSPACE_TASK_SLOTS.find(item => item.slot === slot);
  const helper = "'" + fileURLToPath(new URL('./workspace-message.mjs', import.meta.url)).replaceAll("'", "'\\''") + "'";
  const commands = slot === 'codex'
    ? `send '<instruction>'; read <cursor>; changes; wait <cursor> [revision] [timeout-ms]; report reviewing|approved|changes-requested <roundId> ['summary']`
    : `report working|done|failed <roundId> ['summary']`;
  const replacement = slot === 'antigravity' && record.resume ? '\nYou are a replacement executor. You have no previous executor conversation. Do not recover or replay old instructions. Wait for a new explicit Codex dispatch after it inspects the workspace and collaboration history.' : '';
  return `${workspaceRolePrompt(expected.agent, language)}${replacement}\nWorkspace: ${record.id}\nHelper (run from repository root): node ${helper} ${record.id} <command>\nCommands: ${commands}\nQuote instructions and summaries safely for your shell. wait defaults to 60 seconds maximum. If the pair is still starting, retry only when no input was sent; never create another Session.`;
}

async function openWorkspaceSlot(root, record, slot, language, conversationId) {
  const expected = taskSlots(record).find(item => item.slot === slot);
  const opened = record.mode === 'custom'
    ? await runtimeWorkspaceCustomSessionOpen({ root, taskId: record.id, slot, language })
    : await runtimeSessionOpen({
    root,
    agent: expected.agent,
    // Do not inject the role prompt during Session Host startup. Interactive
    // CLIs can render their input line before MCP/login initialization is
    // complete and silently discard bytes written in that window.
    initialPrompt: '',
    language,
    taskId: record.id,
    subtaskId: slot,
    workspace: true,
    reuseExisting: false,
    ...(conversationId !== undefined ? { conversationId } : {}),
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
  // Bind the Session before inspecting any human confirmation screen so the Web can display it.
  const current = readWorkspaceTaskRecord(root, record.id);
  if (!['STARTING', 'AWAITING_INPUT'].includes(current.status)) {
    await closeSessionIds(root, [opened.session.id]);
    throw new Error('Task was closed while its terminal was opening.');
  }
  record.sessions[slot].sessionId = opened.session.id;
  if (record.mode !== 'custom' && opened.session.runtimeGeneration) record.sessions[slot].runtimeGeneration = opened.session.runtimeGeneration;
  writeWorkspaceTask(root, record);
  return opened.session;
}

async function prepareWorkspaceSlot(root, record, slot, timeoutMs = WORKSPACE_STARTUP_TIMEOUT_MS) {
  if (record.startup.slots[slot] === 'READY') return;
  if (record.startup.slots[slot] === 'INJECTING') throw runtimeError('WORKSPACE_TASK_START_FAILED', 'Role initialization was interrupted. Restart the pair to avoid sending the prompt twice.', { recoverable: true, taskId: record.id, agent: slot });
  const sessionId = record.sessions[slot].sessionId;
  const session = readRecord(root, sessionId);
  if (session.id !== sessionId || session.taskId !== record.id || session.agent !== slot || repositoryRoot(session.cwd) !== root) throw new Error('Session task binding mismatch during startup.');
  const result = await waitForWorkspaceTerminalReady(root, session, slot, record.id, { timeoutMs });
  record.startup.slots[slot] = result.state;
  record.status = startupStatus(record);
  record.updatedAt = now();
  if (result.state !== 'READY') {
    writeWorkspaceTask(root, record, { replaceStartup: true });
    return;
  }
  if (slot === 'codex' && record.resume) {
    // Native resume already owns its context. No old role or history injection.
    writeWorkspaceTask(root, record, { replaceStartup: true });
    return;
  }
  // Persist the in-flight marker before writing: after interruption we require a restart, never resend.
  record.startup.slots[slot] = 'INJECTING';
  record.status = startupStatus(record);
  writeWorkspaceTask(root, record, { replaceStartup: true });
  const manager = getExecutionSessionManager();
  await manager.write(root, sessionId, workspaceSlotPrompt(record, slot, record.startup.language), { submit: false, taskId: record.id, subtaskId: slot });
  await manager.write(root, sessionId, '\r', { submit: false, taskId: record.id, subtaskId: slot });
  record.startup.slots[slot] = 'READY';
  record.status = startupStatus(record);
  record.updatedAt = now();
  writeWorkspaceTask(root, record, { replaceStartup: true });
}

export async function runtimeWorkspaceTaskContinue(input = {}) {
  const root = repositoryRoot(input.root);
  const id = input.workspaceTaskId || input.id;
  return withCooperationLock(root, id, async repository => {
    let record = readWorkspaceTaskRecord(repository, id);
    if (!record.archivedAt && record.startup && ['STARTING', 'AWAITING_INPUT'].includes(record.status)) {
      try {
        if (WORKSPACE_TASK_SLOTS.some(({ slot }) => !record.sessions[slot].sessionId)) throw runtimeError('WORKSPACE_TASK_START_FAILED', 'Startup was interrupted before both terminals opened. Restart the pair to continue.', { recoverable: true, taskId: record.id });
        for (const { slot } of WORKSPACE_TASK_SLOTS) await prepareWorkspaceSlot(repository, record, slot, 1500);
        // prepareWorkspaceSlot may already have committed RUNNING. We still
        // own the lifecycle lock; commit the resume summary without a second
        // startup-only CAS that would reject that completed transition.
        if (record.resume) { updateResumeState(repository, record); writeWorkspaceTask(repository, record); }
      } catch (error) {
        record = failureRecord(record, error);
        if (record.resume) updateResumeState(repository, record);
        writeWorkspaceTask(repository, record);
      }
    }
    return jsonSuccess('workspace.task.continue', { workspaceTask: workspaceTaskView(root, record, sessionFactMap(repository, sessionIdsFor(record))) });
  });
}

async function rollbackTaskSessions(root, record) {
  // Validate every recorded ID before closing any process, including rollback.
  for (const expected of taskSlots(record)) {
    const id = record.sessions[expected.slot].sessionId;
    if (!id) continue;
    const session = readRecord(root, id);
    if (session.id !== id || !sessionBelongsToTask(root, record, session, expected)) throw new Error('Session task binding mismatch during cleanup.');
  }
  const discovered = await discoverTaskSessions(root, record);
  const ids = [
    ...sessionIdsFor(record),
    ...discovered.map(session => session.id),
  ];
  for (const id of ids) {
    const session = readRecord(root, id);
    if (session.id !== id || !sessionBelongsToTask(root, record, session)) throw new Error('Session task binding mismatch during cleanup.');
  }
  return closeSessionIds(root, ids);
}

async function attachDiscoveredSessions(root, record) {
  const discovered = await discoverTaskSessions(root, record);
  for (const session of discovered) {
    const slot = taskSlots(record).find(item => item.agent === session.agent && (record.mode !== 'custom' || item.slot === session.subtaskId));
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

async function startWorkspaceSlots(root, record, language) {
  for (const { slot } of taskSlots(record)) await openWorkspaceSlot(root, record, slot, language);
  if (record.mode !== 'custom') {
    for (const { slot } of WORKSPACE_TASK_SLOTS) await prepareWorkspaceSlot(root, record, slot);
  }
}

export async function runtimeWorkspaceTaskPromptSend(input = {}) {
  if (input.confirmed !== true) throw new Error('Confirm the CLI is ready to receive input before sending.');
  const root = repositoryRoot(input.root);
  return withCooperationLock(root, input.workspaceTaskId, async () => {
    const record = readWorkspaceTaskRecord(root, input.workspaceTaskId);
    if (record.mode !== 'custom' || record.archivedAt || ['CLOSED', 'ERROR'].includes(record.status)) throw new Error('Custom task is not writable.');
    const expected = taskSlots(record).find(item => item.slot === input.slot);
    if (!expected) throw new Error('Invalid custom terminal slot.');
    const id = record.sessions[input.slot].sessionId;
    const session = id ? readRecord(root, id) : null;
    if (!session || session.id !== id || !sessionBelongsToTask(root, record, session, expected)
      || !ACTIVE_SESSION_STATES.has(session.state)) throw new Error('Session task binding mismatch or terminal is not running.');
    if (input.sessionCreatedAt !== session.createdAt) throw new Error('Terminal changed since Prompt confirmation. No input was sent.');
    const prompt = composeCustomPrompt(record.custom, input.slot);
    if (!prompt) throw new Error('There is no custom Prompt to send.');
    // A single raw Host write keeps paste + Enter atomic, including multiline
    // text. User confirms paste readiness; no implicit retry or CLI inference.
    const updated = await getExecutionSessionManager().write(root, id, customPromptInput(prompt), { submit: false, taskId: record.id, subtaskId: input.slot });
    return jsonSuccess('workspace.task.prompt.send', { session: updated });
  });
}

export async function runtimeWorkspaceTaskCreate(input = {}) {
  const root = repositoryRoot(input.root);
  const language = normalizeLanguage(input.language);
  const mode = input.mode === undefined ? 'default' : input.mode;
  if (!['default', 'custom'].includes(mode) || (mode === 'default' && input.custom !== undefined)) throw new Error('Invalid Workspace task mode parameters.');
  const custom = mode === 'custom' ? resolveCustomTaskConfig(root, input.custom) : null;
  let record = initialWorkspaceTask(language, mode, custom);
  writeWorkspaceTask(root, record);
  return withCooperationLock(root, record.id, async () => {
    try {
      await startWorkspaceSlots(root, record, language);
      record = updateRecord(record, { status: record.mode === 'custom' ? 'RUNNING' : startupStatus(record), error: null });
      writeWorkspaceTask(root, record);
      return jsonSuccess('workspace.task.create', {
        workspaceTask: workspaceTaskView(root, record, sessionFactMap(root)),
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
  });
}

export async function runtimeWorkspaceTaskRename(input = {}) {
  const root = repositoryRoot(input.root);
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 128 || /[\u0000-\u001f\u007f]/u.test(title)) {
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', 'Task name must be 1–128 characters without line breaks or control characters.', { recoverable: false });
  }
  return withCooperationLock(root, input.workspaceTaskId || input.id, () => {
    const record = readWorkspaceTaskRecord(root, input.workspaceTaskId || input.id);
    if (record.archivedAt) throw new Error('Cannot rename an archived Workspace Task.');
    const updated = writeWorkspaceTask(root, updateRecord(record, { title }), { replaceTitle: true });
    return jsonSuccess('workspace.task.rename', { workspaceTask: workspaceTaskView(root, updated, sessionFactMap(root)) });
  });
}

export async function runtimeWorkspaceTaskClose(input = {}) {
  const root = repositoryRoot(input.root);
  const task = readWorkspaceTaskRecord(root, input.workspaceTaskId || input.id);
  return withCooperationLock(root, task.id, () => closeWorkspaceTask(root, task.id));
}

async function resumableSession(root, record, slot) {
  const association = record.sessions[slot];
  if (!association.sessionId) return null;
  const stored = readRecord(root, association.sessionId);
  const expected = WORKSPACE_TASK_SLOTS.find(item => item.slot === slot);
  if (stored.id !== association.sessionId || !sessionBelongsToTask(root, record, stored, expected)) throw new Error('Session runtime ownership changed; resume was refused.');
  const live = await getExecutionSessionManager().status(root, association.sessionId);
  if (!ACTIVE_SESSION_STATES.has(live.state)) return null;
  if (stored.subtaskId !== slot || !association.runtimeGeneration || stored.runtimeGeneration !== association.runtimeGeneration
    || stored.adapter !== `${slot}-cli`) throw new Error('Session runtime ownership changed; resume was refused.');
  return live;
}

async function recoverInterruptedResumeSlots(root, record, target) {
  for (const candidate of await discoverTaskSessions(root, record)) {
    if (Object.values(record.sessions).some(slot => slot.sessionId === candidate.id)) continue;
    const live = await getExecutionSessionManager().status(root, candidate.id);
    if (!ACTIVE_SESSION_STATES.has(live.state)) continue;
    const slot = candidate.subtaskId;
    if (!record.resume || record.resume.state !== 'STARTING' || !['codex', 'antigravity'].includes(slot)
      || record.sessions[slot].sessionId || candidate.adapter !== `${slot}-cli` || !candidate.runtimeGeneration
      || record.sessionHistory.some(entry => entry[`${slot}SessionId`] === candidate.id)
      || (slot === 'codex' && (candidate.args.at(-2) !== 'resume' || candidate.args.at(-1) !== target))) {
      throw new Error('An unassociated live Task runtime needs inspection; no duplicate Session was opened.');
    }
    record.sessions[slot] = { ...record.sessions[slot], sessionId: candidate.id, runtimeGeneration: candidate.runtimeGeneration };
  }
}

function updateResumeState(root, record) {
  const codex = record.sessions.codex.sessionId ? readRecord(root, record.sessions.codex.sessionId) : null;
  const executor = record.sessions.antigravity.sessionId ? readRecord(root, record.sessions.antigravity.sessionId) : null;
  const codexActive = ACTIVE_SESSION_STATES.has(codex?.state);
  const executorActive = ACTIVE_SESSION_STATES.has(executor?.state);
  record.resume.state = resumeStateFromSessions(record, codex, executor);
  // Normal live login/trust/readiness retains the existing onboarding flow.
  // Failed/missing processes and uncertain role writes require explicit Resume.
  record.status = codexActive && executorActive && record.startup && !Object.values(record.startup.slots).includes('INJECTING')
    ? startupStatus(record) : 'DEGRADED';
}

const inFlightResumes = new Map();

export async function runtimeWorkspaceTaskResume(input = {}) {
  const root = repositoryRoot(input.root);
  const id = input.workspaceTaskId || input.id;
  const inFlightKey = `${root}:${id}`;
  if (inFlightResumes.has(inFlightKey)) {
    return await inFlightResumes.get(inFlightKey);
  }

  const execution = (async () => {
    const prepared = await withCooperationLock(root, id, async () => {
      let record = readWorkspaceTaskRecord(root, id);
      if (record.archivedAt) throw new Error('Cannot resume an archived Workspace Task.');
      if (record.mode === 'custom') throw new Error('Custom Terminals do not use Codex conversation resume.');
      const identity = record.nativeConversations?.codex;
      if (identity?.firstConflict) throw new Error('Codex native identity changed. Resume requires inspection of the original binding.');
      const target = codexConversationId(input.conversationId ?? identity?.binding.conversationId ?? record.resume?.conversationId);
      if ((identity && identity.binding.conversationId !== target) || (record.resume && record.resume.conversationId !== target)) {
        throw new Error('Codex native conversation identity does not match this Task.');
      }
      readCodexConversation({ root, conversationId: target });
      await recoverInterruptedResumeSlots(root, record, target);
      const codex = await resumableSession(root, record, 'codex');
      const executor = await resumableSession(root, record, 'antigravity');

      if (codex && executor) {
        if (record.resume && record.startup?.slots.antigravity === 'READY') {
          record.status = startupStatus(record);
          record.error = null;
          updateResumeState(root, record);
          writeWorkspaceTask(root, record);
          return {
            ready: true,
            result: jsonSuccess('workspace.task.resume', {
              workspaceTask: workspaceTaskView(root, record, sessionFactMap(root, sessionIdsFor(record))),
            }),
          };
        }
        if (!record.resume) {
          throw new Error('Close the current Codex runtime before resuming its original conversation.');
        }
      }

      const oldSessions = { ...record.sessions };
      const language = normalizeLanguage(input.language || record.startup?.language);
      const resumeToken = randomUUID();
      const verification = codex ? record.resume?.verification || null : null;

      record.resume = {
        schemaVersion: 1,
        conversationId: target,
        state: 'STARTING',
        token: resumeToken,
        verification,
        interruption: record.resume?.interruption || (record.cooperation.roundId && !['IDLE', 'APPROVED', 'FAILED'].includes(record.cooperation.status)
          ? { roundId: record.cooperation.roundId, revision: record.cooperation.revision, status: record.cooperation.status } : null),
      };
      record.runtimeFencing = true;
      record.startup ||= initialStartup(language);
      // Legacy rounds acquire their original executor owner before replacement.
      if (!record.roundRuntime && record.cooperation.roundId && record.sessions.antigravity.runtimeGeneration) {
        record.roundRuntime = {
          roundId: record.cooperation.roundId,
          sessionId: record.sessions.antigravity.sessionId,
          runtimeGeneration: record.sessions.antigravity.runtimeGeneration,
        };
      }
      for (const slot of ['codex', 'antigravity']) {
        if ((slot === 'codex' ? codex : executor)) continue;
        record.sessions[slot] = defaultSessions(record)[slot];
        record.startup.slots[slot] = 'WAITING';
      }
      if (Object.values(oldSessions).some(session => session.sessionId && record.sessions[session.slot].sessionId !== session.sessionId)) {
        record.sessionHistory = [...record.sessionHistory, {
          codexSessionId: oldSessions.codex.sessionId,
          antigravitySessionId: oldSessions.antigravity.sessionId,
          closedAt: now(),
        }].slice(-MAX_HISTORY);
      }
      record.status = 'STARTING';
      record.error = null;
      record.updatedAt = now();
      // Persist intent before launch. Pending target occupancy is checked under
      // the same short transaction as all identity/lifecycle writes.
      writeWorkspaceTask(root, record);
      return { ready: false, record, codex, executor, language, target, resumeToken };
    });

    if (prepared.ready) return prepared.result;

    const { record, codex, executor, language, target, resumeToken } = prepared;
    try {
      if (!codex) await openWorkspaceSlot(root, record, 'codex', language, target);
      await prepareWorkspaceSlot(root, record, 'codex');
      if (!executor) await openWorkspaceSlot(root, record, 'antigravity', language);
      await prepareWorkspaceSlot(root, record, 'antigravity');
      record.status = startupStatus(record);
    } catch (error) {
      // Keep any successfully recovered Codex. A failed executor never rolls
      // back the valid native conversation or automatically replays work.
      record.error = serializeRuntimeError(normalizeRuntimeError(error), { includeLegacy: true });
    }

    return withCooperationLock(root, id, async () => {
      let current = readWorkspaceTaskRecord(root, id);
      if (current.archivedAt) throw new Error('Cannot resume an archived Workspace Task.');
      if (current.resume?.token && current.resume.token !== resumeToken) {
        return jsonSuccess('workspace.task.resume', {
          workspaceTask: workspaceTaskView(root, current, sessionFactMap(root, sessionIdsFor(current))),
        });
      }
      current.sessions = { ...record.sessions };
      current.startup = { ...record.startup };
      current.sessionHistory = record.sessionHistory;
      current.error = record.error;
      if (!record.error) {
        current.status = startupStatus(current);
      }
      updateResumeState(root, current);
      current.updatedAt = now();
      writeWorkspaceTask(root, current);
      return jsonSuccess('workspace.task.resume', {
        workspaceTask: workspaceTaskView(root, current, sessionFactMap(root, sessionIdsFor(current))),
      });
    });
  })();

  inFlightResumes.set(inFlightKey, execution);
  try {
    return await execution;
  } finally {
    inFlightResumes.delete(inFlightKey);
  }
}

export async function runtimeWorkspaceTaskConfirmConversation(input = {}) {
  const root = repositoryRoot(input.root);
  const id = input.workspaceTaskId || input.id;
  return withCooperationLock(root, id, async () => {
    let record = readWorkspaceTaskRecord(root, id);
    if (record.mode === 'custom' || record.archivedAt || record.status === 'CLOSED') throw new Error('This Task cannot confirm a live Codex conversation.');
    if (record.startup && record.startup.slots.codex !== 'READY') throw new Error('Finish Codex terminal startup before confirming its native conversation.');
    const association = record.sessions.codex;
    if (input.confirmed !== true) throw new Error('Explicit manual confirmation of the live Codex /status identity and project is required.');
    if (!association.sessionId || input.sessionId !== association.sessionId || input.runtimeGeneration !== association.runtimeGeneration) throw new Error('Codex runtime changed before manual confirmation.');
    if (!await resumableSession(root, record, 'codex')) throw new Error('Codex runtime is no longer live.');
    const target = codexConversationId(input.conversationId);
    if ((record.resume && record.resume.conversationId !== target)
      || (record.nativeConversations?.codex && (record.nativeConversations.codex.firstConflict || record.nativeConversations.codex.binding.conversationId !== target))) throw new Error('Manual identity differs from this Task native conversation.');
    readCodexConversation({ root, conversationId: target });
    // Human assertion is the source of live identity here, explicitly labeled.
    // Metadata validates availability/project; it never becomes automatic proof.
    const observation = { schemaVersion: 1, projectRoot: root, taskId: id, slot: 'codex', adapter: 'codex-cli',
      sessionId: association.sessionId, runtimeGeneration: association.runtimeGeneration, conversationId: target,
      source: { id: 'manual-confirmation', version: '1' }, observedAt: now(),
      sequence: (record.nativeConversations?.codex?.lastObservation.sequence || 0) + 1,
      expectedRevision: record.nativeConversations?.codex?.revision || 0 };
    const token = Symbol('human-confirmation');
    await createWorkspaceNativeIdentityStore({ root, verifyAttestation: value => value === token ? observation : null }).observe(token);
    record = readWorkspaceTaskRecord(root, id);
    record.resume ||= { schemaVersion: 1, conversationId: target, state: 'STARTING', interruption: null, verification: null };
    record.resume.verification = { mode: 'MANUAL', sessionId: association.sessionId, runtimeGeneration: association.runtimeGeneration, confirmedAt: now() };
    record.runtimeFencing = true;
    updateResumeState(root, record); record.updatedAt = now();
    writeWorkspaceTask(root, record);
    return jsonSuccess('workspace.task.conversation.confirm', { workspaceTask: workspaceTaskView(root, record, sessionFactMap(root, sessionIdsFor(record))) });
  });
}

async function closeWorkspaceTask(root, id) {
  let record = readWorkspaceTaskRecord(root, id);
  const closed = await rollbackTaskSessions(root, record);
  record.status = 'CLOSED';
  if (record.resume) record.resume = { ...record.resume, state: 'CLOSED', verification: null };
  record.error = closed.errors.length > 0
    ? serializeRuntimeError(closed.errors[0], { includeLegacy: true })
    : null;
  record.updatedAt = now();
  writeWorkspaceTask(root, record);
  return jsonSuccess('workspace.task.close', {
    workspaceTask: workspaceTaskView(root, record, sessionFactMap(root)),
    closedSessions: closed.results,
    closeErrors: closed.errors.map(error => serializeRuntimeError(error, { includeLegacy: true })),
  });
}

export async function runtimeWorkspaceTaskRestart(input = {}) {
  const root = repositoryRoot(input.root);
  const language = normalizeLanguage(input.language);
  return withCooperationLock(root, input.workspaceTaskId || input.id, async () => {
    let record = readWorkspaceTaskRecord(root, input.workspaceTaskId || input.id);
    if (record.archivedAt) throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', 'Cannot restart an archived Workspace Task.', { recoverable: false, taskId: record.id });
    if (record.mode !== 'custom' && (record.nativeConversations?.codex?.binding || record.resume?.conversationId)) {
      throw new Error('This Task retains its original conversation. Reopen it to continue, or create a new Task for a fresh conversation.');
    }
    const oldSessionIds = sessionIdsFor(record);
    const closed = await rollbackTaskSessions(root, record);
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
          ...Object.fromEntries(taskSlots(record).map(({ slot }) => [`${slot}SessionId`, record.sessions[slot].sessionId])),
          closedAt: now(),
        },
      ].slice(-MAX_HISTORY);
    }
    record.sessions = defaultSessions(record);
    if (record.mode !== 'custom') record.resume = null;
    record.promptVersion = record.mode === 'custom' ? 'custom-terminal-v1' : WORKSPACE_TASK_PROMPT_VERSION;
    record.startup = record.mode === 'custom' ? null : initialStartup(language);
    record.status = 'STARTING';
    record.error = null;
    record.updatedAt = now();
    writeWorkspaceTask(root, record, { resetCooperation: true });
    try {
      await startWorkspaceSlots(root, record, language);
      record = updateRecord(record, { status: record.mode === 'custom' ? 'RUNNING' : startupStatus(record), error: null });
      writeWorkspaceTask(root, record);
      return jsonSuccess('workspace.task.restart', {
        workspaceTask: workspaceTaskView(root, record, sessionFactMap(root)),
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
  });
}

function allTaskSessionIds(record) {
  return [...new Set([...sessionIdsFor(record), ...record.sessionHistory.flatMap(entry => taskSlots(record).map(({ slot }) => entry[`${slot}SessionId`]))].filter(Boolean))];
}


function ownedTaskSessionFiles(root, record, sessionRecords = null) {
  const directory = join(root, '.agent-bus', 'sessions');
  assertSafePath(root, directory);
  // Performance optimization: reuse pre-read session records when provided to avoid O(A * S) disk reads
  const sessions = sessionRecords !== null ? sessionRecords : (existsSync(directory) ? listRecords(root) : []);
  const owned = sessions.filter(session => session.taskId === record.id && taskSlots(record).some(slot => slot.agent === session.agent));
  // Restart history is bounded, but transcript cleanup must cover every owned Session.
  return [...new Set([...allTaskSessionIds(record), ...owned.map(session => session.id)])].flatMap(id => {
    const path = join(root, '.agent-bus', 'sessions', `${id}.json`);
    assertSafePath(root, path);
    if (!existsSync(path)) return [];
    // Discovery records may contain duplicate payload IDs in different files.
    // Validate ownership and active state from the exact file being modified.
    const session = readRecord(root, id);
    if (session.id !== id || !sessionBelongsToTask(root, record, session)) {
      throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', 'Refusing to modify a Session owned by another task.', { recoverable: false, taskId: record.id, sessionId: id });
    }
    return [{ id, path, session }];
  });
}

export async function runtimeWorkspaceTaskArchive(input = {}) {
  const root = repositoryRoot(input.root);
  const task = readWorkspaceTaskRecord(root, input.workspaceTaskId || input.id);
  return withCooperationLock(root, task.id, () => archiveWorkspaceTask(root, task.id));
}

async function archiveWorkspaceTask(root, id) {
  let record = readWorkspaceTaskRecord(root, id);
  if (record.archivedAt) return jsonSuccess('workspace.task.archive', { workspaceTask: workspaceTaskView(root, record, sessionFactMap(root)) });
  const files = ownedTaskSessionFiles(root, record);
  const closed = await closeSessionIds(root, files.map(file => file.id));
  if (closed.errors.length || closed.results.some(session => ACTIVE_SESSION_STATES.has(session?.state))) {
    throw closed.errors[0] || runtimeError('WORKSPACE_TASK_CLOSE_FAILED', 'A Workspace terminal is still active; archive was not completed.', { recoverable: true, taskId: record.id });
  }
  record = updateRecord(record, { status: 'CLOSED', archivedAt: now() });
  writeWorkspaceTask(root, record);
  return jsonSuccess('workspace.task.archive', { workspaceTask: workspaceTaskView(root, record, sessionFactMap(root)) });
}

export async function runtimeWorkspaceArchivesClear(input = {}) {
  const root = repositoryRoot(input.root);
  const records = listWorkspaceTaskRecords(root);
  let deletedTasks = 0, deletedSessions = 0;
  const archivedRecords = records.filter(task => task.archivedAt);
  if (archivedRecords.length === 0) {
    return jsonSuccess('workspace.archives.clear', { deletedTasks: 0, deletedSessions: 0 });
  }

  const directory = join(root, '.agent-bus', 'sessions');
  const sessionRecords = existsSync(directory) ? listRecords(root) : [];

  // Performance optimization: pre-index session IDs to set of referencing task IDs for O(1) cross-task reference checks
  const sessionTaskMap = new Map();
  for (const record of records) {
    for (const sessionId of allTaskSessionIds(record)) {
      let taskIds = sessionTaskMap.get(sessionId);
      if (!taskIds) {
        taskIds = new Set();
        sessionTaskMap.set(sessionId, taskIds);
      }
      taskIds.add(record.id);
    }
  }

  for (const record of archivedRecords) {
    const files = ownedTaskSessionFiles(root, record, sessionRecords);
    for (const file of files) {
      const referencingTaskIds = sessionTaskMap.get(file.id);
      const referencedByOther = referencingTaskIds && Array.from(referencingTaskIds).some(taskId => taskId !== record.id);
      if (ACTIVE_SESSION_STATES.has(file.session.state) || referencedByOther) {
        throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', 'Refusing to clear a Session still active or referenced by another task.', { recoverable: false, sessionId: file.id });
      }
    }
    // Validate all paths before deleting any record; never recurse into a project.
    const taskFile = workspaceTaskFile(root, record.id);
    safeInternalStat(workspaceTaskDirectory(root).directory, taskFile);
    const historyDirectory = collaborationArchiveDirectory(root, record.id);
    if (existsSync(historyDirectory)) rmSync(historyDirectory, { recursive: true });
    for (const file of files) { safeInternalStat(join(root, '.agent-bus', 'sessions'), file.path); unlinkSync(file.path); deletedSessions++; }
    unlinkSync(taskFile); deletedTasks++;
  }
  return jsonSuccess('workspace.archives.clear', { deletedTasks, deletedSessions });
}

export { validateWorkspaceTaskRecord };

// No daemon: the lock exists only during a dispatch or receipt update.
async function withCooperationLock(root, id, operation) {
  const repository = repositoryRoot(root);
  const lock = `${workspaceTaskFile(repository, id)}.lock`;
  const owner = randomUUID();
  const ownerPath = join(lock, 'owner.json');
  const deadline = Date.now() + 10_000;
  while (true) {
    let created = false;
    try {
      try {
        mkdirSync(lock);
        created = true;
      } catch (lockError) {
        if (lockError.code !== 'EEXIST') throw lockError;
        try {
          assertSafePath(repository, lock);
          if (!lstatSync(lock).isDirectory()) throw new Error('Unsafe cooperation lock.');
          // Use the same elected dead-owner reaping as the identity store.
          // An old/unpublished/foreign owner is never guessed dead from age.
          if (reapDeadConfigOwner(lock)) continue;
        } catch (inspectionError) {
          // The previous owner may release between EEXIST and any metadata read.
          // Retry under the same deadline; unsafe paths and other IO errors fail.
          if (inspectionError.code !== 'ENOENT') throw inspectionError;
        }
        if (Date.now() >= deadline) throw new Error('Workspace cooperation update is busy; no new input was sent.');
        const jitter = Math.floor(Math.random() * 25);
        await new Promise(done => setTimeout(done, 25 + jitter));
        continue;
      }
      atomicWrite(ownerPath, JSON.stringify({ owner, pid: process.pid, host: hostname() }), join(repository, '.agent-bus', 'tmp'));
      break;
    } catch (error) {
      if (created) {
        try { rmSync(lock, { recursive: true, force: true }); } catch { /* Ignore cleanup failure */ }
      }
      throw error;
    }
  }
  try { return await operation(repository); }
  finally {
    const held = JSON.parse(readInternalFile(join(repository, '.agent-bus'), ownerPath));
    if (held.owner === owner) rmSync(lock, { recursive: true });
  }
}

function executorReceiptAvailable(record) {
  return record.mode !== 'custom' && Boolean(record.resume) && !record.archivedAt && EXECUTOR_RECEIPT_TASK_STATUSES.has(record.status);
}

function assertCooperationSession(root, record, slot, { executorReceipt = false } = {}) {
  if (record.mode === 'custom') throw new Error('Custom tasks do not support default collaboration.');
  if (record.archivedAt || (record.status !== 'RUNNING' && !(executorReceipt && executorReceiptAvailable(record)))) throw new Error('Task pair is not ready. No input was sent.');
  const sessionId = record.sessions[slot].sessionId;
  if (!sessionId) throw new Error('Session task binding mismatch: no recorded Session.');
  const session = readRecord(root, sessionId);
  if (session.id !== sessionId || session.taskId !== record.id || session.agent !== slot || repositoryRoot(session.cwd) !== root) {
    throw new Error('Session task binding mismatch.');
  }
}

function assertRuntimeCaller(root, record, slot, caller) {
  if (slot === 'codex' && record.nativeConversations?.codex?.firstConflict) throw new Error('Codex native identity changed. No collaboration change was made.');
  if (!caller && !record.resume && !record.runtimeFencing) return; // Legacy pre-resume helper compatibility.
  const expected = record.sessions[slot];
  if (!caller || caller.taskId !== record.id || caller.slot !== slot || caller.sessionId !== expected.sessionId
    || caller.runtimeGeneration !== expected.runtimeGeneration) throw new Error('Stale or missing Workspace runtime caller. No collaboration change was made.');
  const session = readRecord(root, expected.sessionId);
  if (session.runtimeGeneration !== caller.runtimeGeneration || session.subtaskId !== slot
    || !ACTIVE_SESSION_STATES.has(session.state)) throw new Error('Workspace runtime caller is no longer current.');
  // Resume uses the validated original target. The current owned runtime may
  // dispatch and review once startup is ready, without a manual confirmation.
  if (slot === 'codex' && record.resume && record.startup?.slots.codex !== 'READY') throw new Error('Codex conversation is not ready for collaboration.');
}

export async function dispatchWorkspaceTask(root, id, roundId, deliver, { caller } = {}) {
  if (!ROUND_ID_PATTERN.test(roundId || '')) throw new Error('Invalid roundId.');
  return withCooperationLock(root, id, async repository => {
    const before = readWorkspaceTaskRecord(repository, id);
    assertCooperationSession(repository, before, 'antigravity');
    assertRuntimeCaller(repository, before, 'codex', caller);
    if (before.resume) {
      before.resume.interruption = { roundId, revision: before.cooperation.revision, status: 'DISPATCH_UNCERTAIN' };
      before.updatedAt = now();
      writeWorkspaceTask(repository, before);
    }
    await deliver();
    const current = readWorkspaceTaskRecord(repository, id);
    if (current.status !== 'RUNNING' || current.archivedAt || current.sessions.antigravity.sessionId !== before.sessions.antigravity.sessionId) throw new Error('Task pair changed during dispatch; input may have been sent. Do not resend automatically.');
    current.cooperation = { status: 'SENT', roundId, revision: current.cooperation.revision + 1, summary: '', updatedAt: now() };
    if (current.sessions.antigravity.runtimeGeneration) current.roundRuntime = { roundId, sessionId: current.sessions.antigravity.sessionId,
      runtimeGeneration: current.sessions.antigravity.runtimeGeneration };
    if (current.resume) current.resume.interruption = null;
    current.updatedAt = now();
    return writeWorkspaceTask(repository, current, { replaceCooperation: true }).cooperation;
  });
}

export async function reportWorkspaceTask(root, id, status, roundId, summary = '', { notify = notifyWorkspaceReceipt, caller } = {}) {
  if (!['WORKING', 'DONE', 'REVIEWING', 'APPROVED', 'CHANGES_REQUESTED', 'FAILED'].includes(status)) throw new Error('Invalid report status. Use working, done, reviewing, approved, changes-requested, or failed.');
  if (!ROUND_ID_PATTERN.test(roundId || '')) throw new Error('A valid roundId is required.');
  if (typeof summary !== 'string' || Buffer.byteLength(summary) > 2048) throw new Error('Summary must be at most 2048 bytes.');
  let committedEvent = null;
  const result = await withCooperationLock(root, id, repository => {
    const record = readWorkspaceTaskRecord(repository, id);
    const slot = ['REVIEWING', 'APPROVED', 'CHANGES_REQUESTED'].includes(status) ? 'codex' : 'antigravity';
    const executorReceipt = slot === 'antigravity' && Boolean(record.resume);
    assertCooperationSession(repository, record, slot, { executorReceipt });
    assertRuntimeCaller(repository, record, slot, caller);
    if (record.resume && slot === 'antigravity' && (!record.roundRuntime || record.roundRuntime.roundId !== roundId
      || record.roundRuntime.sessionId !== record.sessions.antigravity.sessionId
      || record.roundRuntime.runtimeGeneration !== record.sessions.antigravity.runtimeGeneration)) throw new Error('This round belongs to a previous executor runtime; inspect the workspace and ask Codex for a new instruction.');
    const previous = record.cooperation;
    if (previous.roundId !== roundId) throw new Error('Stale roundId: this receipt does not belong to the current round.');
    if (previous.status !== status && !REPORT_TRANSITIONS[previous.status]?.includes(status)) throw new Error(`Invalid cooperation transition: ${previous.status} -> ${status}.`);
    const cleaned = redactOutput(summary, 2048);
    if (previous.status === status && previous.summary === cleaned) return previous;
    record.cooperation = { status, roundId, revision: previous.revision + 1, summary: cleaned, updatedAt: now() };
    record.updatedAt = now();
    const committed = writeWorkspaceTask(repository, record, { replaceCooperation: true, eventSummary: summary, executorReceipt });
    // Only new formal transitions, never summary edits, lifecycle or output.
    if (previous.status !== status && ['DONE', 'APPROVED', 'FAILED'].includes(status)) {
      committedEvent = { root: repository, task: { id: committed.id, mode: committed.mode, title: committed.title,
        cooperation: { status, roundId } } };
    }
    return committed.cooperation;
  });
  if (committedEvent) {
    // Both task locks have been released. A native child keeps a short-lived
    // report CLI alive for handoff; its result never changes this receipt.
    try { Promise.resolve(notify(committedEvent.root, committedEvent.task)).catch(() => {}); } catch { /* Isolated side effect. */ }
  }
  return result;
}
