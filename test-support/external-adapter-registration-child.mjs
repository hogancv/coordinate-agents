import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runtimeAdapterRegister,
  runtimeAdapterRemove,
  runtimeSetupConfigure,
} from '../bin/coordinate-agents.mjs';
import {
  runtimeSessionClose,
  runtimeSessionInspect,
  runtimeSessionOpen,
  runtimeSessionWrite,
} from '../skills/coordinate-agents/scripts/session-service.mjs';
import { resolveConfiguredSessionAgent } from '../skills/coordinate-agents/scripts/session-manager.mjs';
import { listAdapters } from '../skills/coordinate-agents/adapters/index.mjs';

const rootDirectory = process.cwd();
const busTool = join(rootDirectory, 'skills', 'coordinate-agents', 'scripts', 'agent-bus.mjs');
const exampleRoot = join(rootDirectory, 'examples', 'minimal-external-adapter');
const modulePath = join(exampleRoot, 'adapter.mjs');
const executable = join(exampleRoot, 'fake-agent.mjs');

async function main() {
  const repository = mkdtempSync(join(tmpdir(), 'coordinate-agents-example-repository-'));
  let registeredPath = null;
  let sessionId = null;
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

    const opened = await runtimeSessionOpen({
      root: repository,
      agent: 'minimal-example',
    });
    assert.equal(opened.ok, true, JSON.stringify(opened));
    sessionId = opened.session.id;
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
    rmSync(repository, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
