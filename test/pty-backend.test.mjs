import assert from 'node:assert/strict';
import test from 'node:test';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PtyRuntime } from '../skills/coordinate-agents/scripts/pty-runtime.mjs';

const options = { id: 'backend-test', command: process.execPath, cwd: process.cwd() };
test('strict native request never silently launches pipes on spawn failure', async () => {
  const runtime = new PtyRuntime({ ...options, command: 42, backendMode: 'native' });
  try {
    assert.throws(() => runtime.open(), /Native PTY/);
    assert.equal(runtime.status().state, 'failed');
    assert.equal(runtime.child, null);
    assert.equal(runtime.status().diagnostics.failure.stage, Number(process.versions.node.split('.')[0]) < 20 ? 'load' : 'spawn');
  } finally { await runtime.close({ graceful: false, timeoutMs: 100 }); }
});
test('explicit stdio mode records the actual backend and diagnostic environment', async () => {
  const runtime = new PtyRuntime({ ...options, args: ['-e', 'setInterval(()=>{},1000)'], backendMode: 'stdio' });
  try {
    const snapshot = runtime.open();
    assert.equal(snapshot.backend, 'stdio-fallback');
    assert.equal(snapshot.diagnostics.platform, process.platform);
    assert.equal(snapshot.diagnostics.nodeVersion, process.versions.node);
    assert.equal(snapshot.diagnostics.nativeStatus, 'disabled');
  } finally { await runtime.close({ graceful: false, timeoutMs: 100 }); }
});
test('backend mode rejects typos instead of accidentally enabling an experiment', () => {
  assert.throws(() => new PtyRuntime({ ...options, backendMode: 'nativ' }), /PTY mode/);
});
test('a dependency-free checkout exposes load failure in auto and fails closed in native mode', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'coordinate-pty-no-binding-'));
  try {
    const modulePath = join(directory, 'pty-runtime.mjs');
    copyFileSync(new URL('../skills/coordinate-agents/scripts/pty-runtime.mjs', import.meta.url), modulePath);
    const { PtyRuntime: IndependentRuntime } = await import(pathToFileURL(modulePath).href);
    const runtime = new IndependentRuntime({ ...options, backendMode: 'auto', args: ['-e', "console.log('offline fallback')"] });
    runtime.open(); await runtime.exitPromise;
    assert.equal(runtime.status().backend, 'stdio-fallback');
    assert.match(runtime.read().output, /offline fallback/);
    assert.equal(runtime.status().diagnostics.failure.code, Number(process.versions.node.split('.')[0]) < 20 ? 'NODE_VERSION_POLICY' : 'NATIVE_LOAD_FAILED');
    const strict = new IndependentRuntime({ ...options, backendMode: 'native' });
    assert.throws(() => strict.open(), /Native PTY unavailable/);
    assert.equal(strict.child, null);
    assert.equal(strict.status().diagnostics.failure.stage, 'load');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('pipe output decodes UTF-8 spanning OS read chunks', async () => {
  const runtime = new PtyRuntime({ ...options, backendMode: 'stdio', args: ['-e',
    "const b=Buffer.from('中文');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),50)",
  ] });
  runtime.open(); await runtime.exitPromise;
  assert.equal(runtime.read().output, '中文');
});
test('bounded terminal tails preserve UTF-8 and report lost bytes', async () => {
  const runtime = new PtyRuntime({ ...options, backendMode: 'stdio', args: ['-e', "process.stdout.write('中文'.repeat(500))"], maxOutputBytes: 1024 });
  runtime.open(); await runtime.exitPromise;
  const result = runtime.read({ maxBytes: 100 });
  assert.equal(result.output.includes('\ufffd'), false);
  assert.ok(Buffer.byteLength(result.output) <= 100);
  assert.equal(result.truncated, true);
});
test('native stream failure is recorded at the owned Host boundary without secret error identifiers', { timeout: 15000 }, async () => {
  if (Number(process.versions.node.split('.')[0]) < 20) {
    const runtime = new PtyRuntime({ ...options, backendMode: 'native' });
    assert.throws(() => runtime.open(), /Native PTY unavailable/); assert.equal(runtime.child, null); return;
  }
  for (const code of ['EPIPE', 'PRIVATE_SECRET_VALUE']) {
    const host = fork(fileURLToPath(new URL('../scripts/pty-probes/runtime-error-host.mjs', import.meta.url)), [code], {
      execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true,
    });
    let result, ownedPid;
    host.on('message', message => { if (message.type === 'started') ownedPid = message.pid; if (message.type === 'result') result = message.snapshot; });
    const timer = setTimeout(() => {
      if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(host.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else { if (ownedPid) { try { process.kill(ownedPid, 'SIGKILL'); } catch {} } host.kill('SIGKILL'); }
    }, 7000);
    try {
      const [exitCode] = await once(host, 'exit');
      assert.equal(exitCode, 0); assert.ok(result);
      assert.equal(result.backend, 'node-pty'); assert.equal(result.state, 'failed');
      assert.equal(result.diagnostics.failure.code, 'NATIVE_STREAM_ERROR');
      assert.equal(result.diagnostics.failure.systemCode, code === 'EPIPE' ? 'EPIPE' : 'UNKNOWN_SYSTEM_ERROR');
      assert.equal(JSON.stringify(result).includes('private-secret-value'), false);
      assert.equal(JSON.stringify(result).includes('PRIVATE_SECRET_VALUE'), false);
      assert.throws(() => process.kill(ownedPid, 0), { code: 'ESRCH' });
    } finally { clearTimeout(timer); if (host.exitCode === null) host.kill('SIGKILL'); }
  }
});
