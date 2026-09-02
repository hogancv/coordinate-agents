import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runtimeAdapterRegister,
  runtimeAdapterRemove,
  runtimeSetupConfigure,
  runtimeTaskCreate,
  runtimeTaskOperation,
} from '../../bin/coordinate-agents.mjs';
import {
  runtimeSessionClose,
  runtimeSessionInspect,
  runtimeSessionOpen,
  runtimeSessionRead,
  runtimeSessionWrite,
} from '../../skills/coordinate-agents/scripts/session-service.mjs';
import { resolveConfiguredSessionAgent } from '../../skills/coordinate-agents/scripts/session-manager.mjs';
import { listAdapters } from '../../skills/coordinate-agents/adapters/index.mjs';

const rootDirectory = process.cwd();
const busTool = join(rootDirectory, 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');
const canonicalTmpdir = realpathSync(tmpdir());
const exampleRoot = join(rootDirectory, 'examples', 'minimal-external-adapter');
const modulePath = join(exampleRoot, 'adapter.mjs');
const executable = join(exampleRoot, 'fake-agent.mjs');

async function removeDirectoryWithRetry(path) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code) || attempt === 49) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

async function main() {
  const repository = mkdtempSync(join(canonicalTmpdir, 'coordinate-agents-example-repository-'));
  let registeredPath = null;
  let sessionId = null;
  const environmentKeys = [
    'COORDINATE_MINIMAL_EXTERNAL_ADAPTER_BUS_TOOL',
    'COORDINATE_MINIMAL_EXTERNAL_ADAPTER_ROOT',
    'COORDINATE_MINIMAL_EXTERNAL_ADAPTER_FROM',
    'COORDINATE_MINIMAL_EXTERNAL_ADAPTER_TO',
  ];
  const previousEnvironment = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  try {
    const git = spawnSync('git', ['init', repository], { encoding: 'utf8', windowsHide: true });
    assert.equal(git.status, 0, git.stderr || git.stdout);
    const init = spawnSync(process.execPath, [busTool, 'init', '--root', repository], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(init.status, 0, init.stderr || init.stdout);

    const registered = await runtimeAdapterRegister({ path: modulePath });
    assert.equal(registered.ok, true, JSON.stringify(registered));
    registeredPath = realpathSync(modulePath);
    assert.ok(listAdapters().includes('minimal-external-adapter'));

    const configured = await runtimeSetupConfigure({
      root: repository,
      agent: 'minimal-example',
      command: process.execPath,
      adapter: 'minimal-external-adapter',
      args: [executable],
      role: 'implementer',
    });
    assert.equal(configured.ok, true, JSON.stringify(configured));
    assert.equal(configured.agent.id, 'minimal-example');
    assert.equal(configured.agent.adapter, 'minimal-external-adapter');
    assert.equal(configured.agent.command, process.execPath);
    assert.equal(configured.agent.resolvedCommand, process.execPath);
    assert.deepEqual(configured.agent.args, [executable]);

    const resolution = await resolveConfiguredSessionAgent(repository, 'minimal-example');
    const launch = resolution.adapter.resolveSessionLaunch({
      root: repository,
      agent: 'minimal-example',
      initialPrompt: 'minimal external persistent prompt',
    });
    assert.deepEqual(launch.prefix, [executable]);
    assert.deepEqual(launch.args, ['--mode', 'persistent']);

    // The fake executable is still entirely offline. These scoped variables
    // enable it to send the deterministic IMPLEMENTATION_DONE fixture when
    // the Runtime writes the real Task prompt through the owned Session.
    process.env.COORDINATE_MINIMAL_EXTERNAL_ADAPTER_BUS_TOOL = busTool;
    process.env.COORDINATE_MINIMAL_EXTERNAL_ADAPTER_ROOT = repository;
    process.env.COORDINATE_MINIMAL_EXTERNAL_ADAPTER_FROM = 'minimal-example';
    process.env.COORDINATE_MINIMAL_EXTERNAL_ADAPTER_TO = 'codex';

    const created = await runtimeTaskCreate({
      root: repository,
      id: 'task-minimal-external',
      title: 'Minimal external Adapter acceptance path',
      spec: 'Exercise setup, Task dispatch, persistent Session reuse, I/O, and cleanup.',
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    const taskId = created.task.id;

    const dispatched = await runtimeTaskOperation('dispatch', {
      root: repository,
      taskId,
      sessionWaitMs: 5_000,
    });
    assert.equal(dispatched.ok, true, JSON.stringify(dispatched));
    assert.equal(dispatched.task.status, 'REVIEWING');
    assert.equal(dispatched.task.implementationCommit, 'minimalexternal1234');
    assert.equal(dispatched.agent.adapter, 'minimal-external-adapter');
    assert.equal(dispatched.agent.resolvedCommand, process.execPath);
    assert.equal(dispatched.launch.type, 'persistent-pty-session');
    sessionId = dispatched.session.id;

    const opened = await runtimeSessionOpen({
      root: repository,
      agent: 'minimal-example',
    });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    assert.equal(opened.reused, true);
    assert.equal(opened.session.id, sessionId);
    assert.equal(opened.session.agent, 'minimal-example');
    assert.equal(opened.session.command, process.execPath);

    const written = await runtimeSessionWrite({
      root: repository,
      sessionId,
      input: 'minimal external persistent prompt',
    });
    assert.equal(written.ok, true, JSON.stringify(written));

    let inspected = await runtimeSessionInspect({ root: repository, sessionId, maxLines: 40, maxBytes: 8_192 });
    for (let attempt = 0; attempt < 50 && !inspected.output.output.includes('COORDINATE_MINIMAL_EXTERNAL_ADAPTER:'); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50));
      inspected = await runtimeSessionInspect({ root: repository, sessionId, maxLines: 40, maxBytes: 8_192 });
    }
    assert.match(inspected.output.output, /COORDINATE_MINIMAL_EXTERNAL_ADAPTER:/, JSON.stringify(inspected));
    assert.match(inspected.output.output, /minimal external persistent prompt/);
    const read = await runtimeSessionRead({ root: repository, sessionId, maxLines: 40, maxBytes: 8_192 });
    assert.match(read.output, /COORDINATE_MINIMAL_EXTERNAL_ADAPTER:/, JSON.stringify(read));
    assert.match(read.output, /minimal external persistent prompt/);
    const closed = await runtimeSessionClose({ root: repository, sessionId, timeoutMs: 1_000 });
    assert.ok(['exited', 'failed'].includes(closed.session.state));
    sessionId = null;

    const removed = await runtimeAdapterRemove({ path: registeredPath });
    assert.equal(removed.ok, true, JSON.stringify(removed));
    registeredPath = null;
    assert.equal(listAdapters().includes('minimal-external-adapter'), false);
    console.log(JSON.stringify({
      ok: true,
      adapter: 'minimal-external-adapter',
      agent: 'minimal-example',
      persistentPrompt: true,
    }));
  } finally {
    if (sessionId) {
      try { await runtimeSessionClose({ root: repository, sessionId, graceful: false, timeoutMs: 500 }); } catch { /* Preserve the primary assertion. */ }
    }
    if (registeredPath) {
      try { await runtimeAdapterRemove({ path: registeredPath }); } catch { /* Preserve the primary assertion. */ }
    }
    for (const key of environmentKeys) {
      if (previousEnvironment[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnvironment[key];
    }
    await removeDirectoryWithRetry(repository);
  }
}

// This file is both a fixture (spawned by external-adapter-example.test.mjs with
// an isolated COORDINATE_AGENTS_HOME) and a file the Node test-runner discovers
// under test/. The registration flow must never run as a discovered test module:
// that would execute against the real user configuration. The parent therefore
// spawns it with an explicit execution marker; discovery (no marker) stays inert.
const isFixtureChild = process.env.COORDINATE_AGENTS_REGISTRATION_CHILD === '1';
if (isFixtureChild) {
  main().catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
