import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWorkspaceHealth, terminalHealth } from '../inspector/server/workspace-health.mjs';
import { createWorkspaceData } from '../inspector/server/workspace-data.mjs';
import { startWorkspace } from './support/workspace-server.mjs';
import { writeUserConfig } from '../skills/coordinate-agents/scripts/user-config.mjs';
import { readConfig, writeConfig } from '../skills/coordinate-agents/scripts/config.mjs';

function fixture(t, source = 'console.log("fixture-cli 1.2.3");') {
  const root = mkdtempSync(join(tmpdir(), 'workspace-health with spaces-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const command = join(root, 'cli.cjs');
  writeFileSync(command, `if (process.argv.slice(2).join(' ') !== '--version') process.exit(9);\n${source}`);
  return { root, command, settings: { codex: { command, adapter: 'codex-cli' }, antigravity: { command, adapter: 'antigravity-cli' } } };
}

test('health probes only versions, leaves authentication unknown, and creates no bus', async t => {
  const { root, settings } = fixture(t);
  const result = await readWorkspaceHealth({ root, settings });
  assert.equal(result.ok, true);
  assert.equal(result.ready, true);
  assert.equal(result.checks.node.version, process.version);
  assert.equal(result.checks.git.status, 'ok');
  for (const id of ['codex', 'antigravity']) {
    assert.equal(result.checks[id].status, 'ok');
    assert.equal(result.checks[id].version, '1.2.3');
    assert.equal(result.checks[id].authenticated, 'unknown');
    assert.equal(result.checks[id].command, settings[id].command);
  }
  assert.equal(result.checks.terminal.status, 'pending');
  assert.equal(existsSync(join(root, '.agent-bus')), false);
});

test('missing custom command is preserved and does not prevent other checks', async t => {
  const { root, settings } = fixture(t);
  settings.antigravity.command = join(root, 'missing-agy-proxy');
  const result = await readWorkspaceHealth({ root, settings });
  assert.equal(result.ready, false);
  assert.equal(result.checks.codex.status, 'ok');
  assert.equal(result.checks.antigravity.status, 'missing');
  assert.equal(result.checks.antigravity.reason, 'COMMAND_NOT_FOUND');
  assert.equal(result.checks.antigravity.command, settings.antigravity.command);
});

test('version timeout is bounded and unavailable version does not invent success or expose output', async t => {
  const { root, settings } = fixture(t, 'setInterval(() => {}, 1000);');
  const started = Date.now();
  const result = await readWorkspaceHealth({ root, settings, timeout: 150 });
  assert.ok(Date.now() - started < 3000);
  assert.equal(result.checks.codex.status, 'pending');
  assert.equal(result.checks.codex.reason, 'VERSION_CHECK_TIMEOUT');
  writeFileSync(settings.codex.command, 'console.error("token=PRIVATE cookie=PRIVATE"); process.exit(2);');
  const failed = await readWorkspaceHealth({ root, settings, timeout: 1000 });
  assert.equal(failed.checks.codex.status, 'warning');
  assert.equal(failed.checks.codex.version, null);
  assert.doesNotMatch(JSON.stringify(failed), /PRIVATE|stdout|stderr|env/);
});

test('terminal uses existing session backends and Node 18 pending is compatible', () => {
  assert.deepEqual(terminalHealth([], 'v22.1.0'), { status: 'pending', backend: null });
  assert.equal(terminalHealth([], 'v18.20.8').reason, 'NODE18_STDIO_COMPATIBILITY');
  assert.deepEqual(terminalHealth([{ backend: 'node-pty' }]), { status: 'ok', backend: 'node-pty' });
  assert.deepEqual(terminalHealth([{ backend: 'node-pty' }, { backend: 'stdio-fallback' }]), {
    status: 'warning', backend: 'stdio-fallback', reason: 'STDIO_FALLBACK',
  });
});

test('HTTP health is project scoped, responds during a slow probe, and uses saved settings', async t => {
  const { root, command } = fixture(t);
  const started = await startWorkspace({ root, port: 0 });
  t.after(() => new Promise(done => { started.server.close(done); started.server.closeAllConnections?.(); }));
  const base = `http://127.0.0.1:${started.port}`;
  const headers = { 'x-coordinate-agents-capability': started.capability, 'content-type': 'application/json' };
  const projects = await (await fetch(`${base}/api/projects`, { headers })).json();
  const scoped = `${base}/api/projects/${projects.defaultProjectId}`;
  const save = await fetch(`${scoped}/api/action`, { method: 'POST', headers,
    body: JSON.stringify({ action: 'workspaceSettingsSave', params: { codex: command, antigravity: command, args: [] } }) });
  assert.equal(save.status, 200, await save.text());
  const healthy = await (await fetch(`${scoped}/api/workspace-health`, { headers })).json();
  assert.equal(healthy.checks.codex.command, command);
  assert.equal(healthy.checks.codex.status, 'ok');
  assert.equal((await createWorkspaceData(root).readWorkspaceHealth()).checks.antigravity.command, command);
  writeFileSync(command, 'setInterval(() => {}, 1000);');
  const pending = fetch(`${scoped}/api/workspace-health`, { headers });
  const before = Date.now();
  assert.equal((await fetch(`${scoped}/api/workspace-tasks`, { headers })).status, 200);
  assert.ok(Date.now() - before < 1000, 'health must not block the HTTP event loop');
  assert.equal((await (await pending).json()).checks.codex.status, 'pending');
});

test('health uses user command defaults, project overrides and the unredacted executable for detection', async t => {
  const { root, command } = fixture(t);
  const previousHome = process.env.COORDINATE_AGENTS_HOME;
  process.env.COORDINATE_AGENTS_HOME = root;
  t.after(() => { if (previousHome === undefined) delete process.env.COORDINATE_AGENTS_HOME; else process.env.COORDINATE_AGENTS_HOME = previousHome; });
  writeUserConfig({ version: 1, agents: { codex: { command }, antigravity: { command } } }, { home: root });
  const started = await startWorkspace({ root, port: 0 });
  t.after(() => new Promise(done => { started.server.close(done); started.server.closeAllConnections?.(); }));
  let result = await createWorkspaceData(root).readWorkspaceHealth();
  assert.equal(result.checks.codex.command, command);
  const override = join(root, 'token=private-wrapper.cjs');
  writeFileSync(override, 'console.log("wrapper 2.3.4");');
  const config = readConfig(join(root, '.agent-bus'));
  config.agents.find(agent => agent.id === 'codex').command = override;
  writeConfig(join(root, '.agent-bus'), config);
  result = await createWorkspaceData(root).readWorkspaceHealth();
  assert.equal(result.checks.codex.status, 'ok');
  assert.equal(result.checks.codex.version, '2.3.4');
  assert.doesNotMatch(result.checks.codex.command, /private-wrapper/);
  assert.equal(result.checks.antigravity.command, command);
});
