#!/usr/bin/env node

import { chmodSync, existsSync, lstatSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { atomicWrite, assertContained, assertSafePath } from './config.mjs';
import { PtyRuntime, safePtySystemCode } from './pty-runtime.mjs';
import { redactOutput } from '../adapters/executable.mjs';
import { createCodexIdentityCapture } from './codex-identity-capture.mjs';

const MAX_MESSAGE_LENGTH = 1024 * 1024;
const MAX_INPUT_LENGTH = 256 * 1024;
const MAX_PERSISTED_OUTPUT_BYTES = 8 * 1024;

function safeArgs(args) {
  return Array.isArray(args) ? args.map(value => redactOutput(`${value}`, 2 * 1024)) : [];
}

let session;
let runtime;
let server;
let shuttingDown = false;
let metadataWriteTimer = null;
let pendingCloseResponses = 0;
let nativeCapture = null;
let nativeCaptureState = { state: 'UNAVAILABLE', reason: 'UNSUPPORTED_CLI' };
const subscribers = new Set();

function notifySubscribers() {
  for (const subscriber of subscribers) subscriber.schedule();
}

function subscribeSocket(socket, command) {
  let cursor = Number.isSafeInteger(command.cursor) ? command.cursor : null;
  let scheduled = null;
  let blocked = false;
  let blockedTimer = null;
  let closed = false;
  let lastState = null;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearImmediate(scheduled);
    clearTimeout(blockedTimer);
    subscribers.delete(subscriber);
    socket.off('drain', drained);
  };
  const send = event => {
    if (socket.destroyed || socket.writableEnded) { cleanup(); return false; }
    const writable = socket.write(`${JSON.stringify(event)}\n`);
    if (!writable) {
      blocked = true;
      blockedTimer = setTimeout(() => socket.destroy(), 5_000);
      blockedTimer.unref();
    }
    return writable;
  };
  const push = () => {
    scheduled = null;
    if (closed || blocked) return;
    // Bound each turn's work; unread data stays in the existing OutputBuffer.
    for (let page = 0; page < 4; page += 1) {
      const output = runtime.read({ cursor, maxBytes: 32 * 1024, maxLines: 200 });
      cursor = output.nextCursor;
      if (output.output || output.truncated) {
        if (!send({ event: 'terminal-output', output, session: runtime.snapshot() })) return;
      }
      if (output.hasMore) continue;
      if (lastState !== runtime.state) {
        lastState = runtime.state;
        if (!send({ event: 'terminal-state', session: runtime.snapshot() })) return;
      }
      if (!runtime.isActive()) { cleanup(); socket.end(); }
      return;
    }
    subscriber.schedule();
  };
  const drained = () => {
    blocked = false;
    clearTimeout(blockedTimer);
    blockedTimer = null;
    subscriber.schedule();
  };
  const subscriber = { schedule() { if (!closed && !blocked && scheduled === null) scheduled = setImmediate(push); } };
  // Register before scheduling history. Output between these steps is retained
  // and read from the same cursor, so history/live handoff has no race.
  subscribers.add(subscriber);
  socket.once('close', cleanup);
  socket.on('drain', drained);
  respond(socket, command.id, { subscribed: true });
  subscriber.schedule();
}

function respond(socket, id, payload, error = null) {
  const message = error
    ? { id, ok: false, error: { code: error.code || 'SESSION_HOST_ERROR', message: `${error.message || error}`.slice(0, 2 * 1024) } }
    : { id, ok: true, result: payload };
  try { socket.write(`${JSON.stringify(message)}\n`); } catch { /* Client may have disconnected. */ }
}

function safeSessionError(message, code = 'SESSION_HOST_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function outputTail() {
  try {
    return redactOutput(runtime?.read?.({ tail: true, maxLines: 60, maxBytes: MAX_PERSISTED_OUTPUT_BYTES })?.output || '', MAX_PERSISTED_OUTPUT_BYTES);
  } catch {
    return '';
  }
}

function metadataFromRuntime() {
  const snapshot = runtime?.snapshot?.() || {};
  const tail = runtime?.read?.({ tail: true, maxLines: 60, maxBytes: MAX_PERSISTED_OUTPUT_BYTES });
  const persistedTail = redactOutput(tail?.output || '', MAX_PERSISTED_OUTPUT_BYTES);
  return {
    schemaVersion: 1,
    id: session.id,
    runtimeGeneration: session.runtimeGeneration || null,
    adapter: session.adapter || null,
    agent: session.agent,
    command: session.command,
    resolvedCommand: session.resolvedCommand || null,
    args: safeArgs(session.args),
    cwd: session.cwd,
    pid: snapshot.pid ?? null,
    backend: snapshot.backend || null,
    diagnostics: snapshot.diagnostics || null,
    cols: snapshot.cols ?? null,
    rows: snapshot.rows ?? null,
    state: snapshot.state || 'starting',
    createdAt: snapshot.createdAt || session.createdAt,
    lastActivityAt: snapshot.lastActivityAt || session.createdAt,
    exitCode: snapshot.exitCode ?? null,
    signal: snapshot.signal || null,
    error: snapshot.error ? redactOutput(snapshot.error, 2 * 1024) : null,
    outputTail: persistedTail,
    outputCursor: snapshot.outputCursor ?? 0,
    // Redacted snapshots cannot be mapped to original byte offsets. Report a
    // gap on resume in that case instead of replaying incorrectly aligned text.
    outputTailStartCursor: tail?.output === persistedTail ? tail.startCursor : null,
    endpoint: session.endpoint,
    hostPid: process.pid,
    taskId: session.taskId || null,
    subtaskId: session.subtaskId || null,
    nativeIdentityCapture: nativeCaptureState,
  };
}

function persistMetadata() {
  if (!session) return;
  const metadataPath = session.metadataPath;
  assertContained(session.root, metadataPath);
  assertSafePath(session.root, metadataPath, undefined, false);
  atomicWrite(metadataPath, `${JSON.stringify(metadataFromRuntime(), null, 2)}\n`, session.tmpDirectory);
}

function scheduleMetadata() {
  if (metadataWriteTimer || shuttingDown) return;
  metadataWriteTimer = setTimeout(() => {
    metadataWriteTimer = null;
    try { persistMetadata(); } catch { /* A terminal state remains inspectable in the previous record. */ }
  }, 50);
}

function cleanupEndpoint() {
  if (process.platform === 'win32' || !session?.endpoint || !existsSync(session.endpoint)) return;
  try {
    const metadata = lstatSync(session.endpoint);
    if (metadata.isSocket()) rmSync(session.endpoint, { force: true });
  } catch { /* Endpoint cleanup is best effort. */ }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  nativeCapture?.close();
  if (metadataWriteTimer) clearTimeout(metadataWriteTimer);
  try { persistMetadata(); } catch { /* Preserve the process exit. */ }
  try { server?.close(); } catch { /* Already closed. */ }
  cleanupEndpoint();
  // Give subscriptions a bounded window to flush final buffered output/state.
  setTimeout(() => process.exit(0), subscribers.size ? 1_000 : 10).unref();
}

async function handleCommand(command) {
  if (!runtime) throw safeSessionError('Session host is not ready.', 'SESSION_STARTING');
  switch (command.op) {
    case 'status':
      return runtime.status();
    case 'associate':
      for (const field of ['taskId', 'subtaskId']) {
        if (command[field] != null && (typeof command[field] !== 'string' || command[field].length > 128)) {
          throw safeSessionError('Invalid Session association.', 'SESSION_STATE_CONFLICT');
        }
        session[field] ||= command[field] || null;
      }
      persistMetadata();
      return runtime.status();
    case 'read':
      return runtime.read({
        cursor: command.cursor ?? null,
        maxLines: command.maxLines ?? null,
        maxBytes: command.maxBytes ?? undefined,
        tail: command.tail === true,
      });
    case 'write':
      if (typeof command.input !== 'string') throw safeSessionError('Session input must be a string.', 'SESSION_WRITE_FAILED');
      if (command.input.length > MAX_INPUT_LENGTH) throw safeSessionError('Session input exceeds the size limit.', 'SESSION_WRITE_FAILED');
      return runtime.write(command.input, { submit: command.submit !== false });
    case 'resize':
      if (!Number.isInteger(command.cols) || !Number.isInteger(command.rows)) throw safeSessionError('Session resize requires integer cols and rows.', 'SESSION_RUNTIME_ERROR');
      return runtime.resize(command.cols, command.rows);
    case 'interrupt':
      return runtime.interrupt();
    case 'close': {
      const result = await runtime.close({ graceful: command.graceful !== false, timeoutMs: command.timeoutMs });
      return result;
    }
    default:
      throw safeSessionError(`Unknown session host operation: ${command.op}`, 'SESSION_RUNTIME_ERROR');
  }
}

function handleSocket(socket) {
  let buffer = '';
  socket.setEncoding('utf8');
  // A bounded manager/browser request may disconnect before an async command
  // returns. write() reports EPIPE asynchronously; try/catch in respond() is
  // insufficient. Losing one RPC client must not crash an owned PTY Host.
  socket.on('error', () => socket.destroy());
  socket.on('data', async chunk => {
    buffer += chunk;
    if (buffer.length > MAX_MESSAGE_LENGTH) {
      respond(socket, null, null, safeSessionError('Session host message exceeds the size limit.', 'SESSION_RUNTIME_ERROR'));
      socket.destroy();
      return;
    }
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let command;
      try { command = JSON.parse(line); } catch {
        respond(socket, null, null, safeSessionError('Invalid session host JSON.', 'SESSION_RUNTIME_ERROR'));
        continue;
      }
      if (command.op === 'subscribe') {
        if (!runtime || socket.subscribed) {
          respond(socket, command.id, null, safeSessionError('Session subscription is unavailable.', 'SESSION_RUNTIME_ERROR'));
        } else {
          socket.subscribed = true;
          subscribeSocket(socket, command);
        }
        continue;
      }
      let closeFinished = false;
      const finishClose = () => {
        if (command.op !== 'close' || closeFinished) return;
        closeFinished = true;
        pendingCloseResponses -= 1;
        if (pendingCloseResponses === 0 && !runtime.isActive()) shutdown();
      };
      if (command.op === 'close') {
        pendingCloseResponses += 1;
        socket.once('close', finishClose);
      }
      try {
        const result = await handleCommand(command);
        respond(socket, command.id ?? null, result);
        if (command.op === 'close' && !runtime.isActive()) {
          // Keep the named-pipe/socket open until the close response has been
          // flushed. Windows clients can otherwise observe a detached host
          // before receiving the successful response.
          socket.end(finishClose);
          setTimeout(finishClose, 1_000).unref();
        }
      } catch (error) {
        respond(socket, command.id ?? null, null, error);
        if (command.op === 'close') {
          try { socket.end(finishClose); } catch { finishClose(); }
          setTimeout(finishClose, 1_000).unref();
        }
      }
    }
  });
}

async function waitForInit() {
  if (process.send) {
    await new Promise((resolve, reject) => {
      const onMessage = message => {
        if (!message || message.type !== 'init') return;
        process.off('message', onMessage);
        session = message.session;
        resolve();
      };
      process.on('message', onMessage);
      setTimeout(() => reject(new Error('Timed out waiting for session host initialization.')), 10_000).unref();
    });
    if (!process.argv.includes('--native-pty-probe')) {
      try { process.disconnect?.(); } catch { /* Parent is intentionally detached. */ }
    }
    return;
  }
  throw new Error('Session host requires an initialization channel.');
}

async function main() {
  await waitForInit();
  if (process.argv.includes('--native-pty-probe')) {
    // Same detached/native path as a Session; no user CLI, model account,
    // bus mutation, or retryable task side effect.
    let output = '';
    const probe = new PtyRuntime({
      id: 'native-capability-probe', command: process.execPath,
      args: ['-e', 'console.log("NATIVE_TTY:" + Boolean(process.stdin.isTTY && process.stdout.isTTY))'],
      cwd: session.cwd, nativePtyVerified: true,
      onOutput: data => { output = (output + data).slice(-4096); },
    });
    probe.open();
    process.send?.({ type: 'probe-owned', pid: probe.pid });
    const result = await probe.exitPromise;
    const verified = result.backend === 'node-pty' && result.exitCode === 0 && output.includes('NATIVE_TTY:true');
    process.send?.({ type: 'native-pty-probe', verified, backend: result.backend }, () => process.exit(verified ? 0 : 1));
    return;
  }
  assertContained(session.root, session.metadataPath);
  assertSafePath(session.root, session.metadataPath, undefined, false);
  assertSafePath(session.root, session.tmpDirectory);
  if (process.platform !== 'win32' && existsSync(session.endpoint)) {
    try {
      const metadata = lstatSync(session.endpoint);
      if (metadata.isSocket()) rmSync(session.endpoint, { force: true });
    } catch { /* The listen call reports an unsafe/stale endpoint. */ }
  }

  let spawnArgs = session.spawnArgs;
  if (session.nativeIdentityCaptureVersion) {
    try {
      let observer;
      nativeCapture = await createCodexIdentityCapture({ root: session.root, version: session.nativeIdentityCaptureVersion,
        isActive: () => Boolean(runtime?.isActive()) && !shuttingDown,
        onState: value => { nativeCaptureState = value; scheduleMetadata(); },
        observe: async evidence => {
          if (!observer) {
            const { createWorkspaceCodexIdentityObserver } = await import('./workspace-task-runtime.mjs');
            observer = createWorkspaceCodexIdentityObserver({ root: session.root, session });
          }
          return observer(evidence);
        },
      });
      // Add private launch config only in Host memory. Session records retain
      // the original configured argv and never publish the collector capability.
      const position = spawnArgs.lastIndexOf('-C');
      spawnArgs = [...spawnArgs.slice(0, position), ...nativeCapture.args, ...spawnArgs.slice(position)];
    } catch { nativeCaptureState = { state: 'UNAVAILABLE', reason: 'COLLECTOR_UNAVAILABLE' }; }
  }
  runtime = new PtyRuntime({
    id: session.id,
    command: session.spawnCommand,
    args: spawnArgs,
    cwd: session.cwd,
    env: { ...process.env, ...(session.taskId ? {
      COORDINATE_AGENTS_TASK_ID: session.taskId,
      COORDINATE_AGENTS_SLOT: session.subtaskId || '',
      COORDINATE_AGENTS_SESSION_ID: session.id,
      COORDINATE_AGENTS_RUNTIME_GENERATION: session.runtimeGeneration || '',
    } : {}) },
    maxOutputBytes: session.maxOutputBytes,
    nativePtyVerified: session.nativePtyVerified === true,
    onOutput: () => { scheduleMetadata(); notifySubscribers(); },
    onStateChange: () => {
      notifySubscribers();
      try { persistMetadata(); } catch { /* Keep the PTY alive if metadata is temporarily unavailable. */ }
      if (runtime.state === 'exited' || runtime.state === 'failed') {
        nativeCapture?.close();
        // Native exit may arrive while close() is still awaiting taskkill's
        // own handles. Do not exit the Host before the close RPC is flushed.
        setTimeout(() => { if (pendingCloseResponses === 0) shutdown(); }, 25).unref();
      }
    },
  });

  server = createServer(handleSocket);
  server.on('error', error => {
    try {
      runtime?._setState?.('failed', error);
      persistMetadata();
    } catch { /* Nothing else can be reported to a disconnected parent. */ }
    shutdown();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(session.endpoint, () => {
      if (process.platform !== 'win32') {
        try { chmodSync(session.endpoint, 0o600); } catch { /* The platform may not expose socket permissions. */ }
      }
      server.off('error', reject);
      resolve();
    });
  });
  runtime.open();
  persistMetadata();
}

process.on('SIGTERM', async () => {
  try { await runtime?.close({ graceful: true, timeoutMs: 1_000 }); } catch { /* Best effort for an owned PTY. */ }
  shutdown();
});
process.on('SIGINT', async () => {
  try { await runtime?.close({ graceful: true, timeoutMs: 1_000 }); } catch { /* Best effort for an owned PTY. */ }
  shutdown();
});

// Observe an uncaught JS failure without suppressing Node's default crash.
// Native aborts cannot be caught here; the Manager records owned fork exit.
process.on('uncaughtExceptionMonitor', error => {
  if (!runtime || !session) return;
  try {
    if (runtime.backend === 'node-pty') runtime.diagnostics.nativeStatus = 'failed';
    runtime.diagnostics.failure = {
      stage: 'host', code: 'HOST_UNCAUGHT_ERROR',
      systemCode: safePtySystemCode(error?.code),
    };
    runtime._setState('failed', new Error('Session Host encountered an uncaught error.'));
    persistMetadata();
  } catch { /* Keep Node's original crash behavior. */ }
});

try {
  await main();
} catch (error) {
  try {
    if (session) {
      const failed = {
        schemaVersion: 1,
        id: session.id,
        runtimeGeneration: session.runtimeGeneration || null,
        adapter: session.adapter || null,
        agent: session.agent,
        command: session.command,
        resolvedCommand: session.resolvedCommand || null,
        args: safeArgs(session.args),
        cwd: session.cwd,
        pid: null,
        backend: runtime?.backend || null,
        diagnostics: runtime?.snapshot?.().diagnostics || session.diagnostics || null,
        state: 'failed',
        createdAt: session.createdAt,
        lastActivityAt: new Date().toISOString(),
        exitCode: null,
        signal: null,
        error: redactOutput(error.message || String(error), 2 * 1024),
        outputTail: outputTail(),
        endpoint: session.endpoint,
        hostPid: process.pid,
        taskId: session.taskId || null,
        subtaskId: session.subtaskId || null,
      };
      atomicWrite(session.metadataPath, `${JSON.stringify(failed, null, 2)}\n`, session.tmpDirectory);
    }
  } catch { /* Preserve the startup failure. */ }
  try { server?.close(); } catch { /* The server may not have started. */ }
  cleanupEndpoint();
  process.exit(1);
}
