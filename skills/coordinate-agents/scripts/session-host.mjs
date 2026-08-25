#!/usr/bin/env node

import { chmodSync, existsSync, lstatSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { atomicWrite, assertContained, assertSafePath } from './config.mjs';
import { PtyRuntime } from './pty-runtime.mjs';
import { redactOutput } from '../adapters/executable.mjs';

const MAX_MESSAGE_LENGTH = 1024 * 1024;
const MAX_INPUT_LENGTH = 256 * 1024;

function safeArgs(args) {
  return Array.isArray(args) ? args.map(value => redactOutput(`${value}`, 2 * 1024)) : [];
}

let session;
let runtime;
let server;
let shuttingDown = false;
let metadataWriteTimer = null;

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

function metadataFromRuntime() {
  const snapshot = runtime?.snapshot?.() || {};
  return {
    schemaVersion: 1,
    id: session.id,
    agent: session.agent,
    command: session.command,
    resolvedCommand: session.resolvedCommand || null,
    args: safeArgs(session.args),
    cwd: session.cwd,
    pid: snapshot.pid ?? null,
    state: snapshot.state || 'starting',
    createdAt: snapshot.createdAt || session.createdAt,
    lastActivityAt: snapshot.lastActivityAt || session.createdAt,
    exitCode: snapshot.exitCode ?? null,
    signal: snapshot.signal || null,
    error: snapshot.error ? redactOutput(snapshot.error, 2 * 1024) : null,
    endpoint: session.endpoint,
    hostPid: process.pid,
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
  if (metadataWriteTimer) clearTimeout(metadataWriteTimer);
  try { persistMetadata(); } catch { /* Preserve the process exit. */ }
  try { server?.close(); } catch { /* Already closed. */ }
  cleanupEndpoint();
  setTimeout(() => process.exit(0), 10).unref();
}

async function handleCommand(command) {
  if (!runtime) throw safeSessionError('Session host is not ready.', 'SESSION_STARTING');
  switch (command.op) {
    case 'status':
      return runtime.status();
    case 'read':
      return runtime.read({
        cursor: command.cursor ?? null,
        maxLines: command.maxLines ?? null,
        maxBytes: command.maxBytes ?? undefined,
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
      try {
        const result = await handleCommand(command);
        respond(socket, command.id ?? null, result);
        if (command.op === 'close') {
          // Keep the named-pipe/socket open until the close response has been
          // flushed. Windows clients can otherwise observe a detached host
          // before receiving the successful response.
          socket.end(() => shutdown());
          setTimeout(shutdown, 1_000).unref();
        }
      } catch (error) {
        respond(socket, command.id ?? null, null, error);
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
    try { process.disconnect?.(); } catch { /* Parent is intentionally detached. */ }
    return;
  }
  throw new Error('Session host requires an initialization channel.');
}

async function main() {
  await waitForInit();
  assertContained(session.root, session.metadataPath);
  assertSafePath(session.root, session.metadataPath, undefined, false);
  assertSafePath(session.root, session.tmpDirectory);
  if (process.platform !== 'win32' && existsSync(session.endpoint)) {
    try {
      const metadata = lstatSync(session.endpoint);
      if (metadata.isSocket()) rmSync(session.endpoint, { force: true });
    } catch { /* The listen call reports an unsafe/stale endpoint. */ }
  }

  runtime = new PtyRuntime({
    id: session.id,
    command: session.spawnCommand,
    args: session.spawnArgs,
    cwd: session.cwd,
    maxOutputBytes: session.maxOutputBytes,
    onOutput: () => scheduleMetadata(),
    onStateChange: () => {
      try { persistMetadata(); } catch { /* Keep the PTY alive if metadata is temporarily unavailable. */ }
      if (runtime.state === 'exited' || runtime.state === 'failed') {
        setTimeout(shutdown, 25).unref();
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

try {
  await main();
} catch (error) {
  try {
    if (session) {
      const failed = {
        schemaVersion: 1,
        id: session.id,
        agent: session.agent,
        command: session.command,
        resolvedCommand: session.resolvedCommand || null,
        args: safeArgs(session.args),
        cwd: session.cwd,
        pid: null,
        state: 'failed',
        createdAt: session.createdAt,
        lastActivityAt: new Date().toISOString(),
        exitCode: null,
        signal: null,
        error: redactOutput(error.message || String(error), 2 * 1024),
        endpoint: session.endpoint,
        hostPid: process.pid,
      };
      atomicWrite(session.metadataPath, `${JSON.stringify(failed, null, 2)}\n`, session.tmpDirectory);
    }
  } catch { /* Preserve the startup failure. */ }
  try { server?.close(); } catch { /* The server may not have started. */ }
  cleanupEndpoint();
  process.exit(1);
}
