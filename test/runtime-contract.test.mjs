import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalErrorCode, ERROR_CODES } from '../skills/coordinate-agents/scripts/runtime-contract.mjs';

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
