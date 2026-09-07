#!/usr/bin/env node
import { readWorkspaceTask } from './workspace-task-runtime.mjs';
import { runtimeSessionRead, runtimeSessionWrite } from './session-service.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

// Resolve only the recorded pair; never fall back to another task's Session.
export async function workspaceMessage(root, taskId, operation, value, api = { readWorkspaceTask, runtimeSessionRead, runtimeSessionWrite }) {
  if (!['send', 'read'].includes(operation)) throw new Error('Expected send <instruction> or read <cursor>.');
  if (operation === 'send' && (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > 64 * 1024)) throw new Error('Instruction must contain 1–65536 bytes.');
  const cursor = operation === 'read' ? Number(value) : null;
  if (operation === 'read' && (!Number.isSafeInteger(cursor) || cursor < 0)) throw new Error('A nonnegative output cursor is required.');
  const task = await api.readWorkspaceTask(root, taskId);
  const sessionId = task.sessions.antigravity.sessionId;
  if (!sessionId || task.status !== 'RUNNING') throw new Error('Task pair is not ready. No input was sent.');
  const options = { root, sessionId, maxBytes: 8192, maxLines: 80 };
  const before = await api.runtimeSessionRead({ ...options, cursor });
  if (before.session?.taskId !== taskId || before.session?.agent !== 'antigravity') throw new Error('Session task binding mismatch.');
  if (operation === 'read') return {
    ok: true, sessionId, cursor: before.nextCursor, state: before.session.state,
    output: stripVTControlCharacters(before.output || ''), truncated: before.truncated,
    hint: 'Terminal output may contain redraws. Idle is not proof of completion.',
  };
  await api.runtimeSessionWrite({ root, sessionId, input: value, submit: false });
  await api.runtimeSessionWrite({ root, sessionId, input: '\r', submit: false });
  return { ok: true, sessionId, cursor: before.nextCursor, sent: true, hint: 'Read using this cursor; delivery is not completion.' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await workspaceMessage(process.cwd(), ...process.argv.slice(2))));
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
