import { redactOutput } from '../adapters/executable.mjs';

/**
 * Stable machine-facing runtime contract shared by the CLI and plugin skills.
 * Human-readable output remains a CLI concern; this module only normalizes facts.
 */

export const ERROR_CODES = Object.freeze([
  'PLUGIN_RUNTIME_NOT_FOUND',
  'EXECUTABLE_NOT_FOUND',
  'EXECUTABLE_NOT_RUNNABLE',
  'SPAWN_FAILED',
  'AGENT_EXIT_NONZERO',
  'AGENT_TIMEOUT',
  'AGENT_RUNTIME_ERROR',
  'AUTH_REQUIRED',
  'INVALID_AGENT_CONFIG',
  'INVALID_ADAPTER_CONFIG',
  'TASK_NOT_FOUND',
  'TASK_ALREADY_RUNNING',
  'TASK_STATE_CONFLICT',
  'TASK_GRAPH_INVALID',
  'INTENT_SCOPE_DRIFT',
  'STALE_CLAIM',
  'DIRTY_WORKTREE',
  'WORKTREE_CONFLICT',
  'UNSUPPORTED_CAPABILITY',
  'SESSION_NOT_FOUND',
  'SESSION_NOT_ATTACHED',
  'SESSION_NOT_HEALTHY',
  'SESSION_START_FAILED',
  'SESSION_WRITE_FAILED',
  'SESSION_CLOSE_FAILED',
  'SESSION_RUNTIME_ERROR',
  'SESSION_STATE_CONFLICT',
  'RUNTIME_EVENT_WRITE_FAILED',
  'RUNTIME_EVENT_READ_FAILED',
  'WORKSPACE_TASK_NOT_FOUND',
  'WORKSPACE_TASK_START_FAILED',
  'WORKSPACE_TASK_CLOSE_FAILED',
  'WORKSPACE_TASK_STATE_CONFLICT',
]);

const ERROR_CODE_SET = new Set(ERROR_CODES);

const LEGACY_CODE_MAP = Object.freeze({
  COMMAND_NOT_FOUND: 'EXECUTABLE_NOT_FOUND',
  COMMAND_NOT_EXECUTABLE: 'EXECUTABLE_NOT_RUNNABLE',
  UNSAFE_WINDOWS_ENTRYPOINT: 'EXECUTABLE_NOT_RUNNABLE',
  VERSION_CHECK_FAILED: 'EXECUTABLE_NOT_RUNNABLE',
  CONFIG_RESOLUTION_FAILED: 'INVALID_AGENT_CONFIG',
  DETECTION_FAILED: 'AGENT_RUNTIME_ERROR',
  PROCESS_EXIT_NON_ZERO: 'AGENT_EXIT_NONZERO',
  AGENT_STATE_ERROR: 'AGENT_RUNTIME_ERROR',
  LAUNCH_FAILED: 'AGENT_RUNTIME_ERROR',
  EXECUTABLE_CHECK_FAILED: 'EXECUTABLE_NOT_RUNNABLE',
  INVALID_CONFIG: 'INVALID_AGENT_CONFIG',
});

export function canonicalErrorCode(code, fallback = 'AGENT_RUNTIME_ERROR') {
  if (typeof code === 'string' && ERROR_CODE_SET.has(code)) return code;
  if (typeof code === 'string' && LEGACY_CODE_MAP[code]) return LEGACY_CODE_MAP[code];
  return ERROR_CODE_SET.has(fallback) ? fallback : 'AGENT_RUNTIME_ERROR';
}

export function legacyErrorCode(code) {
  if (code === 'EXECUTABLE_NOT_FOUND') return 'COMMAND_NOT_FOUND';
  if (code === 'EXECUTABLE_NOT_RUNNABLE') return 'COMMAND_NOT_EXECUTABLE';
  if (code === 'AGENT_EXIT_NONZERO') return 'PROCESS_EXIT_NON_ZERO';
  if (code === 'AGENT_RUNTIME_ERROR') return 'AGENT_STATE_ERROR';
  return code;
}

export function isExplicitAuthFailure(value) {
  const text = `${value || ''}`;
  return /(?:not\s+authenticated|authentication\s+required|authorization\s+required|unauthorized|please\s+(?:log|sign)\s*[- ]?in|(?:log|sign)\s*[- ]?in\s+required|login\s+required|invalid\s+(?:api\s+)?(?:key|token))/i.test(text);
}

export function runtimeError(code, message, options = {}) {
  const error = new Error(`${message || code}`);
  error.code = canonicalErrorCode(code, options.fallback || 'AGENT_RUNTIME_ERROR');
  error.legacyCode = options.legacyCode || legacyErrorCode(code);
  error.recoverable = options.recoverable ?? !['TASK_NOT_FOUND', 'INVALID_AGENT_CONFIG', 'INVALID_ADAPTER_CONFIG'].includes(error.code);
  error.details = options.details ?? null;
  error.command = options.command ?? null;
  error.agent = options.agent ?? null;
  error.adapter = options.adapter ?? null;
  error.taskId = options.taskId ?? null;
  error.subtaskId = options.subtaskId ?? null;
  error.stage = options.stage ?? null;
  error.sessionId = options.sessionId ?? null;
  error.root = options.root ?? null;
  error.result = options.result;
  return error;
}

export function normalizeRuntimeError(error, fallback = 'AGENT_RUNTIME_ERROR') {
  if (error && error.code && ERROR_CODE_SET.has(error.code)) return error;
  const rawMessage = `${error?.message || error || 'Runtime operation failed'}`;
  const rawOutput = `${error?.result?.stdoutTail || ''}\n${error?.result?.stderrTail || ''}`;
  const code = isExplicitAuthFailure(`${rawMessage}\n${rawOutput}`)
    ? 'AUTH_REQUIRED'
    : canonicalErrorCode(error?.code, fallback);
  return runtimeError(code, rawMessage, {
    fallback,
    recoverable: error?.recoverable,
    details: error?.details,
    command: error?.command,
    agent: error?.agent,
    adapter: error?.adapter,
    taskId: error?.taskId,
    subtaskId: error?.subtaskId,
    stage: error?.stage,
    sessionId: error?.sessionId,
    root: error?.root,
    result: error?.result,
    legacyCode: error?.legacyCode || legacyErrorCode(error?.code),
  });
}

export function serializeRuntimeError(error, options = {}) {
  const normalized = normalizeRuntimeError(error, options.fallback || 'AGENT_RUNTIME_ERROR');
  const output = {
    code: canonicalErrorCode(normalized.code),
    message: redactOutput(`${normalized.message || 'Runtime operation failed'}`, 2 * 1024),
    recoverable: Boolean(normalized.recoverable),
  };
  for (const key of ['details', 'command', 'agent', 'adapter', 'taskId', 'subtaskId', 'stage', 'sessionId', 'root']) {
    if (normalized[key] !== undefined && normalized[key] !== null && normalized[key] !== '') {
      if (key === 'details') {
        const details = typeof normalized[key] === 'string'
          ? normalized[key]
          : JSON.stringify(normalized[key]);
        output[key] = redactOutput(details || '', 2 * 1024);
      } else output[key] = normalized[key];
    }
  }
  if (options.includeLegacy && normalized.legacyCode && normalized.legacyCode !== output.code) {
    output.legacyCode = normalized.legacyCode;
  }
  if (normalized.result && typeof normalized.result === 'object') {
    const result = normalized.result;
    output.exitCode = result.status ?? null;
    output.signal = result.signal ?? null;
    if (result.resolvedCommand) output.resolvedCommand = result.resolvedCommand;
  }
  return output;
}

export function jsonSuccess(command, payload = {}) {
  return { ok: true, command, ...payload };
}

export function jsonFailure(command, error, payload = {}) {
  return {
    ok: false,
    command,
    ...payload,
    error: serializeRuntimeError(error, { includeLegacy: true }),
  };
}
