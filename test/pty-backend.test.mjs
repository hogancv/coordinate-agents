import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
test('native stream failure is recorded without crashing the Runtime observer', { timeout: 12000 }, async () => {
  const runtime = new PtyRuntime({ ...options, backendMode: 'native', args: ['-e', "console.log('READY');setInterval(()=>{},1000)"] });
  if (Number(process.versions.node.split('.')[0]) < 20) {
    assert.throws(() => runtime.open(), /Native PTY unavailable/);
    assert.equal(runtime.child, null); return;
  }
  try {
    runtime.open();
    const deadline = Date.now() + 5000;
    while (!runtime.read().output.includes('READY') && Date.now() < deadline) await new Promise(done => setTimeout(done, 25));
    assert.match(runtime.read().output, /READY/);
    runtime.pty.emit('error', Object.assign(new Error('private-secret-value'), { code: 'EPIPE' }));
    let timer;
    try {
      await Promise.race([runtime.exitPromise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native exit timeout')), 3000); })]);
    } finally { clearTimeout(timer); }
    assert.equal(runtime.status().state, 'failed');
    assert.equal(runtime.status().diagnostics.failure.code, 'NATIVE_STREAM_ERROR');
    assert.equal(JSON.stringify(runtime.status()).includes('private-secret-value'), false);
  } finally { await runtime.close({ graceful: false, timeoutMs: 1000 }); }
});
