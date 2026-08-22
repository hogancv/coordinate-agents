import { resolve } from 'node:path';
import {
  getExecutionSessionManager,
  resolveConfiguredSessionAgent,
} from './session-manager.mjs';
import { jsonSuccess } from './runtime-contract.mjs';

function sessionInputRoot(input) {
  return resolve(`${input?.root || process.cwd()}`);
}

export async function runtimeSessionOpen(input = {}) {
  const root = sessionInputRoot(input);
  const agent = `${input.agent || ''}`.trim().toLowerCase();
  const resolution = resolveConfiguredSessionAgent(root, agent);
  const opened = await getExecutionSessionManager().open({
    root,
    agent,
    resolved: resolution.resolved,
    adapter: resolution.adapter,
    initialPrompt: typeof input.initialPrompt === 'string' ? input.initialPrompt : '',
    language: input.language || 'en',
  });
  let session = opened.session;
  if (typeof input.initialPrompt === 'string' && input.initialPrompt.length > 0 && !opened.initialInputConsumed) {
    session = await getExecutionSessionManager().write(root, session.id, input.initialPrompt);
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
