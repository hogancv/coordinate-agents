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

test('parseConfigValue parses non-.args configuration values as-is', () => {
  assert.equal(parseConfigValue('agent.antigravity.command', 'agy-proxy'), 'agy-proxy');
  assert.equal(parseConfigValue('some.custom.key', 'hello'), 'hello');
  assert.equal(parseConfigValue('adapters', '["path/one"]'), '["path/one"]');
});

test('parseConfigValue parses valid JSON array of strings for .args keys', () => {
  assert.deepEqual(parseConfigValue('agent.codex.args', '["--verbose", "--port", "8080"]'), ['--verbose', '--port', '8080']);
  assert.deepEqual(parseConfigValue('agent.antigravity.args', '[]'), []);
});

test('parseConfigValue rejects malformed or non-array JSON for .args keys', () => {
  assert.throws(
    () => parseConfigValue('agent.codex.args', 'not-json'),
    /Invalid args value:/
  );

  assert.throws(
    () => parseConfigValue('agent.codex.args', '{"arg": "val"}'),
    /Invalid args value: args must be a JSON array of strings\./
  );

  assert.throws(
    () => parseConfigValue('agent.codex.args', '123'),
    /Invalid args value: args must be a JSON array of strings\./
  );

  assert.throws(
    () => parseConfigValue('agent.codex.args', 'true'),
    /Invalid args value: args must be a JSON array of strings\./
  );

  assert.throws(
    () => parseConfigValue('agent.codex.args', 'null'),
    /Invalid args value: args must be a JSON array of strings\./
  );
});

test('parseConfigValue rejects JSON arrays containing non-string items for .args keys', () => {
  assert.throws(
    () => parseConfigValue('agent.codex.args', '[1, 2, 3]'),
    /Invalid args value: args must be a JSON array of strings\./
  );

  assert.throws(
    () => parseConfigValue('agent.codex.args', '["valid", null]'),
    /Invalid args value: args must be a JSON array of strings\./
  );

  assert.throws(
    () => parseConfigValue('agent.codex.args', '["valid", 123]'),
    /Invalid args value: args must be a JSON array of strings\./
  );

  assert.throws(
    () => parseConfigValue('agent.codex.args', '["valid", true]'),
    /Invalid args value: args must be a JSON array of strings\./
  );

  assert.throws(
    () => parseConfigValue('agent.codex.args', '["valid", {}]'),
    /Invalid args value: args must be a JSON array of strings\./
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
