import { createHash, randomUUID } from 'node:crypto';
import { execFile, fork } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertContained,
  assertSafePath,
  atomicWrite,
  readConfig,
  readInternalFile,
  safeInternalStat,
} from './config.mjs';
import { readUserConfig, resolveAgentConfig, userConfigPath } from './user-config.mjs';
import { getAdapter, getAdapterContract } from '../adapters/index.mjs';
import {
  validateConfigurationResult,
  validateDetectionResult,
  validateLaunchResult,
  validateRuntimeLaunchPlan,
} from '../adapters/contract-v1.mjs';
import { redactOutput } from '../adapters/executable.mjs';
import { loadConfiguredTrustedAdapters } from '../adapters/trusted-local.mjs';
import { normalizeRuntimeError, runtimeError } from './runtime-contract.mjs';
import { appendRuntimeEvent, readRuntimeEvents } from './runtime-events.mjs';
import { validateRuntimeGeneration } from './workspace-native-identity.mjs';

export const EXECUTION_SESSION_STATES = Object.freeze([
  'starting',
  'running',
  'idle',
  'busy',
  'exited',
  'failed',
]);

const ACTIVE_STATES = new Set(['starting', 'running', 'idle', 'busy']);
const HEALTHY_STARTUP_STATES = new Set(['running', 'idle', 'busy']);
const SESSION_ID_PATTERN = /^session_[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_READ_BYTES = 32 * 1024;
const MAX_READ_LINES = 200;
const MAX_PERSISTED_OUTPUT_BYTES = 8 * 1024;
const MAX_INPUT_BYTES = 256 * 1024;
const HOST_PATH = fileURLToPath(new URL('./session-host.mjs', import.meta.url));

function now() {
  return new Date().toISOString();
}

function ownedProcessIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function waitForOwnedHostExit(pid, timeoutMs = 1_000) {
  if (!ownedProcessIsAlive(pid)) return true;
  const deadline = Date.now() + Math.max(100, Math.min(5_000, Number.isFinite(timeoutMs) ? timeoutMs : 1_000));
  while (Date.now() < deadline && ownedProcessIsAlive(pid)) {
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  }
  return !ownedProcessIsAlive(pid);
}

async function terminateOwnedHost(pid) {
  if (!ownedProcessIsAlive(pid)) return true;
  if (process.platform === 'win32') {
    await new Promise(resolvePromise => {
      execFile('taskkill.exe', ['/PID', `${pid}`, '/T', '/F'], {
        windowsHide: true, timeout: 1_500,
      }, () => resolvePromise());
    });
  } else {
    try { process.kill(pid, 'SIGTERM'); } catch { /* The exact owned host may have exited. */ }
  }
  return waitForOwnedHostExit(pid, 500);
}

async function reapOwnedHost(pid, timeoutMs = 1000) {
  await terminateOwnedHost(pid);
  if (await waitForOwnedHostExit(pid, timeoutMs)) return true;
  // A blocked native initializer or stuck JS handler may never handle SIGTERM.
  if (process.platform !== 'win32') {
    try { process.kill(pid, 'SIGKILL'); } catch { /* Already exited. */ }
  }
  return waitForOwnedHostExit(pid, timeoutMs);
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
    repository = realpathSync.native(supplied);
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
    runtimeGeneration: record.runtimeGeneration || null,
    agent: record.agent,
    command: record.command,
    resolvedCommand: record.resolvedCommand || null,
    args: safeArgs(record.args),
    cwd: record.cwd,
    pid: Number.isInteger(record.pid) ? record.pid : null,
    backend: record.backend || null,
    diagnostics: record.diagnostics || null,
    cols: record.cols ?? null,
    rows: record.rows ?? null,
    state: record.state,
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
    exitCode: record.exitCode ?? null,
    signal: record.signal || null,
    error: record.error ? redactOutput(record.error, 2 * 1024) : null,
    taskId: record.taskId || null,
    subtaskId: record.subtaskId || null,
  };
}

function writeRecord(root, record) {
  const path = sessionRecordPath(root, record.id);
  const bus = join(root, '.agent-bus');
  atomicWrite(path, `${JSON.stringify({
    schemaVersion: 1,
    id: record.id,
    runtimeGeneration: record.runtimeGeneration || null,
    adapter: record.adapter || null,
    agent: record.agent,
    command: record.command,
    resolvedCommand: record.resolvedCommand || null,
    args: safeArgs(record.args),
    cwd: record.cwd,
    pid: Number.isInteger(record.pid) ? record.pid : null,
    backend: record.backend || null,
    diagnostics: record.diagnostics || null,
    cols: record.cols ?? null,
    rows: record.rows ?? null,
    state: record.state,
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
    exitCode: record.exitCode ?? null,
    signal: record.signal || null,
    error: record.error ? redactOutput(record.error, 2 * 1024) : null,
    outputTail: record.outputTail ? redactOutput(record.outputTail, MAX_PERSISTED_OUTPUT_BYTES) : '',
    outputCursor: record.outputCursor ?? null,
    outputTailStartCursor: record.outputTailStartCursor ?? null,
    endpoint: record.endpoint,
    hostPid: Number.isInteger(record.hostPid) ? record.hostPid : null,
    taskId: record.taskId || null,
    subtaskId: record.subtaskId || null,
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
    taskId: associations.taskId || record.taskId,
    subtaskId: associations.subtaskId || record.subtaskId,
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
  if (HEALTHY_STARTUP_STATES.has(record?.state)) {
    const started = readRuntimeEvents(root, {
      sessionId: record.id,
      type: 'SESSION_STARTED',
      limit: 1,
    }).at(-1);
    if (!started) appendSessionEvent(root, record, 'SESSION_STARTED', {}, associations);
    if (record.state === 'running') return;
  }
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
  if (record.runtimeGeneration != null) validateRuntimeGeneration(record.runtimeGeneration);
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
  const repository = sessionRoot(root);
  const sessions = sessionStorePath(repository);
  const result = [];
  for (const name of readdirSync(sessions)) {
    if (!name.endsWith('.json')) continue;
    const path = join(sessions, name);
    try { result.push(parseRecord(repository, path)); } catch {
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
    backend: runtime?.backend || record.backend || null,
    diagnostics: runtime?.diagnostics || record.diagnostics || null,
    cols: runtime?.cols ?? record.cols ?? null,
    rows: runtime?.rows ?? record.rows ?? null,
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

function subscribeHost(record, { cursor, onEvent, onError = () => {}, signal }) {
  return new Promise((resolveSubscription, reject) => {
    let ready = false;
    let stopped = false;
    let terminal = false;
    let paused = false;
    let buffer = '';
    const socket = createConnection(record.endpoint);
    const timer = setTimeout(() => fail(new Error('Session subscription timed out.')), 2_000);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      socket.destroy();
    };
    const fail = error => {
      if (stopped) return;
      stop();
      if (ready) onError(error); else reject(error);
    };
    const abort = () => {
      if (!ready) reject(new Error('Session subscription cancelled.'));
      stop();
    };
    const consume = () => {
      while (!stopped && !paused) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { fail(new Error('Invalid Session subscription message.')); return; }
        if (!ready) {
          if (!message.ok || !message.result?.subscribed) { fail(new Error('Session Host does not support subscriptions.')); return; }
          ready = true;
          clearTimeout(timer);
          resolveSubscription(stop);
          continue;
        }
        if (!['terminal-output', 'terminal-state'].includes(message.event)) continue;
        const session = publicRecord(mergeRuntimeRecord(record, message.session));
        if (message.event === 'terminal-state' && !ACTIVE_STATES.has(session.state)) terminal = true;
        try {
          if (onEvent({ event: message.event, session, ...(message.output ? { output: message.output } : {}) }) === false) {
            paused = true;
            socket.pause();
          }
        } catch (error) { fail(error); return; }
      }
    };
    stop.resume = () => { if (!stopped) { paused = false; consume(); if (!paused) socket.resume(); } };
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) { fail(new Error('Session subscription exceeded its buffer limit.')); return; }
      consume();
    });
    socket.on('error', fail);
    socket.once('close', () => {
      if (terminal) stop();
      else fail(new Error('Session subscription disconnected.'));
    });
    socket.once('connect', () => socket.write(`${JSON.stringify({ id: randomUUID(), op: 'subscribe', cursor })}\n`));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

function readPersistedPage(record, cursor, maxLines, maxBytes) {
  const bytes = Buffer.from(record.outputTail || '');
  const start = record.outputTailStartCursor;
  let offset = Math.min(bytes.length, Math.max(0, (cursor ?? start) - start));
  while (offset < bytes.length && (bytes[offset] & 0xc0) === 0x80) offset += 1;
  let end = Math.min(bytes.length, offset + maxBytes);
  while (end > offset && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end -= 1;
  if (end === offset && offset < bytes.length) {
    end += 1;
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end += 1;
  }
  let lines = 0;
  for (let i = offset; i < end; i += 1) {
    if (bytes[i] === 10 && ++lines >= maxLines) { end = i + 1; break; }
  }
  return { output: bytes.subarray(offset, end).toString('utf8'), cursor,
    nextCursor: start + end, latestCursor: record.outputCursor,
    truncated: (cursor ?? 0) < start, hasMore: end < bytes.length };
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
    // The live Host owns runtime metadata and outputTail. A delayed RPC
    // response must not republish an older tail over its final output.
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
      diagnostics: { ...record.diagnostics, ...(record.backend === 'node-pty' ? { nativeStatus: 'failed' } : {}), failure: { stage: 'host', code: 'HOST_UNAVAILABLE' } },
    };
    // Persisted PIDs can outlive their Host and be reused. Polling has no
    // current process ownership proof, so it must never signal that PID.
    // Startup cleanup still reaps the Host forked by this open() call.
    writeRecord(root, failed);
    appendSessionEvent(root, failed, 'SESSION_FAILED');
    return failed;
  }
}

function resolveLaunch(adapter, { root, agent, initialPrompt = '', language = 'en', workspace = false, conversationId }) {
  const contract = getAdapterContract(adapter);
  if (contract) {
    if (!contract.capabilities.persistentSession) {
      throw runtimeError('UNSUPPORTED_CAPABILITY', `Adapter "${contract.id}" does not support persistent sessions.`, {
        recoverable: false,
        adapter: contract.id,
        root,
        agent,
      });
    }
    return validateLaunchResult(
      adapter.resolveSessionLaunch({ root, agent, initialPrompt, language, workspace, ...(conversationId !== undefined ? { conversationId } : {}) }),
      { kind: 'persistent-session' },
    );
  }
  if (typeof adapter.resolveSessionLaunch === 'function') {
    return adapter.resolveSessionLaunch({ root, agent, initialPrompt, language, workspace });
  }
  const launch = adapter.resolveLaunch({ root, prompt: initialPrompt, agent, language, workspace });
  return { ...launch, initialInputConsumed: Boolean(initialPrompt) };
}

export async function resolveConfiguredSessionAgent(root, agent) {
  const repository = sessionRoot(root);
  if (typeof agent !== 'string' || !agent.trim()) throw runtimeError('INVALID_AGENT_CONFIG', 'Session agent is required.', { recoverable: false, root: repository });
  const busConfig = readConfig(join(repository, '.agent-bus'));
  const projectAgent = busConfig.agents.find(item => item.id === agent);
  if (!projectAgent) throw runtimeError('INVALID_AGENT_CONFIG', `Agent is not registered: ${agent}`, { recoverable: false, agent, root: repository });
  let resolved;
  let adapter;
  let userConfig;
  try {
    userConfig = readUserConfig();
    await loadConfiguredTrustedAdapters(userConfig, { baseDir: dirname(userConfigPath()) });
    resolved = resolveAgentConfig(projectAgent, userConfig);
    adapter = getAdapter(resolved.adapter, resolved);
  } catch (error) {
    throw runtimeError(error.code || 'INVALID_AGENT_CONFIG', error.message || String(error), { recoverable: false, agent, adapter: projectAgent.adapter, command: projectAgent.command || null, root: repository });
  }
  const contract = getAdapterContract(adapter);
  const compatibility = contract && contract.capabilities.configuration
    ? validateConfigurationResult(adapter.validateConfiguration({ setup: true }))
    : adapter.validateConfiguration({ setup: true });
  if (!compatibility.compatible) throw runtimeError(compatibility.code || 'UNSUPPORTED_CAPABILITY', compatibility.details || 'Configured adapter cannot open an execution session.', { recoverable: false, agent, adapter: resolved.adapter, command: resolved.command || null, root: repository, details: compatibility.details });
  if (contract && !contract.capabilities.detection) {
    throw runtimeError('UNSUPPORTED_CAPABILITY', `Adapter "${contract.id}" does not support executable detection.`, { recoverable: false, agent, adapter: contract.id, command: resolved.command || null, root: repository });
  }
  const detection = contract ? validateDetectionResult(adapter.detect({ version: false })) : adapter.detect({ version: false });
  if (!detection.available) throw runtimeError(detection.code === 'COMMAND_NOT_FOUND' ? 'EXECUTABLE_NOT_FOUND' : detection.code || 'EXECUTABLE_NOT_RUNNABLE', detection.details || `Executable is unavailable: ${resolved.command || '(none)'}`, { recoverable: true, agent, adapter: resolved.adapter, command: resolved.command || null, root: repository, stage: 'executable', result: detection, details: { agent, command: resolved.command || null, root: repository } });
  return { root: repository, busConfig, projectAgent, resolved, adapter, detection };
}

export class ExecutionSessionManager {
  constructor({ maxOutputBytes = MAX_OUTPUT_BYTES, hostPath = HOST_PATH } = {}) {
    this.maxOutputBytes = maxOutputBytes;
    this.hostPath = hostPath;
    this.openLocks = new Map();
    this.nativeProbe = null;
  }

  async _verifyWindowsNative(cwd) {
    if (process.platform !== 'win32') return false;
    // Cache this runtime/host combination, not a global or persisted setting.
    // The disposable Host shields the Web server from native aborts.
    this.nativeProbe ??= new Promise((resolvePromise, reject) => {
      let verified = false, cliPid = null;
      let probe;
      let timer;
      let settled = false;
      const finish = async value => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        const requiredCleanup = ownedProcessIsAlive(cliPid);
        const hostExited = await terminateOwnedHost(probe?.pid);
        const cliExited = await terminateOwnedHost(cliPid);
        if (!hostExited || !cliExited) {
          reject(runtimeError('SESSION_START_FAILED', 'Native PTY probe cleanup could not confirm owned process exit.', { root: cwd, recoverable: true }));
          return;
        }
        resolvePromise(value && !requiredCleanup);
      };
      try {
        probe = fork(this.hostPath, ['--native-pty-probe'], {
          cwd, detached: true, execArgv: [], windowsHide: true,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
        probe.on('message', message => {
          if (message?.type === 'probe-owned') cliPid = message.pid;
          if (message?.type === 'native-pty-probe') verified = message.verified === true && message.backend === 'node-pty';
        });
        probe.once('error', () => { void finish(false); });
        probe.once('exit', code => { void finish(code === 0 && verified); });
        probe.send({ type: 'init', session: { cwd } }, error => {
          if (error) void finish(false);
        });
        timer = setTimeout(() => {
          void finish(false);
        }, 4000);
      } catch { void finish(false); }
    });
    return this.nativeProbe;
  }

  async findReusable(root, agent, command = null, resolvedCommand = null) {
    const repository = sessionRoot(root);
    for (const record of listRecords(repository).filter(item => item.agent === agent
      && ACTIVE_STATES.has(item.state)
      && (!command || item.command === command)
      && (!resolvedCommand || item.resolvedCommand === resolvedCommand))) {
      const current = await syncHostRecord(repository, record);
      if (ACTIVE_STATES.has(current.state) && ownedProcessIsAlive(current.pid)) return current;
    }
    return null;
  }

  async findPreferred(root, sessionId, agent, command, resolvedCommand = null) {
    if (!sessionId) return null;
    const repository = sessionRoot(root);
    const record = readRecord(repository, sessionId);
    if (record.agent !== agent || (command && record.command !== command)
      || (resolvedCommand && record.resolvedCommand !== resolvedCommand)) return null;
    const current = await syncHostRecord(repository, record);
    return ACTIVE_STATES.has(current.state) && ownedProcessIsAlive(current.pid) ? current : null;
  }

  async open(options = {}) {
    const repository = sessionRoot(options.root);
    const key = `${repository}\u0000${options.agent || ''}\u0000${options.resolved?.command || ''}\u0000${options.resolved?.resolvedCommand || ''}`;
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

  async _open({ root, agent, sessionId = null, resolved, adapter, initialPrompt = '', language = 'en', taskId = null, subtaskId = null, reuseExisting = true, workspace = false, conversationId } = {}) {
    const repository = sessionRoot(root);
    if (conversationId !== undefined && (agent !== 'codex' || resolved.adapter !== 'codex-cli' || initialPrompt || reuseExisting)) throw new Error('Native resume requires a fresh owned Codex runtime without an initial prompt.');
    if (typeof initialPrompt !== 'string' || Buffer.byteLength(initialPrompt, 'utf8') > MAX_INPUT_BYTES) {
      throw runtimeError('SESSION_START_FAILED', 'Initial session input exceeds the size limit.', {
        recoverable: false,
        agent,
        command: resolved?.command || null,
        root: repository,
      });
    }
    const preferred = reuseExisting ? await this.findPreferred(
      repository,
      sessionId,
      agent,
      resolved?.command || null,
      resolved?.resolvedCommand || null,
    ) : null;
    const existing = reuseExisting ? (preferred || await this.findReusable(
      repository,
      agent,
      resolved?.command || null,
      resolved?.resolvedCommand || null,
    )) : null;
    if (existing) {
      const associated = {
        ...existing,
        taskId: existing.taskId || taskId,
        subtaskId: existing.subtaskId || subtaskId,
      };
      if (associated.taskId !== existing.taskId || associated.subtaskId !== existing.subtaskId) {
        // Association must use the same single metadata writer as output/state.
        // A Manager-side record rewrite can otherwise resurrect a dead Host.
        const runtime = await requestHost(existing, { op: 'associate', taskId: associated.taskId, subtaskId: associated.subtaskId });
        Object.assign(associated, mergeRuntimeRecord(associated, runtime));
      }
      appendSessionEvent(repository, associated, 'SESSION_REUSED', {}, { taskId, subtaskId });
      return { session: publicRecord(associated), reused: true, initialInputConsumed: false };
    }
    let launch = resolveLaunch(adapter, { root: repository, agent, initialPrompt, language, workspace, conversationId });
    if (!launch?.command || !Array.isArray(launch.args)) throw runtimeError('SESSION_START_FAILED', 'Adapter did not return a safe PTY launch.', { recoverable: false, agent, command: resolved?.command || null, root: repository });
    // Re-run the adapter's exact configured-command check immediately before
    // starting the owned host. This preserves adapter-specific Windows
    // resolution (including .cmd entrypoints) and custom executable names.
    const contract = getAdapterContract(adapter);
    const checked = contract ? validateDetectionResult(adapter.detect({ version: false })) : adapter.detect({ version: false });
    if (!checked.available) throw runtimeError(checked.code === 'COMMAND_NOT_FOUND' ? 'EXECUTABLE_NOT_FOUND' : checked.code || 'EXECUTABLE_NOT_RUNNABLE', checked.details || `Executable is unavailable: ${resolved?.command || '(none)'}`, { recoverable: true, agent, adapter: resolved?.adapter || null, command: resolved?.command || null, root: repository, stage: 'executable', details: { agent, command: resolved?.command || null, root: repository } });
    if (contract) {
      launch = validateRuntimeLaunchPlan(launch, {
        detection: checked,
        root: repository,
        kind: 'persistent-session',
        initialPrompt,
      });
    }
    const id = `session_${randomUUID().replaceAll('-', '')}`;
    const endpoint = endpointFor(repository, id);
    const createdAt = now();
    const record = {
      id,
      runtimeGeneration: randomUUID(),
      adapter: resolved.adapter || contract?.id || null,
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
      backend: null,
      diagnostics: {
        platform: process.platform, osRelease: release(), arch: process.arch, nodeVersion: process.versions.node,
        requestedMode: ['auto', 'native', 'stdio'].includes(process.env.COORDINATE_AGENTS_PTY_MODE || 'auto')
          ? process.env.COORDINATE_AGENTS_PTY_MODE || 'auto' : 'unknown',
        nativeStatus: 'pending', failure: null,
      },
      outputTail: '',
      endpoint,
      hostPid: null,
      taskId,
      subtaskId,
    };
    writeRecord(repository, record);
    appendSessionEvent(repository, record, 'SESSION_STARTING', {}, { taskId, subtaskId });
    let host;
    try {
      const nativePtyVerified = (process.env.COORDINATE_AGENTS_PTY_MODE || 'auto') === 'auto'
        && await this._verifyWindowsNative(repository);
      let hostFailureHint = null;
      // Custom diagnostic hosts only. Production hosts keep independent,
      // ignored stdio so a Web/CLI parent exit cannot close their stderr pipe.
      const captureHostDiagnostics = this.hostPath !== HOST_PATH && process.env.COORDINATE_AGENTS_PTY_MODE === 'native';
      host = fork(this.hostPath, [], {
        cwd: repository,
        detached: true,
        execArgv: [],
        stdio: ['ignore', 'ignore', captureHostDiagnostics ? 'pipe' : 'ignore', 'ipc'],
        windowsHide: true,
      });
      host.stderr?.setEncoding('utf8');
      host.stderr?.on('data', data => {
        // Only retain fixed error identifiers; never persist raw stderr,
        // native stacks, terminal text, command lines or environment values.
        const code = data.match(/\b(?:ERR_[A-Z_0-9]+|EACCES|EPERM|EINVAL|ENOENT|EIO|ENOSYS)\b/)?.[0];
        if (['ERR_IPC_DISCONNECTED', 'ERR_IPC_CHANNEL_CLOSED', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE', 'ERR_STREAM_DESTROYED',
          'ERR_MODULE_NOT_FOUND', 'EACCES', 'EPERM', 'EINVAL', 'ENOENT', 'EIO', 'ENOSYS'].includes(code)) hostFailureHint = code;
        else if (/Assertion.*failed|FATAL ERROR|Napi::Error::Fatal/i.test(data)) hostFailureHint = 'NATIVE_FATAL';
      });
      host.stderr?.unref?.();
      record.hostPid = host.pid || null;
      writeRecord(repository, record);
      await new Promise((resolvePromise, reject) => {
        host.once('error', reject);
        host.send({
          type: 'init',
          session: {
            id,
            runtimeGeneration: record.runtimeGeneration,
            adapter: record.adapter,
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
            nativePtyVerified,
            createdAt,
            root: repository,
            diagnostics: record.diagnostics,
            taskId,
            subtaskId,
          },
        }, error => error ? reject(error) : resolvePromise());
      });
      // The host closes IPC after consuming init. A send callback confirms
      // transport delivery, not consumption: disconnecting here can discard
      // init while the child is still importing node-pty or a loader. Keep the
      // channel until the owned host disconnects, on every Node/platform.
      host.unref();
      host.once('close', (code, signal) => {
        try {
          const latest = readRecord(repository, id);
          if (!ACTIVE_STATES.has(latest.state)) return;
          writeRecord(repository, { ...latest, pid: null, state: 'failed', lastActivityAt: now(),
            error: 'Owned Session Host exited unexpectedly.',
            diagnostics: { ...latest.diagnostics, ...(latest.backend === 'node-pty' ? { nativeStatus: 'failed' } : {}), hostExitCode: code, hostSignal: signal, hostFailureHint,
              failure: { stage: 'host', code: 'HOST_EXIT_UNEXPECTED' } },
          });
        } catch { /* The session root may already have been removed. */ }
      });
    } catch (error) {
      // The host is the only owner of the child process. Ask it to close first
      // so an IPC/socket startup failure cannot leave an orphaned Implementer.
      try { await requestHost(record, { op: 'close', graceful: false, timeoutMs: 500 }, { timeoutMs: 700 }); } catch { /* The host may not have bound yet. */ }
      try { host?.kill(); } catch { /* Only the host process created above is eligible. */ }
      const failed = { ...record, state: 'failed', lastActivityAt: now(), error: error.message || String(error),
        diagnostics: { ...record.diagnostics, failure: { stage: 'host', code: 'HOST_INIT_TRANSPORT_FAILED' } },
      };
      writeRecord(repository, failed);
      appendSessionEvent(repository, failed, 'SESSION_FAILED', {}, { taskId, subtaskId });
      throw runtimeError('SESSION_START_FAILED', `Failed to start execution session ${id}: ${error.message || error}`, { recoverable: true, agent, command: resolved.command, root: repository, sessionId: id, details: { agent, command: resolved.command, root: repository } });
    }

    const deadline = Date.now() + 5_000;
    // Some PTY backends can briefly report a spawned process as running even
    // when it exits immediately. Keep startup bounded, but require enough
    // stability for the terminal exit fact to win before publishing STARTED.
    const healthyStabilityMs = 2_500;
    const minimumHealthyProbes = 25;
    let healthySince = null;
    let healthyProbeCount = 0;
    let current = record;
    let startupHealthy = false;
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
      if (HEALTHY_STARTUP_STATES.has(current.state) && ownedProcessIsAlive(current.pid)) {
        healthySince ??= Date.now();
        healthyProbeCount += 1;
        // A scheduler stall can cross the wall-clock window between only two
        // probes. Require several successful host round trips as well so an
        // already-exited child can publish its terminal fact before STARTED.
        if (healthyProbeCount >= minimumHealthyProbes && Date.now() - healthySince >= healthyStabilityMs) { startupHealthy = true; break; }
      } else {
        healthySince = null;
        healthyProbeCount = 0;
      }
      await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
    }
    if (!startupHealthy && ACTIVE_STATES.has(current.state)) {
      try { await requestHost(current, { op: 'close', graceful: false, timeoutMs: 500 }, { timeoutMs: 1500 }); } catch { /* Host may be blocked in native initialization. */ }
      const hostExited = await reapOwnedHost(record.hostPid, 1000);
      current = { ...current, pid: null, state: 'failed', lastActivityAt: now(), error: 'Session host startup timed out.',
        diagnostics: { ...current.diagnostics, failure: { stage: hostExited ? 'host' : 'cleanup', code: hostExited ? 'HOST_START_TIMEOUT' : 'HOST_CLEANUP_TIMEOUT' } },
      };
      writeRecord(repository, current);
    }
    if (startupHealthy && HEALTHY_STARTUP_STATES.has(current.state) && ownedProcessIsAlive(current.pid)) {
      appendSessionEvent(repository, current, 'SESSION_STARTED', {}, { taskId, subtaskId });
    } else if (!ACTIVE_STATES.has(current.state) && current.state !== 'starting') {
      ensureSessionStateEvent(repository, current, { taskId, subtaskId });
    }
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
    let output = { output: current.outputTail || '', nextCursor: null, truncated: false };
    if (ACTIVE_STATES.has(current.state)) {
      const boundedLines = Number.isInteger(maxLines) ? Math.min(MAX_READ_LINES, Math.max(1, maxLines)) : 100;
      const boundedBytes = Number.isInteger(maxBytes) ? Math.min(MAX_READ_BYTES, Math.max(1, maxBytes)) : 16 * 1024;
      try { output = await requestHost(current, { op: 'read', tail: true, maxLines: boundedLines, maxBytes: boundedBytes }); } catch { /* Status remains the inspectable fact. */ }
    }
    return { session: publicRecord(current), output: { ...output, output: redactOutput(output.output || '', Math.min(MAX_READ_BYTES, maxBytes)) } };
  }

  async read(root, id, { cursor = null, maxLines = 100, maxBytes = MAX_READ_BYTES } = {}) {
    const repository = sessionRoot(root);
    const record = readRecord(repository, id);
    const current = await syncHostRecord(repository, record);
    maxLines = Math.min(MAX_READ_LINES, Math.max(1, Number.isInteger(maxLines) ? maxLines : 100));
    maxBytes = Math.min(MAX_READ_BYTES, Math.max(1, Number.isInteger(maxBytes) ? maxBytes : MAX_READ_BYTES));
    if (!ACTIVE_STATES.has(current.state)) {
      if (Number.isSafeInteger(current.outputCursor) && Number.isSafeInteger(current.outputTailStartCursor)
        && Buffer.byteLength(current.outputTail || '') === current.outputCursor - current.outputTailStartCursor) {
        return { session: publicRecord(current), ...readPersistedPage(current, cursor, maxLines, maxBytes) };
      }
      // Legacy or redacted snapshots have no exact byte mapping. Display them
      // only on initial load; reconnect reports the gap without duplicate text.
      const resuming = Number.isInteger(cursor);
      return {
        session: publicRecord(current),
        output: resuming ? '' : current.outputTail || '',
        nextCursor: current.outputCursor ?? cursor ?? null,
        latestCursor: current.outputCursor ?? cursor ?? null,
        truncated: resuming && (current.outputCursor == null || cursor < current.outputCursor),
        hasMore: false,
      };
    }
    const result = await requestHost(current, {
      op: 'read',
      cursor: Number.isInteger(cursor) ? cursor : null,
      maxLines,
      maxBytes,
    });
    return { session: { ...publicRecord(current), state: result.state, lastActivityAt: result.lastActivityAt }, ...result };
  }

  async subscribe(root, id, options = {}) {
    const repository = sessionRoot(root);
    const record = readRecord(repository, id);
    if (options.signal?.aborted) throw new Error('Session subscription cancelled.');
    if (!ACTIVE_STATES.has(record.state)) {
      let result;
      let cursor = options.cursor;
      do {
        if (options.signal?.aborted) break;
        result = await this.read(repository, id, { ...options, cursor });
        options.onEvent({ event: 'terminal-output', session: result.session, output: result });
        cursor = result.nextCursor;
      } while (result.hasMore);
      if (options.signal?.aborted) return () => {};
      options.onEvent({ event: 'terminal-state', session: result.session });
      return () => {};
    }
    return subscribeHost(record, options);
  }

  async write(root, id, input, { submit = true, taskId = null, subtaskId = null } = {}) {
    const repository = sessionRoot(root);
    if (typeof input !== 'string' || input.length === 0) throw runtimeError('SESSION_WRITE_FAILED', 'Session input must be a non-empty string.', { recoverable: false, sessionId: id, root: repository });
    if (input.length > 256 * 1024) throw runtimeError('SESSION_WRITE_FAILED', 'Session input exceeds the size limit.', { recoverable: false, sessionId: id, root: repository });
    const record = readRecord(repository, id);
    const current = await syncHostRecord(repository, record);
    if (!ACTIVE_STATES.has(current.state) || !ownedProcessIsAlive(current.pid)) throw runtimeError('SESSION_NOT_HEALTHY', `Execution session ${id} is not writable in state ${current.state}.`, { recoverable: true, sessionId: id, root: repository });
    const runtime = await requestHost(current, { op: 'write', input, submit });
    const updated = mergeRuntimeRecord(current, runtime);
    if (updated.state !== current.state) {
      const type = sessionStateEventType(updated.state);
      appendSessionEvent(repository, updated, type, {}, { taskId, subtaskId });
    }
    return publicRecord(updated);
  }

  async resize(root, id, cols, rows) {
    const repository = sessionRoot(root);
    const record = readRecord(repository, id);
    const current = await syncHostRecord(repository, record);
    if (!ACTIVE_STATES.has(current.state) || !ownedProcessIsAlive(current.pid)) throw runtimeError('SESSION_NOT_HEALTHY', `Execution session ${id} is not resizable in state ${current.state}.`, { recoverable: true, sessionId: id, root: repository });
    const runtime = await requestHost(current, { op: 'resize', cols, rows });
    const updated = mergeRuntimeRecord(current, runtime);
    return publicRecord(updated);
  }

  async interrupt(root, id) {
    const repository = sessionRoot(root);
    const record = readRecord(repository, id);
    const current = await syncHostRecord(repository, record);
    if (!ACTIVE_STATES.has(current.state)) return publicRecord(current);
    const runtime = await requestHost(current, { op: 'interrupt' });
    const updated = mergeRuntimeRecord(current, runtime);
    return publicRecord(updated);
  }

  async close(root, id, { graceful = true, timeoutMs = 2_000 } = {}) {
    const repository = sessionRoot(root);
    const record = readRecord(repository, id);
    const current = await syncHostRecord(repository, record);
    if (!ACTIVE_STATES.has(current.state)) {
      // Terminal metadata precedes the Host's shutdown timer. Do not publish
      // cleanup before it releases its handles. Never kill a stale terminal
      // record's PID: it could have been reused by an unrelated process.
      if (!await waitForOwnedHostExit(current.hostPid, Math.max(500, timeoutMs + 500))) {
        throw runtimeError('SESSION_CLOSE_FAILED', 'Terminal Session Host exit could not be confirmed.', { root: repository, sessionId: id, recoverable: true });
      }
      return publicRecord(current);
    }
    try {
      let runtime = await requestHost(current, { op: 'close', graceful, timeoutMs }, { timeoutMs: Math.max(5_000, timeoutMs + 2_000) });
      if (ACTIVE_STATES.has(runtime?.state)) {
        // A PTY backend may acknowledge a graceful close while its process is
        // still active. Escalate once through the same owned Session Host
        // rather than publishing an idle Session as successfully closed.
        try {
          runtime = await requestHost(current, {
            op: 'close',
            graceful: false,
            timeoutMs: Math.max(1_000, timeoutMs),
          }, { timeoutMs: Math.max(5_000, timeoutMs + 2_000) });
        } catch {
          // The first close may already have begun the host shutdown. Preserve
          // its runtime fact and use the exact persisted host PID for bounded
          // cleanup below instead of retrying an unbounded socket operation.
        }
      }
      let updated = mergeRuntimeRecord(current, runtime);
      // The host sends the close response immediately before its bounded
      // shutdown timer. Wait for that exact Runtime-owned host to release its
      // repository handles before publishing cleanup to callers.
      let hostExited = await waitForOwnedHostExit(current.hostPid, Math.max(500, timeoutMs + 500));
      if (!hostExited) {
        // A platform PTY can report an active snapshot after its child tree
        // has been killed, leaving the detached host holding repository files.
        // Only terminate the host PID recorded for this Session; never accept
        // a caller-supplied arbitrary process identifier.
        hostExited = await reapOwnedHost(current.hostPid, Math.max(500, timeoutMs + 500));
      }
      const cliExited = await waitForOwnedHostExit(current.pid, 500);
      if (!hostExited || !cliExited) {
        throw runtimeError('SESSION_CLOSE_FAILED', 'Owned Session Host or CLI did not exit after close.', { root: repository, sessionId: id, recoverable: true });
      }
      if (ACTIVE_STATES.has(updated.state)) {
        updated = {
          ...updated,
          pid: null,
          state: 'failed',
          lastActivityAt: now(),
          error: updated.error || (hostExited ? 'Session close returned an active runtime state.' : 'Owned Session Host did not exit after close.'),
        };
      }
      // Read after the exact Host exits so its final drained transcript wins.
      try {
        const latest = readRecord(repository, id);
        if (!ACTIVE_STATES.has(latest.state)) updated = latest;
      } catch { /* Preserve the explicit close failure if no record remains. */ }
      writeRecord(repository, updated);
      appendSessionEvent(repository, updated, 'SESSION_CLOSED');
      return publicRecord(updated);
    } catch (error) {
      // If the socket disappeared during a close, still clean up the exact
      // host created for this Session before exposing the failure.
      await reapOwnedHost(current.hostPid, Math.max(500, timeoutMs + 500));
      if (ownedProcessIsAlive(current.pid)) await terminateOwnedHost(current.pid);
      let latest = current;
      try { latest = readRecord(repository, id); } catch { /* Preserve the validated original record. */ }
      if (!ACTIVE_STATES.has(latest.state) && !ownedProcessIsAlive(current.hostPid) && !ownedProcessIsAlive(current.pid)) {
        appendSessionEvent(repository, latest, 'SESSION_CLOSED');
        return publicRecord(latest);
      }
      const failed = { ...latest, pid: ownedProcessIsAlive(current.pid) ? current.pid : null, state: 'failed', lastActivityAt: now(), error: error.message || String(error) };
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
