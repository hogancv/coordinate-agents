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
import {
  acquireConfigLock,
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
import { getExecutionSessionManager, runtimeSessionClose, runtimeSessionOpen } from './session-service.mjs';
import { listRecords, readRecord } from './session-manager.mjs';
import { WORKSPACE_ROLE_PROMPT_VERSION, workspaceRolePrompt } from './workspace-role-prompts.mjs';

export const WORKSPACE_TASK_PROMPT_VERSION = WORKSPACE_ROLE_PROMPT_VERSION;
export const WORKSPACE_TASK_SLOTS = Object.freeze([
  Object.freeze({ slot: 'codex', agent: 'codex', role: 'planner-reviewer' }),
  Object.freeze({ slot: 'antigravity', agent: 'antigravity', role: 'implementer' }),
]);
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
const TERMINAL_SESSION_STATES = new Set(['exited', 'failed']);
const WORKSPACE_TASK_ID_PATTERN = /^workspace-[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const SESSION_ID_PATTERN = /^session_[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const MAX_ERROR_BYTES = 4 * 1024;
const MAX_HISTORY = 32;
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
  if (value.archivedAt !== undefined && (typeof value.archivedAt !== 'string' || Number.isNaN(Date.parse(value.archivedAt)) || value.status !== 'CLOSED')) {
    throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', 'Invalid archived Workspace Task record.', { recoverable: false, taskId: value.id });
  }
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
    ...(value.archivedAt ? { archivedAt: value.archivedAt } : {}),
    sessions,
    cooperation: validateCooperation(value.cooperation),
    startup: validateStartup(value.startup),
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

function writeWorkspaceTask(root, record, { replaceCooperation = false, resetCooperation = false, replaceStartup = false } = {}) {
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
      if (current.status !== 'RUNNING' || current.archivedAt || WORKSPACE_TASK_SLOTS.some(({ slot }) => current.sessions[slot].sessionId !== record.sessions[slot].sessionId)) {
        throw new Error('Task pair changed during cooperation update; dispatch input may have been sent. Do not resend automatically.');
      }
      // A receipt may only change cooperation fields, never restore stale Sessions or lifecycle state.
      base = { ...current, updatedAt: record.updatedAt };
    }
    if (replaceStartup && current) {
      if (!['STARTING', 'AWAITING_INPUT'].includes(current.status) || current.archivedAt
        || WORKSPACE_TASK_SLOTS.some(({ slot }) => current.sessions[slot].sessionId !== record.sessions[slot].sessionId)) {
        throw new Error('Task pair changed during startup; no automatic retry will run.');
      }
      base = { ...current, status: record.status, startup: record.startup, error: record.error, updatedAt: record.updatedAt };
    }
    const cooperation = resetCooperation ? idleCooperation((current?.cooperation.revision || 0) + 1)
      : (!replaceCooperation && current ? current.cooperation : record.cooperation);
    const validated = validateWorkspaceTaskRecord({ ...base, cooperation });
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
    ...(record.archivedAt ? { archivedAt: record.archivedAt } : {}),
    sessions,
    cooperation: record.cooperation,
    startup: record.startup,
    sessionIds: Object.fromEntries(WORKSPACE_TASK_SLOTS.map(({ slot }) => [slot, record.sessions[slot].sessionId])),
    sessionHistory: record.sessionHistory,
    error: record.error,
  };
}

export async function readWorkspaceTasks(root, { includeArchived = false } = {}) {
  const repository = repositoryRoot(root);
  const facts = sessionFactMap(repository);
  return listWorkspaceTaskRecords(repository).filter(record => includeArchived || !record.archivedAt).map(record => workspaceTaskView(record, facts));
}

export async function readWorkspaceTask(root, id) {
  const repository = repositoryRoot(root);
  const record = readWorkspaceTaskRecord(repository, id);
  // Pass targeted session IDs to sessionFactMap to avoid scanning all workspace session files
  const sessionIds = sessionIdsFor(record);
  return workspaceTaskView(record, sessionFactMap(repository, sessionIds));
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

function initialWorkspaceTask(language) {
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
    startup: initialStartup(language),
    sessionHistory: [],
    error: null,
  };
}

async function discoverTaskSessions(root, taskId) {
  try {
    return listRecords(root).filter(record => {
      if (record.taskId !== taskId || !WORKSPACE_TASK_SLOTS.some(slot => slot.agent === record.agent)) return false;
      try { return repositoryRoot(record.cwd) === repositoryRoot(root); } catch { return false; }
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
  if (agent === 'codex' && /OpenAI Codex[^\n]*\n?[^\n]*\bloading\b/i.test(normalized)) return false;
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
    ? `send '<instruction>'; read <cursor>; wait <cursor> [revision] [timeout-ms]; report reviewing|approved|changes-requested <roundId> ['summary']`
    : `report working|done|failed <roundId> ['summary']`;
  return `${workspaceRolePrompt(expected.agent, language)}\nWorkspace: ${record.id}\nHelper (run from repository root): node ${helper} ${record.id} <command>\nCommands: ${commands}\nQuote instructions and summaries safely for your shell. wait defaults to 60 seconds maximum. If the pair is still starting, retry only when no input was sent; never create another Session.`;
}

async function openWorkspaceSlot(root, record, slot, language) {
  const expected = WORKSPACE_TASK_SLOTS.find(item => item.slot === slot);
  const opened = await runtimeSessionOpen({
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
      } catch (error) {
        record = failureRecord(record, error);
        writeWorkspaceTask(repository, record, { replaceStartup: true });
      }
    }
    return jsonSuccess('workspace.task.continue', { workspaceTask: workspaceTaskView(record, sessionFactMap(repository, sessionIdsFor(record))) });
  });
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
  let record = initialWorkspaceTask(language);
  writeWorkspaceTask(root, record);
  return withCooperationLock(root, record.id, async () => {
    try {
      await openWorkspaceSlot(root, record, 'codex', language);
      await openWorkspaceSlot(root, record, 'antigravity', language);
      for (const { slot } of WORKSPACE_TASK_SLOTS) await prepareWorkspaceSlot(root, record, slot);
      record = updateRecord(record, { status: startupStatus(record), error: null });
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
  });
}

export async function runtimeWorkspaceTaskClose(input = {}) {
  const root = repositoryRoot(input.root);
  let record = readWorkspaceTaskRecord(root, input.workspaceTaskId || input.id);
  const closed = await rollbackTaskSessions(root, record);
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
  return withCooperationLock(root, input.workspaceTaskId || input.id, async () => {
    let record = readWorkspaceTaskRecord(root, input.workspaceTaskId || input.id);
    if (record.archivedAt) throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', 'Cannot restart an archived Workspace Task.', { recoverable: false, taskId: record.id });
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
          codexSessionId: record.sessions.codex.sessionId,
          antigravitySessionId: record.sessions.antigravity.sessionId,
          closedAt: now(),
        },
      ].slice(-MAX_HISTORY);
    }
    record.sessions = defaultSessions();
    record.promptVersion = WORKSPACE_TASK_PROMPT_VERSION;
    record.startup = initialStartup(language);
    record.status = 'STARTING';
    record.error = null;
    record.updatedAt = now();
    writeWorkspaceTask(root, record, { resetCooperation: true });
    try {
      await openWorkspaceSlot(root, record, 'codex', language);
      await openWorkspaceSlot(root, record, 'antigravity', language);
      for (const { slot } of WORKSPACE_TASK_SLOTS) await prepareWorkspaceSlot(root, record, slot);
      record = updateRecord(record, { status: startupStatus(record), error: null });
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
  });
}

function allTaskSessionIds(record) {
  return [...new Set([...sessionIdsFor(record), ...record.sessionHistory.flatMap(entry => [entry.codexSessionId, entry.antigravitySessionId])].filter(Boolean))];
}

const WORKSPACE_SLOT_AGENTS = new Set(WORKSPACE_TASK_SLOTS.map(slot => slot.agent));

function ownedTaskSessionFiles(root, record, sessionRecords = null) {
  const directory = join(root, '.agent-bus', 'sessions');
  assertSafePath(root, directory);
  // Performance optimization: reuse pre-read session records when provided to avoid O(A * S) disk reads
  const sessions = sessionRecords !== null ? sessionRecords : (existsSync(directory) ? listRecords(root) : []);
  const owned = sessions.filter(session => session.taskId === record.id && WORKSPACE_SLOT_AGENTS.has(session.agent));
  // Restart history is bounded, but transcript cleanup must cover every owned Session.
  return [...new Set([...allTaskSessionIds(record), ...owned.map(session => session.id)])].flatMap(id => {
    const path = join(root, '.agent-bus', 'sessions', `${id}.json`);
    assertSafePath(root, path);
    if (!existsSync(path)) return [];
    // Discovery records may contain duplicate payload IDs in different files.
    // Validate ownership and active state from the exact file being modified.
    const session = readRecord(root, id);
    if (session.id !== id || repositoryRoot(session.cwd) !== root || session.taskId !== record.id || !WORKSPACE_SLOT_AGENTS.has(session.agent)) {
      throw runtimeError('WORKSPACE_TASK_STATE_CONFLICT', 'Refusing to modify a Session owned by another task.', { recoverable: false, taskId: record.id, sessionId: id });
    }
    return [{ id, path, session }];
  });
}

export async function runtimeWorkspaceTaskArchive(input = {}) {
  const root = repositoryRoot(input.root);
  let record = readWorkspaceTaskRecord(root, input.workspaceTaskId || input.id);
  if (record.archivedAt) return jsonSuccess('workspace.task.archive', { workspaceTask: workspaceTaskView(record, sessionFactMap(root)) });
  const files = ownedTaskSessionFiles(root, record);
  const closed = await closeSessionIds(root, files.map(file => file.id));
  if (closed.errors.length || closed.results.some(session => ACTIVE_SESSION_STATES.has(session?.state))) {
    throw closed.errors[0] || runtimeError('WORKSPACE_TASK_CLOSE_FAILED', 'A Workspace terminal is still active; archive was not completed.', { recoverable: true, taskId: record.id });
  }
  record = updateRecord(record, { status: 'CLOSED', archivedAt: now() });
  writeWorkspaceTask(root, record);
  return jsonSuccess('workspace.task.archive', { workspaceTask: workspaceTaskView(record, sessionFactMap(root)) });
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
    try {
      mkdirSync(lock);
      atomicWrite(ownerPath, JSON.stringify({ owner, pid: process.pid }), join(repository, '.agent-bus', 'tmp'));
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assertSafePath(repository, lock);
      if (!lstatSync(lock).isDirectory()) throw new Error('Unsafe cooperation lock.');
      try {
        const held = JSON.parse(readInternalFile(join(repository, '.agent-bus'), ownerPath));
        try { process.kill(held.pid, 0); }
        catch (failure) { if (failure.code === 'ESRCH') { rmSync(lock, { recursive: true }); continue; } }
      } catch {
        // Allow recovery if a process died between mkdir and writing its owner.
        if (Date.now() - lstatSync(lock).mtimeMs > 120_000) { rmSync(lock, { recursive: true }); continue; }
      }
      if (Date.now() >= deadline) throw new Error('Workspace cooperation update is busy; no new input was sent.');
      await new Promise(done => setTimeout(done, 50));
    }
  }
  try { return await operation(repository); }
  finally {
    const held = JSON.parse(readInternalFile(join(repository, '.agent-bus'), ownerPath));
    if (held.owner === owner) rmSync(lock, { recursive: true });
  }
}

function assertCooperationSession(root, record, slot) {
  if (record.archivedAt || record.status !== 'RUNNING') throw new Error('Task pair is not ready. No input was sent.');
  const sessionId = record.sessions[slot].sessionId;
  if (!sessionId) throw new Error('Session task binding mismatch: no recorded Session.');
  const session = readRecord(root, sessionId);
  if (session.id !== sessionId || session.taskId !== record.id || session.agent !== slot || repositoryRoot(session.cwd) !== root) {
    throw new Error('Session task binding mismatch.');
  }
}

export async function dispatchWorkspaceTask(root, id, roundId, deliver) {
  if (!ROUND_ID_PATTERN.test(roundId || '')) throw new Error('Invalid roundId.');
  return withCooperationLock(root, id, async repository => {
    const before = readWorkspaceTaskRecord(repository, id);
    assertCooperationSession(repository, before, 'antigravity');
    await deliver();
    const current = readWorkspaceTaskRecord(repository, id);
    if (current.status !== 'RUNNING' || current.archivedAt || current.sessions.antigravity.sessionId !== before.sessions.antigravity.sessionId) throw new Error('Task pair changed during dispatch; input may have been sent. Do not resend automatically.');
    current.cooperation = { status: 'SENT', roundId, revision: current.cooperation.revision + 1, summary: '', updatedAt: now() };
    current.updatedAt = now();
    return writeWorkspaceTask(repository, current, { replaceCooperation: true }).cooperation;
  });
}

export async function reportWorkspaceTask(root, id, status, roundId, summary = '') {
  if (!['WORKING', 'DONE', 'REVIEWING', 'APPROVED', 'CHANGES_REQUESTED', 'FAILED'].includes(status)) throw new Error('Invalid report status. Use working, done, reviewing, approved, changes-requested, or failed.');
  if (!ROUND_ID_PATTERN.test(roundId || '')) throw new Error('A valid roundId is required.');
  if (typeof summary !== 'string' || Buffer.byteLength(summary) > 2048) throw new Error('Summary must be at most 2048 bytes.');
  return withCooperationLock(root, id, repository => {
    const record = readWorkspaceTaskRecord(repository, id);
    const slot = ['REVIEWING', 'APPROVED', 'CHANGES_REQUESTED'].includes(status) ? 'codex' : 'antigravity';
    assertCooperationSession(repository, record, slot);
    const previous = record.cooperation;
    if (previous.roundId !== roundId) throw new Error('Stale roundId: this receipt does not belong to the current round.');
    if (previous.status !== status && !REPORT_TRANSITIONS[previous.status]?.includes(status)) throw new Error(`Invalid cooperation transition: ${previous.status} -> ${status}.`);
    const cleaned = redactOutput(summary, 2048);
    if (previous.status === status && previous.summary === cleaned) return previous;
    record.cooperation = { status, roundId, revision: previous.revision + 1, summary: cleaned, updatedAt: now() };
    record.updatedAt = now();
    return writeWorkspaceTask(repository, record, { replaceCooperation: true }).cooperation;
  });
}
