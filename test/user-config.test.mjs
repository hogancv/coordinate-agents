import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
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
