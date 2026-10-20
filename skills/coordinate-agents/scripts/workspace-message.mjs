#!/usr/bin/env node
import { readGitChanges } from './workspace-git-changes.mjs';
import { randomUUID } from 'node:crypto';
import { readWorkspaceTask, dispatchWorkspaceTask, reportWorkspaceTask } from './workspace-task-runtime.mjs';
import { runtimeSessionRead, runtimeSessionWrite } from './session-service.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';

const DEFAULT_API = { readWorkspaceTask, runtimeSessionRead, runtimeSessionWrite, dispatchWorkspaceTask, reportWorkspaceTask };
const USAGE = 'Expected send <instruction>, read <cursor>, wait <cursor> [revision] [timeout-ms], changes, or report <status> <roundId> [summary].';
const FINAL_RECEIPTS = new Set(['DONE', 'APPROVED', 'CHANGES_REQUESTED', 'FAILED']);

function nonnegativeInteger(value, name) {
  if (value === undefined || value === null || `${value}`.trim() === '' || !Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new Error(`A nonnegative ${name} is required.`);
  return Number(value);
}

function receipt(cooperation) {
  return cooperation || { status: 'IDLE', roundId: null, revision: 0, summary: '', updatedAt: null };
}

// Resolve only the recorded pair; never fall back to another task's Session.
// The fifth argument remains the injectable API used by existing callers.
export async function workspaceMessage(root, taskId, operation, value, api = DEFAULT_API, options = {}) {
  const caller = options.caller || (process.env.COORDINATE_AGENTS_SESSION_ID ? {
    taskId: process.env.COORDINATE_AGENTS_TASK_ID, slot: process.env.COORDINATE_AGENTS_SLOT,
    sessionId: process.env.COORDINATE_AGENTS_SESSION_ID, runtimeGeneration: process.env.COORDINATE_AGENTS_RUNTIME_GENERATION,
  } : undefined);
  if (!['send', 'read', 'wait', 'report', 'changes'].includes(operation)) throw new Error(USAGE);
  if (operation === 'changes') {
    await api.readWorkspaceTask(root, taskId); // Validate the task in this root; no Session or cooperation writes.
    return readGitChanges(root);
  }
  if (operation === 'report') {
    const status = `${value || ''}`.toUpperCase().replaceAll('-', '_');
    const cooperation = await api.reportWorkspaceTask(root, taskId, status, options.roundId, options.summary ?? '', { caller });
    return { ok: true, reported: true, ...cooperation };
  }
  if (operation === 'send' && (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 64 * 1024)) throw new Error('Instruction must contain 1–65536 bytes.');
  const cursor = operation === 'send' ? null : nonnegativeInteger(value, 'output cursor');
  const revision = options.revision === undefined ? undefined : nonnegativeInteger(options.revision, 'cooperation revision');
  const timeoutMs = options.timeoutMs === undefined ? 60_000 : nonnegativeInteger(options.timeoutMs, 'timeout');
  if (timeoutMs > 60_000) throw new Error('Wait timeout must be at most 60000 ms.');
  const pollMs = Math.max(5, Math.min(1000, options.pollMs || 1000));
  const task = await api.readWorkspaceTask(root, taskId);
  if (task.mode === 'custom') throw new Error('Custom tasks do not support default collaboration.');
  const sessionId = task.sessions.antigravity.sessionId;
  if (!sessionId || task.archivedAt || task.status !== 'RUNNING') throw new Error('Task pair is not ready. No input was sent.');
  const readOptions = { root, sessionId, maxBytes: 8192, maxLines: 80, cursor };
  async function readOutput() {
    const result = await api.runtimeSessionRead(readOptions);
    if (result.session?.taskId !== taskId || result.session?.agent !== 'antigravity' || (result.session?.id && result.session.id !== sessionId)) {
      const error = new Error('Session task binding mismatch.');
      error.code = 'WORKSPACE_MESSAGE_BINDING';
      throw error;
    }
    return result;
  }
  function response(output, cooperation) {
    return {
      ok: true, sessionId, cursor: output.nextCursor, state: output.session.state,
      output: stripVTControlCharacters(output.output || ''), truncated: output.truncated,
      ...receipt(cooperation),
      hint: 'Cooperation states are agent reports. Terminal idle or output is not proof of completion.',
    };
  }
  if (operation === 'send') {
    const roundId = `round-${randomUUID()}`;
    let before;
    const cooperation = await api.dispatchWorkspaceTask(root, taskId, roundId, async () => {
      const current = await api.readWorkspaceTask(root, taskId);
      if (current.status !== 'RUNNING' || current.sessions.antigravity.sessionId !== sessionId) throw new Error('Task pair changed. No input was sent.');
      before = await readOutput();
      const input = `[Workspace ${taskId}; roundId ${roundId}]\n${value}\nReport working/done/failed using this roundId and the supplied workspace-message helper.`;
      try {
        await api.runtimeSessionWrite({ root, sessionId, input, submit: false });
        await api.runtimeSessionWrite({ root, sessionId, input: '\r', submit: false });
      } catch (error) {
        throw new Error(`Dispatch write failed; input may have been partially sent. Do not resend automatically. ${error.message}`);
      }
    }, { caller });
    // Sending starts a new response window at the stream head. A normal read
    // cursor only acknowledges the history page that was actually returned.
    return { ok: true, sent: true, sessionId,
      cursor: Number.isSafeInteger(before.latestCursor) ? before.latestCursor : before.nextCursor, ...cooperation,
      hint: 'SENT means written to the terminal, not received or started. Wait using cursor and revision; never resend automatically.' };
  }
  if (operation === 'read') {
    const output = await readOutput();
    const current = await api.readWorkspaceTask(root, taskId);
    if (current.sessions.antigravity.sessionId !== sessionId) throw new Error('Task pair changed; read the current task before waiting again.');
    return response(output, current.cooperation);
  }

  const deadline = Date.now() + timeoutMs;
  const baseline = revision ?? receipt(task.cooperation).revision;
  const changed = cooperation => cooperation.revision !== baseline || cooperation.roundId !== receipt(task.cooperation).roundId
    || (revision === undefined && FINAL_RECEIPTS.has(cooperation.status));
  async function currentTask() {
    const current = await api.readWorkspaceTask(root, taskId);
    if (current.sessions.antigravity.sessionId !== sessionId) throw new Error('Task pair changed; read the current task before waiting again.');
    return current;
  }
  function stateResponse(current, pending, outputError) {
    return { ok: true, sessionId, cursor, state: current.sessions.antigravity.state,
      output: '', ...receipt(current.cooperation), pending, ...(outputError ? { outputError: outputError.message } : {}) };
  }
  let pendingRead;
  const timedOut = Symbol('timeout');
  while (true) {
    let current = await currentTask();
    if (changed(receipt(current.cooperation))) return stateResponse(current, false);
    // Keep one read in flight; check receipts once per second even if the host is slow.
    pendingRead ??= readOutput().then(output => ({ output }), error => ({ error }));
    let timer;
    const result = await Promise.race([
      pendingRead,
      new Promise(done => { timer = setTimeout(() => done(timedOut), Math.max(1, Math.min(pollMs, deadline - Date.now()))); }),
    ]).finally(() => clearTimeout(timer));
    current = await currentTask();
    if (result.error?.code === 'WORKSPACE_MESSAGE_BINDING') throw result.error;
    if (changed(receipt(current.cooperation))) return result.output
      ? { ...response(result.output, current.cooperation), pending: false }
      : stateResponse(current, false, result.error);
    if (result === timedOut) {
      if (Date.now() >= deadline) return stateResponse(current, true);
      continue;
    }
    pendingRead = null;
    if (result.error) throw result.error;
    if (result.output.output || result.output.nextCursor !== cursor) return { ...response(result.output, current.cooperation), pending: false };
    if (Date.now() >= deadline) return { ...response(result.output, current.cooperation), pending: true };
    await new Promise(done => setTimeout(done, Math.min(pollMs, deadline - Date.now())));
  }

}

function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try { return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return resolve(process.argv[1]) === fileURLToPath(import.meta.url); }
}
if (isInvokedDirectly()) {
  try {
    const [taskId, operation, value, ...args] = process.argv.slice(2);
    if ((operation === 'report' && args.length > 2) || (operation === 'wait' && args.length > 2) || (!['report', 'wait'].includes(operation) && args.length)) throw new Error(USAGE);
    if (operation === 'changes' && value !== undefined) throw new Error(USAGE);
    const options = operation === 'report' ? { roundId: args[0], summary: args[1] }
      : { revision: args[0], timeoutMs: args[1] };
    console.log(JSON.stringify(await workspaceMessage(process.cwd(), taskId, operation, value, DEFAULT_API, options)));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
