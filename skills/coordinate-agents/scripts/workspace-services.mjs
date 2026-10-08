// Only Workspace-owned sessions and task pairs are writable from the Web.
import * as sessions from './session-service.mjs';
import { readWorkspaceTask, runtimeWorkspaceTaskCreate, runtimeWorkspaceTaskClose, runtimeWorkspaceTaskRestart, runtimeWorkspaceTaskArchive } from './workspace-task-runtime.mjs';
import { resolve } from 'node:path';
import { runtimeError } from './runtime-contract.mjs';
export async function assertWorkspaceSession(input) {
  const { session } = await sessions.runtimeSessionStatus(input);
  const task = session.taskId ? await readWorkspaceTask(input.root, session.taskId) : null;
  const owned = task && Object.values(task.sessions).some(slot => slot.sessionId === session.id && slot.agent === session.agent);
  if (!owned || task.archivedAt) throw runtimeError('SESSION_STATE_CONFLICT', 'Session is not owned by a Workspace Task in this project.', { recoverable: false, sessionId: input.sessionId });
  return session;
}
const sessionHandler = handler => async input => { await assertWorkspaceSession(input); return handler(input); };
export const WORKSPACE_OPERATIONS = Object.freeze({
  workspaceTaskCreate: runtimeWorkspaceTaskCreate,
  workspaceTaskClose: runtimeWorkspaceTaskClose,
  workspaceTaskRestart: runtimeWorkspaceTaskRestart,
  workspaceTaskArchive: runtimeWorkspaceTaskArchive,
  sessionStatus: sessionHandler(sessions.runtimeSessionStatus),
  sessionInspect: sessionHandler(sessions.runtimeSessionInspect),
  sessionRead: sessionHandler(sessions.runtimeSessionRead),
  sessionWrite: sessionHandler(sessions.runtimeSessionWrite),
  sessionResize: sessionHandler(sessions.runtimeSessionResize),
  sessionClose: sessionHandler(sessions.runtimeSessionClose),
});
const projectOperations = new Map();
export async function withWorkspaceProjectOperation(root, operation) {
  const key = resolve(root || process.cwd());
  const previous = projectOperations.get(key) || Promise.resolve();
  let release;
  const current = new Promise(done => { release = done; });
  projectOperations.set(key, current);
  await previous;
  try { return await operation(); }
  finally { release(); if (projectOperations.get(key) === current) projectOperations.delete(key); }
}
export async function invokeRuntimeOperation(operation, input = {}, { before } = {}) {
  const handler = Object.hasOwn(WORKSPACE_OPERATIONS, operation) ? WORKSPACE_OPERATIONS[operation] : null;
  if (!handler) throw new Error(`Unknown Workspace operation: ${operation}`);
  return withWorkspaceProjectOperation(input.root, async () => { before?.(); return handler(input); });
}
