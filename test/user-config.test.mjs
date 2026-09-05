import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseConfigValue } from '../lib/commands/config.mjs';
import {
  defaultUserConfig,
  readUserConfig,
  resolveAgentConfig,
  setUserConfigValue,
  userConfigPath,
  writeUserConfig,
} from '../skills/coordinate-agents/scripts/user-config.mjs';

test('user configuration resolves under the injected home and preserves command precedence', () => {
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-user-config-'));
  try {
    const path = userConfigPath({ home });
    assert.equal(path, join(home, '.coordinate-agents', 'config.json'));
    assert.deepEqual(readUserConfig({ home }), defaultUserConfig());

    const config = readUserConfig({ home });
    setUserConfigValue(config, 'agent.antigravity.command', 'agy-proxy');
    setUserConfigValue(config, 'agent.antigravity.args', []);
    writeUserConfig(config, { home });

    assert.equal(readFileSync(path, 'utf8').includes('agy-proxy'), true);
    assert.deepEqual(resolveAgentConfig({ id: 'antigravity', adapter: 'antigravity-cli' }, readUserConfig({ home })), {
      id: 'antigravity',
      adapter: 'antigravity-cli',
      command: 'agy-proxy',
      args: [],
      commandSource: 'user',
      argsSource: 'user',
    });
    assert.equal(resolveAgentConfig({ id: 'antigravity', adapter: 'antigravity-cli', command: 'agy-special' }, readUserConfig({ home })).command, 'agy-special');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('parseConfigValue parses valid values and validates .args format', () => {
  // Non-args keys are returned as-is
  assert.equal(parseConfigValue('agent.antigravity.command', 'agy-proxy'), 'agy-proxy');
  assert.equal(parseConfigValue('adapters', '["adapter.mjs"]'), '["adapter.mjs"]');
  assert.equal(parseConfigValue('some.args.key', 'value'), 'value');

  // Valid JSON string arrays for .args keys are parsed into arrays
  assert.deepEqual(parseConfigValue('agent.antigravity.args', '["--verbose", "--port", "8080"]'), ['--verbose', '--port', '8080']);
  assert.deepEqual(parseConfigValue('agent.custom.args', '[]'), []);

  // Invalid JSON syntax throws formatted error
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', '{invalid json'),
    /Invalid args value:/
  );

  // Non-array JSON values throw formatted error
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', '{"key": "value"}'),
    { message: 'Invalid args value: args must be a JSON array of strings.' }
  );
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', '123'),
    { message: 'Invalid args value: args must be a JSON array of strings.' }
  );
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', 'true'),
    { message: 'Invalid args value: args must be a JSON array of strings.' }
  );
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', 'null'),
    { message: 'Invalid args value: args must be a JSON array of strings.' }
  );

  // JSON arrays containing non-string elements throw formatted error
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', '[1, 2, 3]'),
    { message: 'Invalid args value: args must be a JSON array of strings.' }
  );
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', '["valid", null]'),
    { message: 'Invalid args value: args must be a JSON array of strings.' }
  );
  assert.throws(
    () => parseConfigValue('agent.antigravity.args', '[["nested"]]'),
    { message: 'Invalid args value: args must be a JSON array of strings.' }
  );
});

test('writing user configuration creates only the user-level directory', () => {
  const home = mkdtempSync(join(tmpdir(), 'coordinate-agents-user-config-persist-'));
  try {
    writeUserConfig({ version: 1, agents: { antigravity: { command: 'agy-proxy' } } }, { home });
    assert.ok(existsSync(join(home, '.coordinate-agents', 'config.json')));
    assert.equal(existsSync(join(home, 'skills')), false);
    assert.equal(existsSync(join(home, '.codex-plugin')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
