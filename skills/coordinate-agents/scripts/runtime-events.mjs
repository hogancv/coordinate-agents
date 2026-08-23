import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { assertContained, assertSafePath } from './config.mjs';
import { redactOutput } from '../adapters/executable.mjs';
import { runtimeError } from './runtime-contract.mjs';

export const EVENT_SCHEMA_VERSION = 1;
export const MAX_EVENT_LIMIT = 500;

const DEFAULT_EVENT_LIMIT = 100;
const MAX_EVENT_LINE_BYTES = 64 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const LOCK_TIMEOUT_MS = 2_000;
const STALE_LOCK_MS = 30_000;
const SENSITIVE_KEY = /(?:authorization|credential|cookie|environment|env|password|passwd|private[_-]?key|secret|token|api[_-]?key)/i;
const ASSOCIATION_FIELDS = ['taskId', 'sessionId', 'agentId', 'role', 'messageId'];
const EVENT_ID_PATTERN = /^evt_[0-9a-f-]{36}$/;
const EVENT_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;

function eventPaths(root, { create = false } = {}) {
  const supplied = resolve(`${root || process.cwd()}`);
  const repository = existsSync(supplied) ? realpathSync(supplied) : supplied;
  const bus = join(repository, '.agent-bus');
  if (!existsSync(bus)) {
    if (!create) return { repository, bus, directory: join(bus, 'events'), journal: join(bus, 'events', 'runtime.jsonl'), lock: join(bus, 'events', '.append.lock') };
    throw runtimeError('RUNTIME_EVENT_WRITE_FAILED', `Agent Bus is not initialized: ${bus}`, { recoverable: true });
  }
  assertSafePath(repository, bus);
  const directory = join(bus, 'events');
  const journal = join(directory, 'runtime.jsonl');
  const lock = join(directory, '.append.lock');
  assertContained(bus, directory);
  assertContained(directory, journal);
  assertContained(directory, lock);
  if (create) {
    mkdirSync(directory, { recursive: true });
    assertSafePath(repository, directory);
  }
  return { repository, bus, directory, journal, lock };
}

export function runtimeEventJournalPath(root) {
  return eventPaths(root).journal;
}

function sanitizeValue(value, key = '', depth = 0) {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value ?? null;
  if (typeof value === 'string') return redactOutput(value, 8 * 1024);
  if (depth >= 6) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeValue(item, '', depth + 1));
  if (typeof value === 'object') {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
      result[childKey] = sanitizeValue(childValue, childKey, depth + 1);
    }
    return result;
  }
  return redactOutput(String(value), 8 * 1024);
}

export function sanitizeRuntimeEventData(data) {
  const sanitized = sanitizeValue(data && typeof data === 'object' && !Array.isArray(data) ? data : {});
  const encoded = JSON.stringify(sanitized);
  if (Buffer.byteLength(encoded, 'utf8') <= MAX_EVENT_LINE_BYTES / 2) return sanitized;
  return { summary: redactOutput(encoded, MAX_EVENT_LINE_BYTES / 2) };
}

function validateType(type) {
  if (typeof type !== 'string' || !EVENT_TYPE_PATTERN.test(type)) {
    throw runtimeError('RUNTIME_EVENT_WRITE_FAILED', `Invalid runtime event type: ${type || '(empty)'}`, { recoverable: false });
  }
  return type;
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function validStoredEvent(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && value.schemaVersion === EVENT_SCHEMA_VERSION
    && typeof value.eventId === 'string' && EVENT_ID_PATTERN.test(value.eventId)
    && Number.isInteger(value.sequence) && value.sequence > 0
    && typeof value.timestamp === 'string' && !Number.isNaN(Date.parse(value.timestamp))
    && typeof value.type === 'string' && EVENT_TYPE_PATTERN.test(value.type)
    && value.data && typeof value.data === 'object' && !Array.isArray(value.data)
    && (Object.getPrototypeOf(value.data) === Object.prototype || Object.getPrototypeOf(value.data) === null);
}

function validateJournalMetadata(metadata, journal) {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw runtimeError('RUNTIME_EVENT_WRITE_FAILED', `Unsafe Event Journal file: ${journal}`, { recoverable: true });
  }
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function openJournalForAppend(paths) {
  let before = null;
  try {
    before = lstatSync(paths.journal);
    validateJournalMetadata(before, paths.journal);
    assertSafePath(paths.repository, paths.journal);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // O_NOFOLLOW closes the lstat/open replacement window on platforms that
  // support it. The post-open lstat and descriptor identity checks retain a
  // fail-closed fallback and occur before any bytes are written.
  const descriptor = openSync(
    paths.journal,
    fsConstants.O_RDWR
      | fsConstants.O_APPEND
      | (fsConstants.O_NOFOLLOW || 0)
      | (before ? 0 : fsConstants.O_CREAT | fsConstants.O_EXCL),
    0o600,
  );
  try {
    const opened = fstatSync(descriptor);
    const current = lstatSync(paths.journal);
    validateJournalMetadata(opened, paths.journal);
    validateJournalMetadata(current, paths.journal);
    assertSafePath(paths.repository, paths.journal);
    if (!sameFile(opened, current) || (before && !sameFile(before, opened))) {
      throw runtimeError('RUNTIME_EVENT_WRITE_FAILED', `Event Journal changed while opening: ${paths.journal}`, { recoverable: true });
    }
    return { descriptor, size: opened.size };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function acquireAppendLock(paths) {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    try {
      const descriptor = openSync(paths.lock, 'wx', 0o600);
      writeSync(descriptor, `${process.pid}\n`);
      closeSync(descriptor);
      return () => rmSync(paths.lock, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const metadata = lstatSync(paths.lock);
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
          throw runtimeError('RUNTIME_EVENT_WRITE_FAILED', `Unsafe Event Journal lock: ${paths.lock}`, { recoverable: true });
        }
        if (Date.now() - metadata.mtimeMs > STALE_LOCK_MS) {
          rmSync(paths.lock, { force: true });
          continue;
        }
      } catch (lockError) {
        if (lockError.code !== 'ENOENT') throw lockError;
      }
      sleepSync(10);
    }
  }
  throw runtimeError('RUNTIME_EVENT_WRITE_FAILED', 'Timed out acquiring the Event Journal append lock.', { recoverable: true });
}

function parseSequenceLine(descriptor, start, length) {
  if (length <= 0 || length > MAX_EVENT_LINE_BYTES) return null;
  const buffer = Buffer.alloc(length);
  const bytesRead = readSync(descriptor, buffer, 0, length, start);
  if (bytesRead !== length) return null;
  let line = buffer.toString('utf8');
  if (line.endsWith('\r')) line = line.slice(0, -1);
  try {
    const event = JSON.parse(line);
    return validStoredEvent(event) ? event.sequence : null;
  } catch {
    return null;
  }
}

function lastSequence(descriptor, size) {
  if (size === 0) return 0;
  // Scan all the way toward byte zero with bounded buffers. A crash may leave
  // an arbitrarily large malformed tail, but it must never reset sequence.
  let position = size;
  let lineEnd = size;
  const buffer = Buffer.alloc(READ_CHUNK_BYTES);
  while (position > 0) {
    const length = Math.min(buffer.length, position);
    position -= length;
    const bytesRead = readSync(descriptor, buffer, 0, length, position);
    for (let index = bytesRead - 1; index >= 0; index -= 1) {
      if (buffer[index] !== 0x0a) continue;
      const newline = position + index;
      const sequence = parseSequenceLine(descriptor, newline + 1, lineEnd - newline - 1);
      if (sequence !== null) return sequence;
      lineEnd = newline;
    }
  }
  const sequence = parseSequenceLine(descriptor, 0, lineEnd);
  if (sequence !== null) return sequence;
  throw runtimeError(
    'RUNTIME_EVENT_WRITE_FAILED',
    'Unable to determine the last valid Event Journal sequence because the existing journal is corrupted.',
    { recoverable: true },
  );
}

function journalNeedsSeparator(descriptor, size) {
  if (size === 0) return false;
  const byte = Buffer.alloc(1);
  return readSync(descriptor, byte, 0, 1, size - 1) !== 1 || byte[0] !== 0x0a;
}

export function appendRuntimeEvent(root, input = {}) {
  let paths;
  let release = () => {};
  let descriptor = null;
  try {
    const type = validateType(input.type);
    paths = eventPaths(root, { create: true });
    release = acquireAppendLock(paths);
    const opened = openJournalForAppend(paths);
    descriptor = opened.descriptor;
    const event = {
      schemaVersion: EVENT_SCHEMA_VERSION,
      eventId: `evt_${randomUUID()}`,
      sequence: lastSequence(descriptor, opened.size) + 1,
      timestamp: new Date().toISOString(),
      type,
    };
    for (const field of ASSOCIATION_FIELDS) {
      if (typeof input[field] === 'string' && input[field].trim()) event[field] = redactOutput(input[field].trim(), 512);
    }
    event.data = sanitizeRuntimeEventData(input.data);
    const line = `${journalNeedsSeparator(descriptor, opened.size) ? '\n' : ''}${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_LINE_BYTES) {
      throw runtimeError('RUNTIME_EVENT_WRITE_FAILED', `Runtime event exceeds ${MAX_EVENT_LINE_BYTES} bytes.`, { recoverable: false });
    }
    writeSync(descriptor, line, null, 'utf8');
    fsyncSync(descriptor);
    return event;
  } catch (error) {
    if (error?.code === 'RUNTIME_EVENT_WRITE_FAILED') throw error;
    throw runtimeError('RUNTIME_EVENT_WRITE_FAILED', `Unable to append Runtime Event: ${redactOutput(error.message || String(error), 2 * 1024)}`, { recoverable: true });
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    release();
  }
}

function normalizedReadOptions(options = {}) {
  const limit = options.limit === undefined ? DEFAULT_EVENT_LIMIT : Number(options.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EVENT_LIMIT) {
    throw runtimeError('RUNTIME_EVENT_READ_FAILED', `Event limit must be an integer between 1 and ${MAX_EVENT_LIMIT}.`, { recoverable: false });
  }
  const after = options.after === undefined || options.after === null ? null : Number(options.after);
  if (after !== null && (!Number.isInteger(after) || after < 0)) {
    throw runtimeError('RUNTIME_EVENT_READ_FAILED', 'Event sequence cursor must be a non-negative integer.', { recoverable: false });
  }
  const types = options.type === undefined || options.type === null
    ? null
    : new Set((Array.isArray(options.type) ? options.type : [options.type]).map(validateType));
  return { limit, after, types, taskId: options.taskId || null, sessionId: options.sessionId || null };
}

function matches(event, options) {
  if (options.after !== null && event.sequence <= options.after) return false;
  if (options.taskId && event.taskId !== options.taskId) return false;
  if (options.sessionId && event.sessionId !== options.sessionId) return false;
  if (options.types && !options.types.has(event.type)) return false;
  return true;
}

export function readRuntimeEvents(root, options = {}) {
  const normalized = normalizedReadOptions(options);
  const { directory, journal } = eventPaths(root);
  if (!existsSync(journal)) return [];
  assertSafePath(realpathSync(resolve(root)), directory);
  const metadata = lstatSync(journal);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw runtimeError('RUNTIME_EVENT_READ_FAILED', `Unsafe Event Journal: ${journal}`, { recoverable: false });
  }
  const descriptor = openSync(journal, 'r');
  const events = [];
  let remainder = '';
  const consume = line => {
    if (!line || Buffer.byteLength(line, 'utf8') > MAX_EVENT_LINE_BYTES) return;
    try {
      const event = JSON.parse(line);
      if (!validStoredEvent(event) || !matches(event, normalized)) return;
      if (normalized.after !== null) {
        if (events.length < normalized.limit) events.push(event);
      } else {
        events.push(event);
        if (events.length > normalized.limit) events.shift();
      }
    } catch { /* Malformed or partial lines are skipped fail-safe. */ }
  };
  try {
    const buffer = Buffer.alloc(READ_CHUNK_BYTES);
    let bytesRead;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      const text = remainder + buffer.subarray(0, bytesRead).toString('utf8');
      const lines = text.split(/\r?\n/);
      remainder = lines.pop() || '';
      if (Buffer.byteLength(remainder, 'utf8') > MAX_EVENT_LINE_BYTES) remainder = '';
      for (const line of lines) consume(line);
      if (normalized.after !== null && events.length >= normalized.limit) break;
    } while (bytesRead > 0);
    consume(remainder);
  } finally {
    closeSync(descriptor);
  }
  return events.sort((a, b) => a.sequence - b.sequence);
}
