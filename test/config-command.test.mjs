import assert from 'node:assert/strict';
import test from 'node:test';
import { parseConfigValue } from '../lib/commands/config.mjs';

test('parseConfigValue returns unparsed string for non-.args keys', () => {
  assert.equal(parseConfigValue('agent.antigravity.command', 'agy-proxy'), 'agy-proxy');
  assert.equal(parseConfigValue('some.other.key', '123'), '123');
  assert.equal(parseConfigValue('args', '["not", "parsed"]'), '["not", "parsed"]');
  assert.equal(parseConfigValue('agent.args.extra', 'hello'), 'hello');
  assert.equal(parseConfigValue('agent.antigravity.args.foo', 'bar'), 'bar');
});

test('parseConfigValue parses valid JSON array of strings for .args keys', () => {
  assert.deepEqual(parseConfigValue('agent.antigravity.args', '["--verbose", "--flag"]'), ['--verbose', '--flag']);
  assert.deepEqual(parseConfigValue('agent.codex.args', '[]'), []);
  assert.deepEqual(parseConfigValue('custom.args', '["single"]'), ['single']);
});

test('parseConfigValue throws descriptive error for invalid JSON syntax in .args keys', () => {
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', 'not json'),
    /Invalid args value:/
  );
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', '["unclosed array'),
    /Invalid args value:/
  );
});

test('parseConfigValue throws descriptive error for non-array JSON in .args keys', () => {
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', '{"foo": "bar"}'),
    {
      name: 'Error',
      message: 'Invalid args value: args must be a JSON array of strings.',
    }
  );
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', '123'),
    {
      name: 'Error',
      message: 'Invalid args value: args must be a JSON array of strings.',
    }
  );
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', 'true'),
    {
      name: 'Error',
      message: 'Invalid args value: args must be a JSON array of strings.',
    }
  );
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', 'null'),
    {
      name: 'Error',
      message: 'Invalid args value: args must be a JSON array of strings.',
    }
  );
});

test('parseConfigValue throws descriptive error for array containing non-string items', () => {
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', '[1, 2, 3]'),
    {
      name: 'Error',
      message: 'Invalid args value: args must be a JSON array of strings.',
    }
  );
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', '["valid", null, "string"]'),
    {
      name: 'Error',
      message: 'Invalid args value: args must be a JSON array of strings.',
    }
  );
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', '[true]'),
    {
      name: 'Error',
      message: 'Invalid args value: args must be a JSON array of strings.',
    }
  );
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', '[["nested"]]'),
    {
      name: 'Error',
      message: 'Invalid args value: args must be a JSON array of strings.',
    }
  );
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', '[{"key": "value"}]'),
    {
      name: 'Error',
      message: 'Invalid args value: args must be a JSON array of strings.',
    }
  );
});
