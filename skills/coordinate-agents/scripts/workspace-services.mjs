// Only Workspace-owned sessions and task pairs are writable from the Web.
import { saveNotificationConfig } from './workspace-notification-config.mjs';
import { testWorkspaceNotification } from './workspace-notifications.mjs';
import * as sessions from './session-service.mjs';
import { readWorkspaceTask, runtimeWorkspaceTaskContinue, runtimeWorkspaceTaskCreate, runtimeWorkspaceTaskClose, runtimeWorkspaceTaskRestart, runtimeWorkspaceTaskArchive, runtimeWorkspaceTaskPromptSend } from './workspace-task-runtime.mjs';
import { saveCustomWorkspaceConfig } from './workspace-custom-config.mjs';
import { resolve } from 'node:path';
import { runtimeError } from './runtime-contract.mjs';
export async function assertWorkspaceSession(input) {
  const { session } = await sessions.runtimeSessionStatus(input);
  const task = session.taskId ? await readWorkspaceTask(input.root, session.taskId) : null;
  const owned = task && resolve(session.cwd) === resolve(input.root) && Object.values(task.sessions).some(slot => slot.sessionId === session.id && slot.agent === session.agent
    && (task.mode !== 'custom' || slot.slot === session.subtaskId));
  if (!owned || task.archivedAt) throw runtimeError('SESSION_STATE_CONFLICT', 'Session is not owned by a Workspace Task in this project.', { recoverable: false, sessionId: input.sessionId });
  return session;
}
const sessionHandler = handler => async input => { await assertWorkspaceSession(input); return handler(input); };
export const WORKSPACE_OPERATIONS = Object.freeze({
  workspaceNotificationsSave: async input => ({ ok: true, notifications: saveNotificationConfig(input.root, input.notifications) }),
  workspaceNotificationsTest: async input => ({ ok: true, notification: await testWorkspaceNotification(input.root) }),
  workspaceTaskCreate: runtimeWorkspaceTaskCreate,
  workspaceTaskContinue: runtimeWorkspaceTaskContinue,
  workspaceTaskClose: runtimeWorkspaceTaskClose,
  workspaceTaskRestart: runtimeWorkspaceTaskRestart,
  workspaceTaskArchive: runtimeWorkspaceTaskArchive,
  workspaceTaskPromptSend: runtimeWorkspaceTaskPromptSend,
  workspaceCustomSettingsSave: async input => ({ ok: true, custom: saveCustomWorkspaceConfig(input.root, input.custom) }),
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
// A slow OS test must not hold up terminal input or task lifecycle actions.
// Keep at most one test per project in this server, with no queued replay.
const notificationTests = new Set();
export async function withWorkspaceNotificationTest(root, operation) {
  const key = resolve(root || process.cwd());
  if (notificationTests.has(key)) throw new Error('A desktop notification test is already running for this project.');
  notificationTests.add(key);
  try { return await operation(); }
  finally { notificationTests.delete(key); }
}
export async function invokeRuntimeOperation(operation, input = {}, { before } = {}) {
  const handler = Object.hasOwn(WORKSPACE_OPERATIONS, operation) ? WORKSPACE_OPERATIONS[operation] : null;
  if (!handler) throw new Error(`Unknown Workspace operation: ${operation}`);
  const dispatch = operation === 'workspaceNotificationsTest' ? withWorkspaceNotificationTest : withWorkspaceProjectOperation;
  return dispatch(input.root, async () => { before?.(); return handler(input); });
}
