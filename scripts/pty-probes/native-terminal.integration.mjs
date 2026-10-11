import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ExecutionSessionManager, readRecord } from '../../skills/coordinate-agents/scripts/session-manager.mjs';

const fixture = fileURLToPath(new URL('./terminal-probe.cjs', import.meta.url));
const delay = ms => new Promise(done => setTimeout(done, ms));
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function until(check, label) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) { if (await check()) return; await delay(30); }
  assert.fail(`Timed out: ${label}`);
}
function environment() {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'coordinate-native-session-')));
  mkdirSync(join(root, '.agent-bus/tmp'), { recursive: true });
  const reportPath = join(root, 'report.json');
  const report = () => { try { return JSON.parse(readFileSync(reportPath, 'utf8')); } catch { return {}; } };
  const options = {
    root, agent: 'offline-terminal', reuseExisting: false,
    resolved: { command: process.execPath },
    adapter: {
      detect: () => ({ available: true, resolvedCommand: process.execPath }),
      resolveSessionLaunch: () => ({ command: process.execPath, args: [fixture, reportPath] }),
    },
  };
  return { root, report, options };
}

test('raw native binding and TTY probe succeeds in attached and detached launch modes', () => {
  for (const args of [[], ['--attached']]) {
    const run = spawnSync(process.execPath, ['scripts/diagnose-native-pty.mjs', ...args], { encoding: 'utf8', timeout: 25000 });
    assert.equal(run.status, 0, run.stdout || run.stderr);
    const result = JSON.parse(run.stdout);
    assert.equal(result.backend, 'node-pty'); assert.equal(result.cleanup, true);
    assert.equal(result.childAlive, false); assert.equal(result.workerExit.code, 0);
  }
});

test('native Session Host preserves backend, keyboard, resize, reconnect and final output', async t => {
  const oldMode = process.env.COORDINATE_AGENTS_PTY_MODE;
  process.env.COORDINATE_AGENTS_PTY_MODE = 'native';
  const { root, report, options } = environment();
  let manager = new ExecutionSessionManager(), session, owned;
  try {
    session = (await manager.open(options)).session;
    owned = readRecord(root, session.id);
    assert.equal(session.backend, 'node-pty');
    assert.equal(session.diagnostics.nativeStatus, 'running');
    assert.deepEqual(report().tty, [true, true, true]);
    assert.equal(report().cols, 120); assert.equal(report().rows, 30);
    const firstRead = await manager.read(root, session.id);
    t.diagnostic(JSON.stringify({ state: firstRead.session.state, backend: firstRead.session.backend, diagnostics: firstRead.session.diagnostics, exitCode: firstRead.session.exitCode, signal: firstRead.session.signal, error: firstRead.session.error }));
    let output = firstRead.output;
    assert.match(output, /终端测试/); assert.match(output, /\x1b\[/); assert.match(output, /PROBE_READY/);
    await manager.write(root, session.id, 'abc\x7fd\x1b[A\x1b[B\x1b[C\x1b[D\r', { submit: false });
    await until(() => report().lines?.some(line => line.text === 'abd'), 'keyboard');
    assert.deepEqual(report().keys, ['backspace', '\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D']);
    const paste = '中文 paste '.repeat(4096);
    await manager.write(root, session.id, paste + '\r', { submit: false });
    await until(() => report().lines?.some(line => line.sha256 === createHash('sha256').update(paste).digest('hex')), 'paste');
    const resized = await manager.resize(root, session.id, 103, 31);
    assert.equal(resized.cols, 103); assert.equal(resized.rows, 31);
    await until(() => report().cols === 103 && report().rows === 31, 'actual console resize');
    await manager.interrupt(root, session.id);
    await until(() => report().interrupts > 0, 'Ctrl+C');
    manager = new ExecutionSessionManager();
    const resumed = await manager.open({ ...options, sessionId: session.id, reuseExisting: true });
    assert.equal(resumed.reused, true); assert.equal(resumed.session.pid, owned.pid);
    assert.equal(resumed.session.backend, 'node-pty');
    assert.match((await manager.read(root, session.id)).output, /PROBE_READY/);
    await manager.write(root, session.id, '/exit');
    await until(async () => (await manager.status(root, session.id)).state === 'exited', 'normal exit');
    assert.match((await manager.read(root, session.id)).output, /FINAL_OUTPUT/);
    await until(() => !alive(owned.hostPid) && !alive(owned.pid), 'normal release');
    const restarted = (await manager.open({ ...options, reuseExisting: true })).session;
    assert.notEqual(restarted.id, session.id); session = restarted;
    assert.equal(session.backend, 'node-pty');
    owned = readRecord(root, session.id);
    await manager.write(root, session.id, '/crash');
    await until(async () => (await manager.status(root, session.id)).state === 'failed', 'abnormal exit');
    assert.equal((await manager.status(root, session.id)).exitCode, 9);
    await until(() => !alive(owned.hostPid) && !alive(owned.pid), 'abnormal release');
  } finally {
    if (session) await manager.close(root, session.id, { graceful: false, timeoutMs: 1000 });
    if (oldMode === undefined) delete process.env.COORDINATE_AGENTS_PTY_MODE; else process.env.COORDINATE_AGENTS_PTY_MODE = oldMode;
    rmSync(root, { recursive: true, force: true }); assert.equal(existsSync(root), false);
  }
});

test('native force close releases descendants and repository handles', async () => {
  const oldMode = process.env.COORDINATE_AGENTS_PTY_MODE;
  process.env.COORDINATE_AGENTS_PTY_MODE = 'native';
  const { root, report, options } = environment();
  const manager = new ExecutionSessionManager(); let session, owned, descendant;
  try {
    session = (await manager.open(options)).session;
    owned = readRecord(root, session.id);
    assert.equal(session.backend, 'node-pty');
    await manager.write(root, session.id, '/spawn');
    await until(() => report().descendantPid, 'descendant spawn'); descendant = report().descendantPid;
    assert.equal(alive(descendant), true);
    const closed = await manager.close(root, session.id, { graceful: false, timeoutMs: 1000 });
    assert.ok(['exited', 'failed'].includes(closed.state));
    await until(() => ![owned.hostPid, owned.pid, descendant].some(alive), 'process tree release');
  } finally {
    if (session) await manager.close(root, session.id, { graceful: false, timeoutMs: 1000 });
    if (descendant && alive(descendant)) process.kill(descendant, 'SIGKILL');
    if (oldMode === undefined) delete process.env.COORDINATE_AGENTS_PTY_MODE; else process.env.COORDINATE_AGENTS_PTY_MODE = oldMode;
    rmSync(root, { recursive: true, force: true }); assert.equal(existsSync(root), false);
  }
});

test('native host death cannot be reused and leaves no owned CLI', async () => {
  const oldMode = process.env.COORDINATE_AGENTS_PTY_MODE;
  process.env.COORDINATE_AGENTS_PTY_MODE = 'native';
  const { root, options } = environment(); const manager = new ExecutionSessionManager(); let session, owned;
  try {
    session = (await manager.open(options)).session; owned = readRecord(root, session.id);
    assert.equal(session.backend, 'node-pty');
    process.kill(owned.hostPid, 'SIGKILL');
    await until(() => !alive(owned.hostPid), 'host death');
    const status = await manager.status(root, session.id);
    assert.equal(status.state, 'failed');
    assert.equal(status.diagnostics.failure.stage, 'host');
    await until(() => !alive(owned.pid), 'CLI release after host death');
    const restarted = (await manager.open({ ...options, reuseExisting: true })).session;
    assert.notEqual(restarted.id, session.id); session = restarted;
  } finally {
    if (session) await manager.close(root, session.id, { graceful: false, timeoutMs: 1000 });
    if (oldMode === undefined) delete process.env.COORDINATE_AGENTS_PTY_MODE; else process.env.COORDINATE_AGENTS_PTY_MODE = oldMode;
    rmSync(root, { recursive: true, force: true });
  }
});

test('unready detached host fails within the startup deadline and is reaped', async t => {
  const oldMode = process.env.COORDINATE_AGENTS_PTY_MODE;
  process.env.COORDINATE_AGENTS_PTY_MODE = 'native';
  const { root, options } = environment();
  const manager = new ExecutionSessionManager({ hostPath: fileURLToPath(new URL('./unready-session-host.mjs', import.meta.url)) });
  let session;
  try {
    session = (await manager.open(options)).session;
    const owned = readRecord(root, session.id);
    t.diagnostic(JSON.stringify({ state: session.state, diagnostics: session.diagnostics }));
    assert.equal(session.state, 'failed');
    assert.equal(session.diagnostics.failure.code, 'HOST_START_TIMEOUT');
    assert.equal(session.diagnostics.platform, process.platform);
    assert.equal(session.diagnostics.nodeVersion, process.versions.node);
    assert.equal(alive(owned.hostPid), false);
  } finally {
    if (session) await manager.close(root, session.id, { graceful: false, timeoutMs: 1000 });
    if (oldMode === undefined) delete process.env.COORDINATE_AGENTS_PTY_MODE; else process.env.COORDINATE_AGENTS_PTY_MODE = oldMode;
    rmSync(root, { recursive: true, force: true });
  }
});

test('uncaught Session Host errors are durable, sanitized and release the owned CLI', async () => {
  const oldMode = process.env.COORDINATE_AGENTS_PTY_MODE;
  process.env.COORDINATE_AGENTS_PTY_MODE = 'native';
  const { root, options, report } = environment();
  const manager = new ExecutionSessionManager({ hostPath: fileURLToPath(new URL('./crashing-session-host.mjs', import.meta.url)) });
  let session, owned;
  try {
    session = (await manager.open(options)).session; owned = readRecord(root, session.id);
    assert.equal(session.backend, 'node-pty');
    await until(async () => (await manager.status(root, session.id)).state === 'failed', 'uncaught Host error');
    const status = await manager.status(root, session.id);
    assert.equal(status.diagnostics.failure.code, 'HOST_UNCAUGHT_ERROR');
    assert.equal(status.diagnostics.nativeStatus, 'failed');
    assert.equal(status.diagnostics.failure.systemCode, 'UNKNOWN_SYSTEM_ERROR');
    assert.equal(JSON.stringify(status).includes('private-secret-value'), false);
    assert.equal(JSON.stringify(status).includes('PRIVATE_SECRET_VALUE'), false);
    const cliPid = owned.pid || report().pid;
    assert.ok(Number.isInteger(cliPid));
    await until(() => !alive(owned.hostPid) && !alive(cliPid), 'uncaught Host release');
  } finally {
    if (session) await manager.close(root, session.id, { graceful: false, timeoutMs: 1000 });
    if (oldMode === undefined) delete process.env.COORDINATE_AGENTS_PTY_MODE; else process.env.COORDINATE_AGENTS_PTY_MODE = oldMode;
    rmSync(root, { recursive: true, force: true });
  }
});
