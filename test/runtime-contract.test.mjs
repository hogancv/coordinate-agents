import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isExplicitAuthFailure,
  normalizeRuntimeError,
  serializeRuntimeError,
  runtimeError,
  canonicalErrorCode,
  legacyErrorCode,
  jsonFailure,
  ERROR_CODES,
} from '../skills/coordinate-agents/scripts/runtime-contract.mjs';

test('isExplicitAuthFailure: matches explicit authentication and authorization failure phrases', () => {
  const matchingCases = [
    // Branch 1: not authenticated
    'not authenticated',
    'User is NOT AUTHENTICATED.',
    'Error: not   authenticated',

    // Branch 2: authentication required
    'authentication required',
    'AUTHENTICATION REQUIRED to perform this action',

    // Branch 3: authorization required
    'authorization required',
    'AUTHORIZATION REQUIRED: missing permission',

    // Branch 4: unauthorized
    'unauthorized',
    '401 Unauthorized',
    'UNAUTHORIZED access attempt',

    // Branch 5: please log/sign in (with optional hyphens and spaces)
    'please log in',
    'please sign in',
    'Please log-in first',
    'PLEASE SIGN-IN TO CONTINUE',
    'please login',
    'please signin',

    // Branch 6: log/sign in required
    'log in required',
    'sign in required',
    'LOG-IN REQUIRED',
    'sign-in required',

    // Branch 7: login required
    'login required',
    'LOGIN REQUIRED: active session expired',

    // Branch 8: invalid (api) key/token
    'invalid key',
    'invalid token',
    'Invalid API Key',
    'invalid api token',
    'ERROR: Invalid API key provided',
  ];

  for (const text of matchingCases) {
    assert.equal(isExplicitAuthFailure(text), true, `Expected true for: "${text}"`);
  }
});

test('isExplicitAuthFailure: returns false for non-auth error messages and negative patterns', () => {
  const nonMatchingCases = [
    'Connection refused',
    '404 Not Found',
    'Internal Server Error',
    'authorized user created successfully',
    'login succeeded',
    'logging in progress',
    'key value store initialized',
    'token bucket capacity exceeded',
    'invalid request body format',
    'task failed successfully',
    'git push rejected',
  ];

  for (const text of nonMatchingCases) {
    assert.equal(isExplicitAuthFailure(text), false, `Expected false for: "${text}"`);
  }
});

test('isExplicitAuthFailure: safely handles falsy, null, undefined, and non-string inputs', () => {
  assert.equal(isExplicitAuthFailure(null), false);
  assert.equal(isExplicitAuthFailure(undefined), false);
  assert.equal(isExplicitAuthFailure(''), false);
  assert.equal(isExplicitAuthFailure(0), false);
  assert.equal(isExplicitAuthFailure(false), false);
  assert.equal(isExplicitAuthFailure(NaN), false);
  assert.equal(isExplicitAuthFailure(401), false);
  assert.equal(isExplicitAuthFailure({}), false);

  // Error instances whose string representation contains auth failure text
  assert.equal(isExplicitAuthFailure(new Error('unauthorized')), true);
  assert.equal(isExplicitAuthFailure({ toString: () => 'invalid api key' }), true);
});

test('isExplicitAuthFailure: matches auth failure embedded in multiline tool or CLI stdout/stderr', () => {
  const multilineOutput = `
[INFO] Starting execution session...
[WARN] Requesting remote endpoint https://api.example.com/v1/tasks
[ERROR] HTTP 401: Unauthorized access
[ERROR] Please sign-in to refresh your token
`;

  assert.equal(isExplicitAuthFailure(multilineOutput), true);
});

test('normalizeRuntimeError: integrates isExplicitAuthFailure to produce AUTH_REQUIRED code', () => {
  const authError = new Error('HTTP 401: Unauthorized');
  const normalized = normalizeRuntimeError(authError);
  assert.equal(normalized.code, 'AUTH_REQUIRED');

  const stdoutStderrAuthError = {
    message: 'Process exited with code 1',
    result: {
      stdoutTail: 'Connecting...',
      stderrTail: 'ERROR: invalid api key',
    },
  };
  const normalizedStderr = normalizeRuntimeError(stdoutStderrAuthError);
  assert.equal(normalizedStderr.code, 'AUTH_REQUIRED');

  // Existing valid error code is preserved even if message contains auth text
  const explicitCodeError = runtimeError('SESSION_NOT_FOUND', 'unauthorized session');
  const normalizedExplicit = normalizeRuntimeError(explicitCodeError);
  assert.equal(normalizedExplicit.code, 'SESSION_NOT_FOUND');

  // General error without auth text gets fallback
  const generalError = new Error('Disk full');
  const normalizedGeneral = normalizeRuntimeError(generalError, 'AGENT_RUNTIME_ERROR');
  assert.equal(normalizedGeneral.code, 'AGENT_RUNTIME_ERROR');
});

test('serializeRuntimeError: redacts and formats errors with auth failure detection', () => {
  const serialized = serializeRuntimeError(new Error('Please log-in required'), { includeLegacy: true });
  assert.equal(serialized.code, 'AUTH_REQUIRED');
  assert.equal(serialized.recoverable, true);
});

test('canonicalErrorCode and legacyErrorCode support standard runtime errors', () => {
  assert.equal(canonicalErrorCode('AUTH_REQUIRED'), 'AUTH_REQUIRED');
  assert.equal(canonicalErrorCode('COMMAND_NOT_FOUND'), 'EXECUTABLE_NOT_FOUND');
  assert.equal(canonicalErrorCode('UNKNOWN_CODE', 'INVALID_AGENT_CONFIG'), 'INVALID_AGENT_CONFIG');
  assert.equal(canonicalErrorCode(null), 'AGENT_RUNTIME_ERROR');
  assert.equal(legacyErrorCode('EXECUTABLE_NOT_FOUND'), 'COMMAND_NOT_FOUND');
  assert.equal(legacyErrorCode('EXECUTABLE_NOT_RUNNABLE'), 'COMMAND_NOT_EXECUTABLE');
  assert.equal(legacyErrorCode('AGENT_EXIT_NONZERO'), 'PROCESS_EXIT_NON_ZERO');
  assert.equal(legacyErrorCode('AGENT_RUNTIME_ERROR'), 'AGENT_STATE_ERROR');
  assert.equal(legacyErrorCode('AUTH_REQUIRED'), 'AUTH_REQUIRED');
});

test('legacyErrorCode returns unmapped codes and arbitrary strings as-is', () => {
  assert.equal(legacyErrorCode('AUTH_REQUIRED'), 'AUTH_REQUIRED');
  assert.equal(legacyErrorCode('TASK_NOT_FOUND'), 'TASK_NOT_FOUND');
  assert.equal(legacyErrorCode('SESSION_NOT_FOUND'), 'SESSION_NOT_FOUND');
  assert.equal(legacyErrorCode('CUSTOM_UNKNOWN_CODE'), 'CUSTOM_UNKNOWN_CODE');
});

test('legacyErrorCode handles non-string and falsy edge case inputs without throwing', () => {
  assert.equal(legacyErrorCode(undefined), undefined);
  assert.equal(legacyErrorCode(null), null);
  assert.equal(legacyErrorCode(''), '');
  assert.equal(legacyErrorCode(123), 123);
  assert.equal(legacyErrorCode(false), false);
  const obj = {};
  assert.equal(legacyErrorCode(obj), obj);
});

test('runtimeError uses legacyErrorCode for default legacyCode property', () => {
  const err1 = runtimeError('EXECUTABLE_NOT_FOUND', 'Binary missing');
  assert.equal(err1.code, 'EXECUTABLE_NOT_FOUND');
  assert.equal(err1.legacyCode, 'COMMAND_NOT_FOUND');

  const err2 = runtimeError('AUTH_REQUIRED', 'Log in first');
  assert.equal(err2.code, 'AUTH_REQUIRED');
  assert.equal(err2.legacyCode, 'AUTH_REQUIRED');

  // Explicit override in options
  const err3 = runtimeError('EXECUTABLE_NOT_FOUND', 'Binary missing', { legacyCode: 'CUSTOM_LEGACY' });
  assert.equal(err3.legacyCode, 'CUSTOM_LEGACY');
});

test('normalizeRuntimeError computes legacyCode via legacyErrorCode when wrapping raw errors', () => {
  const rawErr = new Error('Executable unavailable');
  rawErr.code = 'COMMAND_NOT_EXECUTABLE'; // Legacy code string
  const normalized = normalizeRuntimeError(rawErr);
  assert.equal(normalized.code, 'EXECUTABLE_NOT_RUNNABLE');
  assert.equal(normalized.legacyCode, 'COMMAND_NOT_EXECUTABLE');
});

test('serializeRuntimeError and jsonFailure include legacyCode when requested', () => {
  const err = runtimeError('AGENT_EXIT_NONZERO', 'Process failed');
  const serialized = serializeRuntimeError(err, { includeLegacy: true });
  assert.equal(serialized.code, 'AGENT_EXIT_NONZERO');
  assert.equal(serialized.legacyCode, 'PROCESS_EXIT_NON_ZERO');

  const failureResponse = jsonFailure('run-agent', err);
  assert.equal(failureResponse.ok, false);
  assert.equal(failureResponse.command, 'run-agent');
  assert.equal(failureResponse.error.code, 'AGENT_EXIT_NONZERO');
  assert.equal(failureResponse.error.legacyCode, 'PROCESS_EXIT_NON_ZERO');
});

test('canonicalErrorCode returns valid canonical error codes unchanged', () => {
  for (const code of ERROR_CODES) {
    assert.equal(canonicalErrorCode(code), code);
    assert.equal(canonicalErrorCode(code, 'TASK_NOT_FOUND'), code);
  }
});

test('canonicalErrorCode maps legacy error codes to canonical codes', () => {
  const legacyMappings = {
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
  };

  for (const [legacy, expectedCanonical] of Object.entries(legacyMappings)) {
    assert.equal(
      canonicalErrorCode(legacy),
      expectedCanonical,
      `Expected legacy code ${legacy} to map to ${expectedCanonical}`
    );
  }
});

test('canonicalErrorCode handles unknown string codes with default fallback', () => {
  assert.equal(canonicalErrorCode('UNKNOWN_CODE_XYZ'), 'AGENT_RUNTIME_ERROR');
  assert.equal(canonicalErrorCode('SOME_OTHER_UNKNOWN'), 'AGENT_RUNTIME_ERROR');
  assert.equal(canonicalErrorCode(''), 'AGENT_RUNTIME_ERROR');
});

test('canonicalErrorCode handles unknown string codes with custom valid fallback', () => {
  assert.equal(canonicalErrorCode('UNKNOWN_CODE_XYZ', 'EXECUTABLE_NOT_FOUND'), 'EXECUTABLE_NOT_FOUND');
  assert.equal(canonicalErrorCode('UNKNOWN_CODE_XYZ', 'INVALID_AGENT_CONFIG'), 'INVALID_AGENT_CONFIG');
  assert.equal(canonicalErrorCode('UNKNOWN_CODE_XYZ', 'AUTH_REQUIRED'), 'AUTH_REQUIRED');
});

test('canonicalErrorCode defaults to AGENT_RUNTIME_ERROR when custom fallback is invalid', () => {
  assert.equal(canonicalErrorCode('UNKNOWN_CODE_XYZ', 'INVALID_FALLBACK_CODE'), 'AGENT_RUNTIME_ERROR');
  assert.equal(canonicalErrorCode('UNKNOWN_CODE_XYZ', null), 'AGENT_RUNTIME_ERROR');
  assert.equal(canonicalErrorCode('UNKNOWN_CODE_XYZ', 123), 'AGENT_RUNTIME_ERROR');
  assert.equal(canonicalErrorCode('UNKNOWN_CODE_XYZ', {}), 'AGENT_RUNTIME_ERROR');
});

test('canonicalErrorCode handles non-string inputs with default and custom fallbacks', () => {
  const nonStringInputs = [
    null,
    undefined,
    123,
    0,
    true,
    false,
    {},
    [],
    Symbol('test'),
    () => {},
  ];

  for (const input of nonStringInputs) {
    assert.equal(
      canonicalErrorCode(input),
      'AGENT_RUNTIME_ERROR',
      `Expected non-string input ${String(input)} with default fallback to return AGENT_RUNTIME_ERROR`
    );

    assert.equal(
      canonicalErrorCode(input, 'TASK_NOT_FOUND'),
      'TASK_NOT_FOUND',
      `Expected non-string input ${String(input)} with custom valid fallback to return TASK_NOT_FOUND`
    );

    assert.equal(
      canonicalErrorCode(input, 'NOT_A_VALID_CODE'),
      'AGENT_RUNTIME_ERROR',
      `Expected non-string input ${String(input)} with custom invalid fallback to return AGENT_RUNTIME_ERROR`
    );
  }
});
