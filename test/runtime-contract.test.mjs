import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ERROR_CODES,
  canonicalErrorCode,
  jsonFailure,
  legacyErrorCode,
  normalizeRuntimeError,
  runtimeError,
  serializeRuntimeError,
} from '../skills/coordinate-agents/scripts/runtime-contract.mjs';

test('legacyErrorCode maps known canonical error codes to legacy representations', () => {
  assert.equal(legacyErrorCode('EXECUTABLE_NOT_FOUND'), 'COMMAND_NOT_FOUND');
  assert.equal(legacyErrorCode('EXECUTABLE_NOT_RUNNABLE'), 'COMMAND_NOT_EXECUTABLE');
  assert.equal(legacyErrorCode('AGENT_EXIT_NONZERO'), 'PROCESS_EXIT_NON_ZERO');
  assert.equal(legacyErrorCode('AGENT_RUNTIME_ERROR'), 'AGENT_STATE_ERROR');
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
