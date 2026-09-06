import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  defaultUserConfig,
  getUserConfigValue,
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

test('getUserConfigValue retrieves configured values and handles edge cases and errors', () => {
  const config = {
    version: 1,
    agents: {
      antigravity: {
        command: 'agy-proxy',
        args: ['--verbose', '--timeout=30'],
      },
      codex: {
        command: 'codex-custom',
      },
    },
  };

  // Happy path retrieval
  assert.equal(getUserConfigValue(config, 'agent.antigravity.command'), 'agy-proxy');
  assert.deepEqual(getUserConfigValue(config, 'agent.antigravity.args'), ['--verbose', '--timeout=30']);
  assert.equal(getUserConfigValue(config, 'agent.codex.command'), 'codex-custom');

  // Returning undefined for missing agent or unset field
  assert.equal(getUserConfigValue(config, 'agent.codex.args'), undefined);
  assert.equal(getUserConfigValue(config, 'agent.unknown.command'), undefined);
  assert.equal(getUserConfigValue(config, 'agent.unknown.args'), undefined);

  // Rejection of invalid key inputs
  assert.throws(() => getUserConfigValue(config, null), {
    message: 'Configuration key must be a string.',
  });
  assert.throws(() => getUserConfigValue(config, 123), {
    message: 'Configuration key must be a string.',
  });
  assert.throws(() => getUserConfigValue(config, 'invalid.key'), {
    message: 'Configuration key must look like agent.<agent-id>.command or agent.<agent-id>.args.',
  });
  assert.throws(() => getUserConfigValue(config, 'agent.antigravity.invalid'), {
    message: 'Configuration key must look like agent.<agent-id>.command or agent.<agent-id>.args.',
  });
  assert.throws(() => getUserConfigValue(config, 'agent.INVALID_AGENT.command'), {
    message: 'Configuration key must look like agent.<agent-id>.command or agent.<agent-id>.args.',
  });

  // Rejection of invalid config objects
  assert.throws(() => getUserConfigValue(null, 'agent.antigravity.command'), {
    message: 'User configuration must be a JSON object.',
  });
  assert.throws(() => getUserConfigValue({ version: 2, agents: {} }, 'agent.antigravity.command'), {
    message: 'Unsupported user configuration version: 2. Expected 1.',
  });
  assert.throws(() => getUserConfigValue({ version: 1, agents: null }, 'agent.antigravity.command'), {
    message: 'User configuration must define an "agents" object.',
  });
  assert.throws(() => getUserConfigValue({ version: 1, agents: { antigravity: 'not-an-object' } }, 'agent.antigravity.command'), {
    message: 'User configuration for agent "antigravity" must be an object.',
  });
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
