import { resolve, win32 } from 'node:path';
import { GenericCliAdapter } from '../adapters/generic-cli.mjs';
import { codexWindowsEntrypoint } from '../adapters/codex-cli.mjs';
import { validateTerminalCommand } from './workspace-custom-config.mjs';
import {
  getExecutionSessionManager,
  resolveConfiguredSessionAgent,
} from './session-manager.mjs';
import { jsonSuccess } from './runtime-contract.mjs';

function sessionInputRoot(input) {
  return resolve(`${input?.root || process.cwd()}`);
}

// Task-only entry, not an arbitrary command endpoint. Resolve the immutable
// command from the owning task and never modify the project agent registry.
export async function runtimeWorkspaceCustomSessionOpen({ root, taskId, slot, language = 'en' }) {
  const { readWorkspaceTask } = await import('./workspace-task-runtime.mjs');
  const task = await readWorkspaceTask(root, taskId);
  if (task.mode !== 'custom' || !['terminal1', 'terminal2'].includes(slot)
    || task.archivedAt || task.status !== 'STARTING' || task.sessions[slot].sessionId) throw new Error('Custom Session launch does not belong to a starting task slot.');
  const command = validateTerminalCommand(task.custom[slot].command);
  const name = win32.basename(command).replace(/\.(exe|cmd|ps1)$/i, '').toLowerCase();
  // Only known executable transport requirements, never role or prompt inference.
  const resolved = { adapter: 'generic-cli', command, args: name === 'codex' ? ['--no-alt-screen'] : ['agy', 'agy-proxy'].includes(name) ? ['--prompt-interactive='] : [],
    ...(name === 'codex' ? { windowsEntrypoint: codexWindowsEntrypoint } : {}) };
  const opened = await getExecutionSessionManager().open({ root, agent: 'workspace-custom', resolved,
    adapter: new GenericCliAdapter(resolved), initialPrompt: '', language, taskId, subtaskId: slot, reuseExisting: false });
  return jsonSuccess('session.open', { root, session: opened.session, reused: false });
}

export async function runtimeSessionOpen(input = {}) {
  const root = sessionInputRoot(input);
  const agent = `${input.agent || ''}`.trim().toLowerCase();
  const resolution = await resolveConfiguredSessionAgent(root, agent);
  if (input.conversationId !== undefined && (agent !== 'codex' || resolution.resolved.adapter !== 'codex-cli')) {
    throw new Error('Native conversation resume requires the built-in Codex CLI adapter.');
  }
  const opened = await getExecutionSessionManager().open({
    root,
    agent,
    resolved: resolution.resolved,
    adapter: resolution.adapter,
    initialPrompt: typeof input.initialPrompt === 'string' ? input.initialPrompt : '',
    language: input.language || 'en',
    taskId: input.taskId || null,
    subtaskId: input.subtaskId || null,
    workspace: input.workspace === true,
    ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
    reuseExisting: input.reuseExisting !== false,
  });
  let session = opened.session;
  if (typeof input.initialPrompt === 'string' && input.initialPrompt.length > 0 && !opened.initialInputConsumed) {
    try {
      session = await getExecutionSessionManager().write(root, session.id, input.initialPrompt, {
        taskId: input.taskId || null,
        subtaskId: input.subtaskId || null,
      });
    } catch (error) {
      if (!opened.reused) {
        try {
          await getExecutionSessionManager().close(root, session.id, { graceful: false, timeoutMs: 1_000 });
        } catch { /* Startup cleanup remains owned by the Session Manager. */ }
      }
      throw error;
    }
  }
  return jsonSuccess('session.open', {
    root,
    session,
    reused: opened.reused,
  });
}

export async function runtimeSessionStatus(input = {}) {
  const root = sessionInputRoot(input);
  const session = await getExecutionSessionManager().status(root, input.sessionId);
  return jsonSuccess('session.status', { root, session });
}

export async function runtimeSessionInspect(input = {}) {
  const root = sessionInputRoot(input);
  const inspected = await getExecutionSessionManager().inspect(root, input.sessionId, {
    maxLines: input.maxLines,
    maxBytes: input.maxBytes,
  });
  return jsonSuccess('session.inspect', { root, ...inspected });
}

export async function runtimeSessionWrite(input = {}) {
  const root = sessionInputRoot(input);
  const session = await getExecutionSessionManager().write(root, input.sessionId, input.input, { submit: input.submit !== false });
  return jsonSuccess('session.write', { root, session });
}

export async function runtimeSessionRead(input = {}) {
  const root = sessionInputRoot(input);
  const output = await getExecutionSessionManager().read(root, input.sessionId, {
    cursor: input.cursor,
    maxLines: input.maxLines,
    maxBytes: input.maxBytes,
  });
  return jsonSuccess('session.read', { root, ...output });
}

export async function runtimeSessionSubscribe(input = {}) {
  return getExecutionSessionManager().subscribe(sessionInputRoot(input), input.sessionId, input);
}

export async function runtimeSessionClose(input = {}) {
  const root = sessionInputRoot(input);
  const session = await getExecutionSessionManager().close(root, input.sessionId, {
    graceful: input.graceful !== false,
    timeoutMs: input.timeoutMs,
  });
  return jsonSuccess('session.close', { root, session });
}

export async function runtimeSessionResize(input = {}) {
  const root = sessionInputRoot(input);
  const session = await getExecutionSessionManager().resize(root, input.sessionId, input.cols, input.rows);
  return jsonSuccess('session.resize', { root, session });
}

export async function runtimeSessionInterrupt(input = {}) {
  const root = sessionInputRoot(input);
  const session = await getExecutionSessionManager().interrupt(root, input.sessionId);
  return jsonSuccess('session.interrupt', { root, session });
}

export async function runtimeSessionFacts(root, sessionId, { includeOutput = false } = {}) {
  if (!sessionId) return null;
  const manager = getExecutionSessionManager();
  const inspected = includeOutput
    ? await manager.inspect(root, sessionId, { maxLines: 60, maxBytes: 8 * 1024 })
    : { session: await manager.status(root, sessionId) };
  return {
    ...inspected.session,
    lastExitCode: inspected.session.exitCode ?? null,
    ...(includeOutput ? { output: inspected.output } : {}),
  };
}

export { getExecutionSessionManager };
