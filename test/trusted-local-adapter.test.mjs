import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  runtimeAdapterList,
  runtimeAdapterRegister,
  runtimeAdapterRemove,
  runtimeSetupConfigure,
  runtimeSetupDiscover,
  runtimeTaskCreate,
  runtimeTaskOperation,
} from '../bin/coordinate-agents.mjs';
import {
  runtimeSessionClose,
  runtimeSessionInspect,
  runtimeSessionOpen,
  runtimeSessionRead,
  runtimeSessionWrite,
} from '../skills/coordinate-agents/scripts/session-service.mjs';
import {
  getAdapterSourcePath,
  getAdapter,
  listAdapters,
} from '../skills/coordinate-agents/adapters/index.mjs';
import {
  normalizeTrustedAdapterModulePath,
  unregisterTrustedAdapterModule,
} from '../skills/coordinate-agents/adapters/trusted-local.mjs';
import { readUserConfig, userConfigPath } from '../skills/coordinate-agents/scripts/user-config.mjs';

const busTool = join(process.cwd(), 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');
const canonicalTmpdir = realpathSync(tmpdir());

function repository(prefix = 'coordinate-agents-trusted-local-') {
  const root = mkdtempSync(join(canonicalTmpdir, prefix));
  const git = spawnSync('git', ['init', root], { encoding: 'utf8', windowsHide: true });
  assert.equal(git.status, 0, git.stderr || git.stdout);
  const init = spawnSync(process.execPath, [busTool, 'init', '--root', root], { encoding: 'utf8', windowsHide: true });
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return root;
}

function isolatedHome() {
  const home = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-trusted-home-'));
  const previous = {
    coordinate: process.env.COORDINATE_AGENTS_HOME,
    home: process.env.HOME,
    profile: process.env.USERPROFILE,
  };
  process.env.COORDINATE_AGENTS_HOME = home;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return {
    home,
    restore() {
      if (previous.coordinate === undefined) delete process.env.COORDINATE_AGENTS_HOME;
      else process.env.COORDINATE_AGENTS_HOME = previous.coordinate;
      if (previous.home === undefined) delete process.env.HOME;
      else process.env.HOME = previous.home;
      if (previous.profile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = previous.profile;
    },
  };
}

function snapshotTree(root) {
  if (!existsSync(root)) return null;
  const entries = [];
  function visit(directory, relative = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = join(directory, entry.name);
      const name = relative ? join(relative, entry.name) : entry.name;
      const metadata = lstatSync(absolute);
      if (metadata.isSymbolicLink()) {
        entries.push([name, 'symlink']);
      } else if (entry.isDirectory()) {
        entries.push([name, 'directory']);
        visit(absolute, name);
      } else {
        entries.push([name, readFileSync(absolute).toString('base64')]);
      }
    }
  }
  visit(root);
  return entries;
}

function writeAdapterModule(root, id, sdkUrl, { source = null } = {}) {
  const modulePath = join(root, `${id}.mjs`);
  const content = source || `
import { existsSync } from 'node:fs';
import { ADAPTER_CONTRACT_VERSION, defineAdapter } from ${JSON.stringify(sdkUrl)};

const descriptor = defineAdapter({
  contractVersion: ADAPTER_CONTRACT_VERSION,
  id: ${JSON.stringify(id)},
  capabilities: {
    detection: true,
    configuration: true,
    oneShotLaunch: true,
    persistentSession: true,
  },
  create(config) {
    const command = config.command || '';
    const configuredArgs = Array.isArray(config.args) ? [...config.args] : [];
    const script = configuredArgs[0] || '';
    const prefix = script ? [script] : [];
    const args = script ? configuredArgs.slice(1) : configuredArgs;
    const facts = (root = undefined) => ({
      command,
      runtimeCommand: command,
      resolvedCommand: command,
      prefix: [...prefix],
      args: [...args],
      ...(root ? { cwd: root } : {}),
    });
    return {
      validateConfiguration() {
        return command && script && existsSync(script)
          ? { compatible: true, code: null, details: null }
          : { compatible: false, code: 'INVALID_ADAPTER_CONFIG', details: 'trusted fixture requires command and an existing script argument.' };
      },
      detect() {
        const compatible = command && script && existsSync(script);
        return compatible
          ? { available: true, command, runtimeCommand: command, resolvedCommand: command, prefix: [...prefix], version: 'trusted-fixture-1.0.0' }
          : { available: false, command, runtimeCommand: command, code: 'COMMAND_NOT_FOUND', details: 'trusted fixture executable is unavailable.' };
      },
      resolveLaunch({ root, prompt }) {
        return { ...facts(root), args: [...args, prompt] };
      },
      resolveSessionLaunch({ root }) {
        return { ...facts(root), initialInputConsumed: false };
      },
      launchPolicy() {
        return { mode: 'bus-supervised', pollIntervalMs: 10 };
      },
    };
  },
});

export default descriptor;
`;
  writeFileSync(modulePath, content, 'utf8');
  return modulePath;
}

function writeFixture(root) {
  const fixture = join(root, 'trusted-fixture.cjs');
  writeFileSync(fixture, String.raw`const fs = require('node:fs');
const cp = require('node:child_process');
if (process.env.TRUSTED_FIXTURE_STARTS) fs.appendFileSync(process.env.TRUSTED_FIXTURE_STARTS, 'S');
console.log('trusted-fixture-ready');
let buffer = '';
const completed = new Set();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  const matches = [...buffer.matchAll(/Task ID:\s*(task-[A-Za-z0-9_-]+)[\s\S]*?Round:\s*(\d+)/g)];
  for (const match of matches) {
    const key = match[1] + ':' + match[2];
    if (completed.has(key)) continue;
    completed.add(key);
    const result = cp.spawnSync(process.execPath, [process.env.BUS_TOOL, 'send', '--root', process.env.TRUSTED_FIXTURE_ROOT, '--from', 'node', '--to', 'codex', '--type', 'IMPLEMENTATION_DONE', '--subject', 'trusted local fixture done', '--related-commit', 'trustedfixture1234', '--body', 'Task ID: ' + match[1] + '\nimplementationCommit: trustedfixture1234\nTrusted local fixture completed'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) process.stderr.write(result.stderr || result.stdout || 'fixture send failed');
    console.log('trusted-fixture-done:' + key);
  }
});
`, 'utf8');
  return fixture;
}

function assertCanonicalFailure(error) {
  assert.equal(error.code, 'INVALID_ADAPTER_CONFIG');
  assert.ok(typeof error.message === 'string' && error.message.length < 2_048);
  return true;
}

async function removeTreeEventually(path) {
  let lastError = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      if (!existsSync(path)) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (lastError) throw lastError;
}

test('trusted local registration is explicit, canonical, and transactional', async () => {
  const root = repository();
  const home = isolatedHome();
  const sdkUrl = pathToFileURL(join(process.cwd(), 'adapter-sdk.mjs')).href;
  const busPath = join(root, '.agent-bus');
  const beforeBus = snapshotTree(busPath);
  const beforeUserConfig = snapshotTree(dirname(userConfigPath()));
  let registeredPath = null;
  try {
    assert.throws(
      () => normalizeTrustedAdapterModulePath('https://example.invalid/adapter.mjs'),
      assertCanonicalFailure,
    );
    assert.throws(
      () => normalizeTrustedAdapterModulePath('node:fs'),
      assertCanonicalFailure,
    );

    const badExport = join(root, 'bad-export.mjs');
    writeFileSync(badExport, 'export const nope = 1;\n', 'utf8');
    const badVersion = writeAdapterModule(root, 'bad-version', sdkUrl, {
      source: `export default { contractVersion: 999, id: 'bad-version', capabilities: { detection: true, configuration: true, oneShotLaunch: true, persistentSession: true }, create() {} };\n`,
    });
    const badCapabilities = writeAdapterModule(root, 'bad-capabilities', sdkUrl, {
      source: `export default { contractVersion: 1, id: 'bad-capabilities', capabilities: { detection: 'yes', configuration: true, oneShotLaunch: true, persistentSession: true }, create() {} };\n`,
    });
    const builtinOverride = writeAdapterModule(root, 'builtin-override', sdkUrl, {
      source: `export default { contractVersion: 1, id: 'generic-cli', capabilities: { detection: true, configuration: true, oneShotLaunch: true, persistentSession: true }, create() {} };\n`,
    });

    for (const candidate of [badExport, badVersion, badCapabilities, builtinOverride]) {
      await assert.rejects(runtimeAdapterRegister({ path: candidate }), assertCanonicalFailure);
      assert.deepEqual(snapshotTree(busPath), beforeBus);
      assert.deepEqual(snapshotTree(dirname(userConfigPath())), beforeUserConfig);
    }

    const valid = writeAdapterModule(root, 'fixture-local-adapter', sdkUrl);
    const registered = await runtimeAdapterRegister({ path: valid });
    assert.equal(registered.ok, true, JSON.stringify(registered));
    registeredPath = realpathSync(valid);
    assert.deepEqual(readUserConfig().adapters, [registeredPath]);
    assert.equal(getAdapterSourcePath('fixture-local-adapter'), registeredPath);
    assert.ok(listAdapters().includes('fixture-local-adapter'));

    await assert.rejects(runtimeAdapterRegister({ path: valid }), assertCanonicalFailure);
    assert.deepEqual(readUserConfig().adapters, [registeredPath]);
    assert.deepEqual(snapshotTree(busPath), beforeBus);

    const listed = await runtimeAdapterList();
    assert.equal(listed.ok, true);
    assert.ok(listed.adapters.some(adapter => adapter.id === 'fixture-local-adapter' && adapter.path === registeredPath));
    assert.deepEqual(listed.configuredPaths, [registeredPath]);
  } finally {
    if (registeredPath) {
      try { unregisterTrustedAdapterModule(registeredPath); } catch { /* Cleanup must not mask the test failure. */ }
    }
    await removeTreeEventually(root);
    await removeTreeEventually(home.home);
    home.restore();
  }
});

test('registered external adapter drives setup, Task dispatch, and Session reuse', async () => {
  const root = repository();
  const home = isolatedHome();
  const sdkUrl = pathToFileURL(join(process.cwd(), 'adapter-sdk.mjs')).href;
  const modulePath = writeAdapterModule(root, 'fixture-session-adapter', sdkUrl);
  const fixture = writeFixture(root);
  const previous = {
    busTool: process.env.BUS_TOOL,
    fixtureRoot: process.env.TRUSTED_FIXTURE_ROOT,
    starts: process.env.TRUSTED_FIXTURE_STARTS,
  };
  process.env.BUS_TOOL = busTool;
  process.env.TRUSTED_FIXTURE_ROOT = root;
  process.env.TRUSTED_FIXTURE_STARTS = join(root, 'starts.txt');
  let sessionId = null;
  let registeredPath = null;
  try {
    await runtimeAdapterRegister({ path: modulePath });
    registeredPath = realpathSync(modulePath);
    const beforeFailedSetupBus = snapshotTree(join(root, '.agent-bus'));
    const beforeFailedSetupUserConfig = snapshotTree(dirname(userConfigPath()));
    await assert.rejects(
      runtimeSetupConfigure({
        root,
        agent: 'external-failing',
        command: process.execPath,
        adapter: 'fixture-session-adapter',
        args: [join(root, 'missing-fixture.cjs')],
        role: 'implementer',
      }),
      error => error.code === 'INVALID_ADAPTER_CONFIG',
    );
    assert.deepEqual(snapshotTree(join(root, '.agent-bus')), beforeFailedSetupBus);
    assert.deepEqual(snapshotTree(dirname(userConfigPath())), beforeFailedSetupUserConfig);

    const configured = await runtimeSetupConfigure({
      root,
      agent: 'node',
      command: process.execPath,
      adapter: 'fixture-session-adapter',
      args: [fixture, '--trusted-fixture'],
      role: 'implementer',
    });
    assert.equal(configured.ok, true, JSON.stringify(configured));
    assert.equal(configured.agent.adapter, 'fixture-session-adapter');
    assert.equal(configured.agent.resolvedCommand, process.execPath);

    const discovered = await runtimeSetupDiscover({ root });
    assert.equal(discovered.ok, true, JSON.stringify(discovered));
    const discoveredAdapter = discovered.adapters.find(adapter => adapter.id === 'fixture-session-adapter');
    assert.deepEqual(discoveredAdapter?.capabilities, {
      detection: true,
      configuration: true,
      oneShotLaunch: true,
      persistentSession: true,
    });
    assert.equal(discoveredAdapter.configuredAgents[0].id, 'node');
    assert.equal(discoveredAdapter.configuredAgents[0].available, true);
    assert.equal(discoveredAdapter.configuredAgents[0].command, process.execPath);
    assert.equal(discovered.agents.at(-1).configuredAgent, 'node');
    assert.equal(discovered.agents.at(-1).adapter, 'fixture-session-adapter');

    const created = await runtimeTaskCreate({
      root,
      id: 'task-trusted-local',
      title: 'Trusted local adapter fixture',
      spec: 'Exercise a registered local Contract v1 adapter.',
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    const dispatched = await runtimeTaskOperation('dispatch', {
      root,
      taskId: 'task-trusted-local',
      sessionWaitMs: 4_000,
    });
    assert.equal(dispatched.ok, true, JSON.stringify(dispatched));
    assert.equal(dispatched.task.status, 'REVIEWING');
    sessionId = dispatched.session.id;
    assert.equal(dispatched.agent.adapter, 'fixture-session-adapter');
    assert.equal(dispatched.agent.resolvedCommand, process.execPath);

    const reused = await runtimeSessionOpen({ root, agent: 'node' });
    assert.equal(reused.ok, true, JSON.stringify(reused));
    assert.equal(reused.reused, true);
    assert.equal(reused.session.id, sessionId);

    await runtimeSessionWrite({ root, sessionId, input: 'trusted local session input' });
    let inspected = await runtimeSessionInspect({ root, sessionId, maxLines: 40, maxBytes: 8_192 });
    for (let attempt = 0; attempt < 40 && !inspected.output.output.includes('trusted-fixture-ready'); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
      inspected = await runtimeSessionInspect({ root, sessionId, maxLines: 40, maxBytes: 8_192 });
    }
    assert.match(inspected.output.output, /trusted-fixture-ready/);
    const read = await runtimeSessionRead({ root, sessionId, maxLines: 40, maxBytes: 8_192 });
    assert.match(read.output, /trusted-fixture/);

    const closed = await runtimeSessionClose({ root, sessionId, timeoutMs: 1_000 });
    assert.ok(['exited', 'failed'].includes(closed.session.state));
    assert.equal(closed.session.pid, null);
    assert.equal(readFileSync(process.env.TRUSTED_FIXTURE_STARTS, 'utf8'), 'S');

    const removed = await runtimeAdapterRemove({ path: registeredPath });
    assert.equal(removed.ok, true, JSON.stringify(removed));
    assert.deepEqual(readUserConfig().adapters, []);
    assert.equal((await runtimeAdapterList()).adapters.some(adapter => adapter.id === 'fixture-session-adapter'), false);
    assert.equal(listAdapters().includes('fixture-session-adapter'), false);
  } finally {
    if (sessionId) {
      try { await runtimeSessionClose({ root, sessionId, graceful: false, timeoutMs: 500 }); } catch { /* Best effort cleanup. */ }
    }
    if (registeredPath) {
      try { unregisterTrustedAdapterModule(registeredPath); } catch { /* Cleanup must not mask the test failure. */ }
    }
    if (previous.busTool === undefined) delete process.env.BUS_TOOL;
    else process.env.BUS_TOOL = previous.busTool;
    if (previous.fixtureRoot === undefined) delete process.env.TRUSTED_FIXTURE_ROOT;
    else process.env.TRUSTED_FIXTURE_ROOT = previous.fixtureRoot;
    if (previous.starts === undefined) delete process.env.TRUSTED_FIXTURE_STARTS;
    else process.env.TRUSTED_FIXTURE_STARTS = previous.starts;
    await removeTreeEventually(root);
    await removeTreeEventually(home.home);
    home.restore();
  }
});
