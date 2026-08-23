import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  appendRuntimeEvent,
  EVENT_SCHEMA_VERSION,
  readRuntimeEvents,
  runtimeEventJournalPath,
} from '../skills/coordinate-agents/scripts/runtime-events.mjs';
import { createTask, markTaskError, recordReviewDecision, setTaskStatus, stopTask } from '../skills/coordinate-agents/scripts/task-runtime.mjs';
import { runtimeError } from '../skills/coordinate-agents/scripts/runtime-contract.mjs';

const busTool = join(process.cwd(), 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'coordinate-agents-events-'));
  assert.equal(spawnSync('git', ['init', root], { encoding: 'utf8' }).status, 0);
  const initialized = spawnSync(process.execPath, [busTool, 'init', '--root', root], { encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  return realpathSync(root);
}

test('Event Journal appends durable schema-v1 JSONL with monotonic sequence and unique IDs', () => {
  const root = repository();
  try {
    const first = appendRuntimeEvent(root, { type: 'TASK_CREATED', taskId: 'task-event-one', data: { round: 1 } });
    const second = appendRuntimeEvent(root, { type: 'SESSION_STARTED', taskId: 'task-event-one', sessionId: 'session_eventone', agentId: 'fixture', data: {} });
    assert.equal(first.schemaVersion, EVENT_SCHEMA_VERSION);
    assert.equal(first.sequence, 1);
    assert.equal(second.sequence, 2);
    assert.notEqual(first.eventId, second.eventId);
    assert.match(first.eventId, /^evt_[0-9a-f-]{36}$/);
    assert.equal(Number.isNaN(Date.parse(first.timestamp)), false);
    assert.equal(existsSync(runtimeEventJournalPath(root)), true);
    const lines = readFileSync(runtimeEventJournalPath(root), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(lines.map(event => event.sequence), [1, 2]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Event reader is bounded and supports latest, cursor, task, session, and type filters', () => {
  const root = repository();
  try {
    appendRuntimeEvent(root, { type: 'TASK_CREATED', taskId: 'task-filter-one', data: {} });
    appendRuntimeEvent(root, { type: 'SESSION_STARTED', taskId: 'task-filter-one', sessionId: 'session_filterone', data: {} });
    appendRuntimeEvent(root, { type: 'TASK_CREATED', taskId: 'task-filter-two', data: {} });
    appendRuntimeEvent(root, { type: 'SESSION_FAILED', taskId: 'task-filter-two', sessionId: 'session_filtertwo', data: {} });

    assert.deepEqual(readRuntimeEvents(root, { limit: 2 }).map(event => event.sequence), [3, 4]);
    assert.deepEqual(readRuntimeEvents(root, { after: 1, limit: 2 }).map(event => event.sequence), [2, 3]);
    assert.deepEqual(readRuntimeEvents(root, { taskId: 'task-filter-one', limit: 10 }).map(event => event.sequence), [1, 2]);
    assert.deepEqual(readRuntimeEvents(root, { sessionId: 'session_filtertwo', limit: 10 }).map(event => event.type), ['SESSION_FAILED']);
    assert.deepEqual(readRuntimeEvents(root, { type: 'TASK_CREATED', limit: 10 }).map(event => event.sequence), [1, 3]);
    assert.throws(() => readRuntimeEvents(root, { limit: 501 }), error => error.code === 'RUNTIME_EVENT_READ_FAILED');
    assert.throws(() => readRuntimeEvents(root, { after: -1 }), error => error.code === 'RUNTIME_EVENT_READ_FAILED');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Event reader tolerates missing, empty, malformed, partial, and oversized lines', () => {
  const missing = repository();
  const root = repository();
  try {
    assert.deepEqual(readRuntimeEvents(missing), []);
    mkdirSync(join(root, '.agent-bus', 'events'), { recursive: true });
    writeFileSync(runtimeEventJournalPath(root), '', 'utf8');
    assert.deepEqual(readRuntimeEvents(root), []);
    appendRuntimeEvent(root, { type: 'TASK_CREATED', taskId: 'task-malformed', data: {} });
    writeFileSync(runtimeEventJournalPath(root), `${readFileSync(runtimeEventJournalPath(root), 'utf8')}not-json\n{"partial":`, 'utf8');
    assert.deepEqual(readRuntimeEvents(root).map(event => event.type), ['TASK_CREATED']);
  } finally {
    rmSync(missing, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

test('Event payloads redact secret-bearing keys and values without persisting repository roots', () => {
  const root = repository();
  try {
    appendRuntimeEvent(root, {
      type: 'RUNTIME_ERROR',
      data: {
        token: 'token-value',
        password: 'password-value',
        cookie: 'cookie-value',
        privateKey: 'private-key-value',
        nested: { authorization: 'Bearer abc123', message: 'api_key=abc123 safe tail' },
      },
    });
    const raw = readFileSync(runtimeEventJournalPath(root), 'utf8');
    for (const secret of ['token-value', 'password-value', 'cookie-value', 'private-key-value', 'abc123']) assert.equal(raw.includes(secret), false);
    assert.equal(raw.includes(root), false);
    const [event] = readRuntimeEvents(root);
    assert.equal(event.data.token, '[REDACTED]');
    assert.match(event.data.nested.message, /\[REDACTED\]/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Task lifecycle writes truthful created, status, review, stop, and error events', () => {
  const root = repository();
  try {
    const approved = createTask(root, { id: 'task-lifecycle-approved', title: 'Approve fixture', spec: 'fixture' });
    setTaskStatus(root, approved.id, 'IMPLEMENTING');
    setTaskStatus(root, approved.id, 'REVIEWING');
    recordReviewDecision(root, approved.id, 'REVIEW_APPROVED');

    const changes = createTask(root, { id: 'task-lifecycle-changes', title: 'Changes fixture', spec: 'fixture' });
    setTaskStatus(root, changes.id, 'IMPLEMENTING');
    setTaskStatus(root, changes.id, 'REVIEWING');
    recordReviewDecision(root, changes.id, 'CHANGES_REQUESTED', { feedback: 'Add coverage.' });

    const stopped = createTask(root, { id: 'task-lifecycle-stopped', title: 'Stop fixture' });
    stopTask(root, stopped.id, 'user requested');
    const failed = createTask(root, { id: 'task-lifecycle-error', title: 'Error fixture' });
    markTaskError(root, failed.id, runtimeError('AGENT_RUNTIME_ERROR', 'token=must-not-leak', { recoverable: true }));

    const types = readRuntimeEvents(root, { limit: 100 }).map(event => event.type);
    for (const type of ['TASK_CREATED', 'TASK_STATUS_CHANGED', 'REVIEW_APPROVED', 'CHANGES_REQUESTED', 'TASK_STOPPED', 'TASK_ERROR']) {
      assert.ok(types.includes(type), `missing ${type}`);
    }
    assert.equal(readFileSync(runtimeEventJournalPath(root), 'utf8').includes('must-not-leak'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Agent Bus send, claim, and complete append real message lifecycle events', () => {
  const root = repository();
  try {
    const sent = spawnSync(process.execPath, [
      busTool, 'send', '--root', root, '--from', 'codex', '--to', 'antigravity',
      '--type', 'IMPLEMENT', '--subject', 'Bus lifecycle fixture',
      '--dedupe-key', 'task:task-bus-events:round:1:implement', '--body', 'Task ID: task-bus-events',
    ], { encoding: 'utf8' });
    assert.equal(sent.status, 0, sent.stderr || sent.stdout);
    const claimed = spawnSync(process.execPath, [
      busTool, 'wait', '--root', root, '--agent', 'antigravity',
      '--timeout-minutes', '0.1', '--poll-seconds', '0.01', '--lease-seconds', '60',
    ], { encoding: 'utf8' });
    assert.equal(claimed.status, 0, claimed.stderr || claimed.stdout);
    const messagePath = claimed.stdout.trim();
    const completed = spawnSync(process.execPath, [busTool, 'complete', '--root', root, '--message-path', messagePath], { encoding: 'utf8' });
    assert.equal(completed.status, 0, completed.stderr || completed.stdout);
    const events = readRuntimeEvents(root, { taskId: 'task-bus-events', limit: 20 });
    assert.deepEqual(events.map(event => event.type), ['BUS_MESSAGE_SENT', 'BUS_MESSAGE_PROCESSING', 'BUS_MESSAGE_PROCESSED']);
    assert.equal(new Set(events.map(event => event.messageId)).size, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('A post-state Event Journal failure is explicit and leaves the canonical Task fact inspectable', () => {
  const root = repository();
  try {
    writeFileSync(join(root, '.agent-bus', 'events'), 'not a directory', 'utf8');
    assert.throws(
      () => createTask(root, { id: 'task-event-write-failure', title: 'Failure semantics' }),
      error => error.code === 'RUNTIME_EVENT_WRITE_FAILED',
    );
    assert.equal(existsSync(join(root, '.agent-bus', 'tasks', 'task-event-write-failure.json')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
