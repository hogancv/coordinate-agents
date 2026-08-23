import { createHash, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertContained,
  assertSafePath,
  atomicWrite,
  readConfig,
  readInternalFile,
  safeInternalStat,
} from './config.mjs';
import { readUserConfig, resolveAgentConfig } from './user-config.mjs';
import { getAdapter } from '../adapters/index.mjs';
import { redactOutput } from '../adapters/executable.mjs';
import { normalizeRuntimeError, runtimeError } from './runtime-contract.mjs';
import { appendRuntimeEvent, readRuntimeEvents } from './runtime-events.mjs';

export const EXECUTION_SESSION_STATES = Object.freeze([
  'starting',
  'running',
  'idle',
  'busy',
  'exited',
  'failed',
]);

const ACTIVE_STATES = new Set(['starting', 'running', 'idle', 'busy']);
const SESSION_ID_PATTERN = /^session_[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_READ_BYTES = 32 * 1024;
const MAX_READ_LINES = 200;
const MAX_INPUT_BYTES = 256 * 1024;
const HOST_PATH = fileURLToPath(new URL('./session-host.mjs', import.meta.url));

function now() {
  return new Date().toISOString();
}

function safeArgs(args) {
  return Array.isArray(args)
    ? args.map(value => redactOutput(`${value}`, 2 * 1024))
    : [];
}

function sessionRoot(root) {
  const supplied = resolve(`${root || ''}`);
  try {
    const suppliedStat = lstatSync(supplied);
    if (!suppliedStat.isDirectory() || suppliedStat.isSymbolicLink()) {
      throw runtimeError('SESSION_STATE_CONFLICT', `Session root is not a regular directory: ${supplied}`, {
        recoverable: false,
        root: supplied,
      });
    }
  } catch (error) {
    if (error?.code === 'SESSION_STATE_CONFLICT') throw error;
    throw runtimeError('SESSION_STATE_CONFLICT', `Session root is unavailable: ${supplied}`, {
      recoverable: false,
      root: supplied,
      details: { path: supplied, cause: error.code || error.message || String(error) },
    });
  }
  let repository;
  try {
    repository = realpathSync(supplied);
  } catch (error) {
    throw runtimeError('SESSION_STATE_CONFLICT', `Session root is unavailable: ${supplied}`, {
      recoverable: false,
      root: supplied,
      details: { path: supplied, cause: error.code || error.message || String(error) },
    });
  }
  if (!existsSync(repository)) throw runtimeError('SESSION_STATE_CONFLICT', `Session root does not exist: ${repository}`, { recoverable: false, root: repository });
  const rootStat = lstatSync(repository);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw runtimeError('SESSION_STATE_CONFLICT', `Session root is not a regular directory: ${repository}`, { recoverable: false, root: repository });
  }
  const bus = join(repository, '.agent-bus');
  if (!existsSync(bus)) throw runtimeError('SESSION_STATE_CONFLICT', `Agent Bus is not initialized: ${bus}`, { recoverable: true, root: repository });
  assertSafePath(repository, bus);
  return repository;
}

export function sessionStorePath(root) {
  const repository = sessionRoot(root);
  const bus = join(repository, '.agent-bus');
  const sessions = join(bus, 'sessions');
  assertContained(bus, sessions);
  mkdirSync(sessions, { recursive: true });
  assertSafePath(repository, sessions);
  return sessions;
}

function validateSessionId(id) {
  if (typeof id !== 'string' || !SESSION_ID_PATTERN.test(id)) {
    throw runtimeError('SESSION_STATE_CONFLICT', `Invalid execution session id: ${id || '(empty)'}`, { recoverable: false, sessionId: id || null });
  }
  return id;
}

function sessionRecordPath(root, id) {
  const sessions = sessionStorePath(root);
  validateSessionId(id);
  const path = join(sessions, `${id}.json`);
  assertContained(sessions, path);
  return path;
}

function endpointFor(root, id) {
  if (process.platform === 'win32') {
    const digest = createHash('sha256').update(`${root}\u0000${id}`).digest('hex').slice(0, 40);
    return `\\\\.\\pipe\\coordinate-agents-${digest}`;
  }
  // macOS and Linux impose a short limit on AF_UNIX socket paths. Keep the
  // endpoint out of the project path and bind it to the project/session hash.
  const digest = createHash('sha256').update(`${root}\u0000${id}`).digest('hex').slice(0, 40);
  const socketDirectory = process.platform === 'darwin' ? '/tmp' : tmpdir();
  return join(socketDirectory, `coordinate-agents-${digest}.sock`);
}

function tmpDirectoryFor(root) {
  const bus = join(root, '.agent-bus');
  const tmp = join(bus, 'tmp');
  assertContained(bus, tmp);
  mkdirSync(tmp, { recursive: true });
  assertSafePath(root, tmp);
  return tmp;
}

function publicRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    agent: record.agent,
    command: record.command,
    resolvedCommand: record.resolvedCommand || null,
    args: safeArgs(record.args),
    cwd: record.cwd,
    pid: Number.isInteger(record.pid) ? record.pid : null,
    state: record.state,
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
    exitCode: record.exitCode ?? null,
    signal: record.signal || null,
    error: record.error ? redactOutput(record.error, 2 * 1024) : null,
  };
}

function writeRecord(root, record) {
  const path = sessionRecordPath(root, record.id);
  const bus = join(root, '.agent-bus');
  atomicWrite(path, `${JSON.stringify({
    schemaVersion: 1,
    id: record.id,
    agent: record.agent,
    command: record.command,
    resolvedCommand: record.resolvedCommand || null,
    args: safeArgs(record.args),
    cwd: record.cwd,
    pid: Number.isInteger(record.pid) ? record.pid : null,
    state: record.state,
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
    exitCode: record.exitCode ?? null,
    signal: record.signal || null,
    error: record.error ? redactOutput(record.error, 2 * 1024) : null,
    endpoint: record.endpoint,
    hostPid: Number.isInteger(record.hostPid) ? record.hostPid : null,
  }, null, 2)}\n`, join(bus, 'tmp'));
  return record;
}

function sessionStateEventType(state) {
  return ({
    starting: 'SESSION_STARTING',
    running: 'SESSION_STARTED',
    idle: 'SESSION_IDLE',
    busy: 'SESSION_BUSY',
    exited: 'SESSION_EXITED',
    failed: 'SESSION_FAILED',
  })[state] || null;
}

function appendSessionEvent(root, record, type, data = {}, associations = {}) {
  if (!record || !type) return null;
  return appendRuntimeEvent(root, {
    type,
    taskId: associations.taskId,
    sessionId: record.id,
    agentId: record.agent,
    data: {
      state: record.state,
      exitCode: record.exitCode ?? null,
      signal: record.signal || null,
      error: record.error || null,
      ...data,
    },
  });
}

function ensureSessionStateEvent(root, record, associations = {}) {
  const type = sessionStateEventType(record?.state);
  if (!type) return;
  const latest = readRuntimeEvents(root, { sessionId: record.id, limit: 1 }).at(-1);
  if (record.state === 'exited' && latest?.type === 'SESSION_CLOSED') return;
  if (latest?.type === type && latest?.data?.state === record.state) return;
  appendSessionEvent(root, record, type, {}, associations);
}

function parseRecord(root, path) {
  const bus = join(root, '.agent-bus');
  safeInternalStat(join(root, '.agent-bus', 'sessions'), path);
  const record = JSON.parse(readInternalFile(bus, path));
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(`Invalid execution session record: ${path}`);
  validateSessionId(record.id);
  if (typeof record.agent !== 'string' || typeof record.command !== 'string' || typeof record.cwd !== 'string') throw new Error(`Incomplete execution session record: ${path}`);
  if (!EXECUTION_SESSION_STATES.includes(record.state)) throw new Error(`Invalid execution session state: ${record.state}`);
  return record;
}

function readRecord(root, id) {
  const path = sessionRecordPath(root, id);
  if (!existsSync(path)) throw runtimeError('SESSION_NOT_FOUND', `Execution session not found: ${id}`, { recoverable: false, sessionId: id, root });
  try { return parseRecord(root, path); } catch (error) {
    if (error.code === 'SESSION_NOT_FOUND') throw error;
    throw runtimeError('SESSION_STATE_CONFLICT', `Failed to load execution session ${id}: ${error.message || error}`, { recoverable: false, sessionId: id, root });
  }
}

function listRecords(root) {
  const sessions = sessionStorePath(root);
  const result = [];
  for (const name of readdirSync(sessions)) {
    if (!name.endsWith('.json')) continue;
    const path = join(sessions, name);
    try { result.push(parseRecord(root, path)); } catch {
      // A corrupt session record is not allowed to become a launch command or
      // an implicit recovery action. It is omitted from reuse candidates.
    }
  }
  return result.sort((a, b) => `${b.lastActivityAt || ''}`.localeCompare(`${a.lastActivityAt || ''}`));
}

function mergeRuntimeRecord(record, runtime) {
  return {
    ...record,
    pid: Number.isInteger(runtime?.pid) ? runtime.pid : null,
    state: EXECUTION_SESSION_STATES.includes(runtime?.state) ? runtime.state : record.state,
    lastActivityAt: runtime?.lastActivityAt || record.lastActivityAt,
    exitCode: runtime?.exitCode ?? record.exitCode ?? null,
    signal: runtime?.signal || record.signal || null,
    error: runtime?.error || record.error || null,
  };
}

function requestHost(record, command, { timeoutMs = 2_000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let buffer = '';
    const socket = createConnection(record.endpoint);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(runtimeError('SESSION_NOT_ATTACHED', `Execution session host is unavailable: ${record.id}`, { recoverable: true, sessionId: record.id, root: record.cwd }));
    }, Math.max(100, timeoutMs));
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error); else resolvePromise(value);
    };
    socket.setEncoding('utf8');
    socket.on('error', error => finish(runtimeError('SESSION_NOT_ATTACHED', `Execution session host is unavailable: ${record.id}: ${error.message || error}`, { recoverable: true, sessionId: record.id, root: record.cwd })));
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) {
        finish(runtimeError('SESSION_RUNTIME_ERROR', `Execution session host response exceeded the size limit: ${record.id}`, { recoverable: true, sessionId: record.id, root: record.cwd }));
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      let response;
      try { response = JSON.parse(line); } catch (error) {
        finish(runtimeError('SESSION_RUNTIME_ERROR', `Invalid execution session host response: ${error.message}`, { recoverable: true, sessionId: record.id, root: record.cwd }));
        return;
      }
      if (!response.ok) {
        const hostError = response.error || {};
        finish(runtimeError(hostError.code || 'SESSION_RUNTIME_ERROR', hostError.message || 'Execution session host operation failed.', { recoverable: true, sessionId: record.id, root: record.cwd }));
      } else finish(null, response.result);
    });
    socket.once('connect', () => {
      try { socket.write(`${JSON.stringify({ id: randomUUID(), ...command })}\n`); } catch (error) {
        finish(runtimeError('SESSION_RUNTIME_ERROR', error.message || String(error), { recoverable: true, sessionId: record.id, root: record.cwd }));
      }
    });
  });
}

async function syncHostRecord(root, record) {
  if (!ACTIVE_STATES.has(record.state)) {
    ensureSessionStateEvent(root, record);
    return record;
  }
  try {
    const runtime = await requestHost(record, { op: 'status' });
    // The host persists terminal PTY state independently of this status
    // request. A response captured just before exit must not overwrite a
    // newer durable `failed`/`exited` record after the host has shut down.
    let base = record;
    try {
      const latest = readRecord(root, record.id);
      if (!ACTIVE_STATES.has(latest.state)) {
        ensureSessionStateEvent(root, latest);
        return latest;
      }
      base = latest;
    } catch { /* Keep the validated record if the latest read races cleanup. */ }
    const updated = mergeRuntimeRecord(base, runtime);
    writeRecord(root, updated);
    if (updated.state !== base.state) ensureSessionStateEvent(root, updated);
    return updated;
  } catch (error) {
    // A host closes shortly after persisting a terminal PTY state. Prefer that
    // durable fact over converting a normal process exit into a host failure.
    try {
      const latest = readRecord(root, record.id);
      if (!ACTIVE_STATES.has(latest.state)) return latest;
    } catch { /* Fall through to the explicit host-unavailable failure. */ }
    const failed = {
      ...record,
      pid: null,
      state: 'failed',
      lastActivityAt: now(),
      error: `Session host unavailable: ${error.message || error}`,
    };
    writeRecord(root, failed);
    appendSessionEvent(root, failed, 'SESSION_FAILED');
    return failed;
  }
}

function resolveLaunch(adapter, { root, agent, initialPrompt = '', language = 'en' }) {
  if (typeof adapter.resolveSessionLaunch === 'function') {
    return adapter.resolveSessionLaunch({ root, agent, initialPrompt, language });
  }
  const launch = adapter.resolveLaunch({ root, prompt: initialPrompt, agent, language });
  return { ...launch, initialInputConsumed: Boolean(initialPrompt) };
}

export function resolveConfiguredSessionAgent(root, agent) {
  const repository = sessionRoot(root);
  if (typeof agent !== 'string' || !agent.trim()) throw runtimeError('INVALID_AGENT_CONFIG', 'Session agent is required.', { recoverable: false, root: repository });
  const busConfig = readConfig(join(repository, '.agent-bus'));
  const projectAgent = busConfig.agents.find(item => item.id === agent);
  if (!projectAgent) throw runtimeError('INVALID_AGENT_CONFIG', `Agent is not registered: ${agent}`, { recoverable: false, agent, root: repository });
  let resolved;
  let adapter;
  try {
    resolved = resolveAgentConfig(projectAgent, readUserConfig());
    adapter = getAdapter(resolved.adapter, resolved);
  } catch (error) {
    throw runtimeError(error.code || 'INVALID_AGENT_CONFIG', error.message || String(error), { recoverable: false, agent, adapter: projectAgent.adapter, command: projectAgent.command || null, root: repository });
  }
  const compatibility = adapter.validateConfiguration({ setup: true });
  if (!compatibility.compatible) throw runtimeError(compatibility.code || 'UNSUPPORTED_CAPABILITY', compatibility.details || 'Configured adapter cannot open an execution session.', { recoverable: false, agent, adapter: resolved.adapter, command: resolved.command || null, root: repository, details: compatibility.details });
  const detection = adapter.detect({ version: false });
  if (!detection.available) throw runtimeError(detection.code === 'COMMAND_NOT_FOUND' ? 'EXECUTABLE_NOT_FOUND' : detection.code || 'EXECUTABLE_NOT_RUNNABLE', detection.details || `Executable is unavailable: ${resolved.command || '(none)'}`, { recoverable: true, agent, adapter: resolved.adapter, command: resolved.command || null, root: repository, stage: 'executable', result: detection, details: { agent, command: resolved.command || null, root: repository } });
  return { root: repository, busConfig, projectAgent, resolved, adapter, detection };
}

export class ExecutionSessionManager {
  constructor({ maxOutputBytes = MAX_OUTPUT_BYTES, hostPath = HOST_PATH } = {}) {
    this.maxOutputBytes = maxOutputBytes;
    this.hostPath = hostPath;
    this.openLocks = new Map();
  }

  async findReusable(root, agent, command = null) {
    const repository = sessionRoot(root);
    for (const record of listRecords(repository).filter(item => item.agent === agent && ACTIVE_STATES.has(item.state) && (!command || item.command === command))) {
      const current = await syncHostRecord(repository, record);
      if (ACTIVE_STATES.has(current.state)) return current;
    }
    return null;
  }

  async findPreferred(root, sessionId, agent, command) {
    if (!sessionId) return null;
    const repository = sessionRoot(root);
    const record = readRecord(repository, sessionId);
    if (record.agent !== agent || (command && record.command !== command)) return null;
    const current = await syncHostRecord(repository, record);
    return ACTIVE_STATES.has(current.state) ? current : null;
  }

  async open(options = {}) {
    const repository = sessionRoot(options.root);
    const key = `${repository}\u0000${options.agent || ''}\u0000${options.resolved?.command || ''}`;
    const previous = this.openLocks.get(key) || Promise.resolve();
    let release;
    const lock = new Promise(resolvePromise => { release = resolvePromise; });
    this.openLocks.set(key, lock);
    await previous;
    try {
      return await this._open({ ...options, root: repository });
    } finally {
      release();
      if (this.openLocks.get(key) === lock) this.openLocks.delete(key);
    }
  }

  async _open({ root, agent, sessionId = null, resolved, adapter, initialPrompt = '', language = 'en', taskId = null } = {}) {
    const repository = sessionRoot(root);
    if (typeof initialPrompt !== 'string' || Buffer.byteLength(initialPrompt, 'utf8') > MAX_INPUT_BYTES) {
      throw runtimeError('SESSION_START_FAILED', 'Initial session input exceeds the size limit.', {
        recoverable: false,
        agent,
        command: resolved?.command || null,
        root: repository,
      });
    }
    const preferred = await this.findPreferred(repository, sessionId, agent, resolved?.command || null);
    const existing = preferred || await this.findReusable(repository, agent, resolved?.command || null);
    if (existing) {
      appendSessionEvent(repository, existing, 'SESSION_REUSED', {}, { taskId });
      return { session: publicRecord(existing), reused: true, initialInputConsumed: false };
    }
    const launch = resolveLaunch(adapter, { root: repository, agent, initialPrompt, language });
    if (!launch?.command || !Array.isArray(launch.args)) throw runtimeError('SESSION_START_FAILED', 'Adapter did not return a safe PTY launch.', { recoverable: false, agent, command: resolved?.command || null, root: repository });
    // Re-run the adapter's exact configured-command check immediately before
    // starting the owned host. This preserves adapter-specific Windows
    // resolution (including .cmd entrypoints) and custom executable names.
    const checked = adapter.detect({ version: false });
    if (!checked.available) throw runtimeError(checked.code === 'COMMAND_NOT_FOUND' ? 'EXECUTABLE_NOT_FOUND' : checked.code || 'EXECUTABLE_NOT_RUNNABLE', checked.details || `Executable is unavailable: ${resolved?.command || '(none)'}`, { recoverable: true, agent, adapter: resolved?.adapter || null, command: resolved?.command || null, root: repository, stage: 'executable', details: { agent, command: resolved?.command || null, root: repository } });
    const id = `session_${randomUUID().replaceAll('-', '')}`;
    const endpoint = endpointFor(repository, id);
    const createdAt = now();
    const record = {
      id,
      agent,
      command: resolved.command,
      resolvedCommand: checked.resolvedCommand || launch.resolvedCommand || launch.command,
      args: launch.args,
      cwd: repository,
      pid: null,
      state: 'starting',
      createdAt,
      lastActivityAt: createdAt,
      exitCode: null,
      signal: null,
      error: null,
      endpoint,
      hostPid: null,
    };
    writeRecord(repository, record);
    appendSessionEvent(repository, record, 'SESSION_STARTING', {}, { taskId });
    let host;
    try {
      host = fork(this.hostPath, [], {
        cwd: repository,
        detached: true,
        execArgv: [],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: false,
      });
      record.hostPid = host.pid || null;
      writeRecord(repository, record);
      await new Promise((resolvePromise, reject) => {
        host.once('error', reject);
        host.send({
          type: 'init',
          session: {
            id,
            agent,
            command: resolved.command,
            resolvedCommand: record.resolvedCommand,
            args: launch.args,
            cwd: repository,
            endpoint,
            metadataPath: sessionRecordPath(repository, id),
            tmpDirectory: tmpDirectoryFor(repository),
            spawnCommand: launch.command,
            spawnArgs: [...(launch.prefix || []), ...launch.args],
            maxOutputBytes: this.maxOutputBytes,
            createdAt,
            root: repository,
          },
        }, error => error ? reject(error) : resolvePromise());
      });
      try { host.disconnect(); } catch { /* Host is intentionally detached. */ }
      host.unref();
    } catch (error) {
      // The host is the only owner of the child process. Ask it to close first
      // so an IPC/socket startup failure cannot leave an orphaned Implementer.
      try { await requestHost(record, { op: 'close', graceful: false, timeoutMs: 500 }, { timeoutMs: 700 }); } catch { /* The host may not have bound yet. */ }
      try { host?.kill(); } catch { /* Only the host process created above is eligible. */ }
      const failed = { ...record, state: 'failed', lastActivityAt: now(), error: error.message || String(error) };
      writeRecord(repository, failed);
      appendSessionEvent(repository, failed, 'SESSION_FAILED', {}, { taskId });
      throw runtimeError('SESSION_START_FAILED', `Failed to start execution session ${id}: ${error.message || error}`, { recoverable: true, agent, command: resolved.command, root: repository, sessionId: id, details: { agent, command: resolved.command, root: repository } });
    }

    const deadline = Date.now() + 5_000;
    const healthyStabilityMs = 200;
    let healthySince = null;
    let startupActivityObserved = false;
    let current = record;
    while (Date.now() < deadline) {
      try {
        const runtime = await requestHost(current, { op: 'status' }, { timeoutMs: 500 });
        let base = current;
        try {
          const latest = readRecord(repository, id);
          if (!ACTIVE_STATES.has(latest.state)) {
            current = latest;
            break;
          }
          base = latest;
        } catch { /* Keep the current validated startup record. */ }
        current = mergeRuntimeRecord(base, runtime);
        startupActivityObserved ||= Number(runtime?.bufferedBytes || 0) > 0
          || Number(runtime?.outputCursor || 0) > 0
          || ['idle', 'busy'].includes(current.state);
        writeRecord(repository, current);
      } catch {
        // A short-lived Implementer may close its host before the next probe,
        // but the host persists the terminal state first. Prefer that durable
        // fact instead of mistaking the last healthy probe for a successful
        // startup.
        try {
          const latest = readRecord(repository, id);
          if (!ACTIVE_STATES.has(latest.state)) {
            current = latest;
            break;
          }
        } catch { /* Keep probing until the bounded startup deadline. */ }
      }
      if (!ACTIVE_STATES.has(current.state)) break;
      if (current.state !== 'starting' && startupActivityObserved) {
        healthySince ??= Date.now();
        if (Date.now() - healthySince >= healthyStabilityMs) break;
      } else healthySince = null;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
    }
    if (current.state !== 'starting') ensureSessionStateEvent(repository, current, { taskId });
    return { session: publicRecord(current), reused: false, initialInputConsumed: Boolean(launch.initialInputConsumed) };
  }

  async status(root, id) {
    const repository = sessionRoot(root);
    const record = readRecord(repository, id);
    const current = await syncHostRecord(repository, record);
    return publicRecord(current);
  }

  async inspect(root, id, { maxLines = 100, maxBytes = 16 * 1024 } = {}) {
    const repository = sessionRoot(root);
    const record = readRecord(repository, id);
    const current = await syncHostRecord(repository, record);
    let output = { output: '', nextCursor: null, truncated: false };
    if (ACTIVE_STATES.has(current.state)) {
      const boundedLines = Number.isInteger(maxLines) ? Math.min(MAX_READ_LINES, Math.max(1, maxLines)) : 100;
      const boundedBytes = Number.isInteger(maxBytes) ? Math.min(MAX_READ_BYTES, Math.max(1, maxBytes)) : 16 * 1024;
      try { output = await requestHost(current, { op: 'read', maxLines: boundedLines, maxBytes: boundedBytes }); } catch { /* Status remains the inspectable fact. */ }
    }
    return { session: publicRecord(current), output: { ...output, output: redactOutput(output.output || '', Math.min(MAX_READ_BYTES, maxBytes)) } };
  }

  async read(root, id, { cursor = null, maxLines = 100, maxBytes = MAX_READ_BYTES } = {}) {
    const repository = sessionRoot(root);
    const record = readRecord(repository, id);
    const current = await syncHostRecord(repository, record);
    if (!ACTIVE_STATES.has(current.state)) return { session: publicRecord(current), output: '', nextCursor: null, truncated: false };
    const result = await requestHost(current, {
      op: 'read',
      cursor: Number.isInteger(cursor) ? cursor : null,
      maxLines: Math.min(MAX_READ_LINES, Math.max(1, Number.isInteger(maxLines) ? maxLines : 100)),
      maxBytes: Math.min(MAX_READ_BYTES, Math.max(1, Number.isInteger(maxBytes) ? maxBytes : MAX_READ_BYTES)),
    });
    return { session: publicRecord(current), ...result, output: redactOutput(result.output || '', MAX_READ_BYTES) };
  }

  async write(root, id, input, { submit = true, taskId = null } = {}) {
    const repository = sessionRoot(root);
    if (typeof input !== 'string' || input.length === 0) throw runtimeError('SESSION_WRITE_FAILED', 'Session input must be a non-empty string.', { recoverable: false, sessionId: id, root: repository });
    if (input.length > 256 * 1024) throw runtimeError('SESSION_WRITE_FAILED', 'Session input exceeds the size limit.', { recoverable: false, sessionId: id, root: repository });
    const record = readRecord(repository, id);
    const current = await syncHostRecord(repository, record);
    if (!ACTIVE_STATES.has(current.state)) throw runtimeError('SESSION_NOT_HEALTHY', `Execution session ${id} is not writable in state ${current.state}.`, { recoverable: true, sessionId: id, root: repository });
    const runtime = await requestHost(current, { op: 'write', input, submit });
    const updated = mergeRuntimeRecord(current, runtime);
    writeRecord(repository, updated);
    if (updated.state !== current.state) {
      const type = sessionStateEventType(updated.state);
      appendSessionEvent(repository, updated, type, {}, { taskId });
    }
    return publicRecord(updated);
  }

  async resize(root, id, cols, rows) {
    const repository = sessionRoot(root);
    const record = readRecord(repository, id);
    const current = await syncHostRecord(repository, record);
    if (!ACTIVE_STATES.has(current.state)) throw runtimeError('SESSION_NOT_HEALTHY', `Execution session ${id} is not resizable in state ${current.state}.`, { recoverable: true, sessionId: id, root: repository });
    const runtime = await requestHost(current, { op: 'resize', cols, rows });
    const updated = mergeRuntimeRecord(current, runtime);
    writeRecord(repository, updated);
    return publicRecord(updated);
  }

  async interrupt(root, id) {
    const repository = sessionRoot(root);
    const record = readRecord(repository, id);
    const current = await syncHostRecord(repository, record);
    if (!ACTIVE_STATES.has(current.state)) return publicRecord(current);
    const runtime = await requestHost(current, { op: 'interrupt' });
    const updated = mergeRuntimeRecord(current, runtime);
    writeRecord(repository, updated);
    return publicRecord(updated);
  }

  async close(root, id, { graceful = true, timeoutMs = 2_000 } = {}) {
    const repository = sessionRoot(root);
    const record = readRecord(repository, id);
    const current = await syncHostRecord(repository, record);
    if (!ACTIVE_STATES.has(current.state)) return publicRecord(current);
    try {
      const runtime = await requestHost(current, { op: 'close', graceful, timeoutMs }, { timeoutMs: Math.max(5_000, timeoutMs + 2_000) });
      const updated = mergeRuntimeRecord(current, runtime);
      writeRecord(repository, updated);
      appendSessionEvent(repository, updated, 'SESSION_CLOSED');
      return publicRecord(updated);
    } catch (error) {
      const failed = { ...current, pid: null, state: 'failed', lastActivityAt: now(), error: error.message || String(error) };
      writeRecord(repository, failed);
      appendSessionEvent(repository, failed, 'SESSION_FAILED');
      throw normalizeRuntimeError(error, 'SESSION_CLOSE_FAILED');
    }
  }

  async find(root, id) {
    const repository = sessionRoot(root);
    return publicRecord(readRecord(repository, id));
  }
}

let defaultManager;
export function getExecutionSessionManager() {
  if (!defaultManager) defaultManager = new ExecutionSessionManager();
  return defaultManager;
}

export { ACTIVE_STATES, publicRecord, readRecord, listRecords };
