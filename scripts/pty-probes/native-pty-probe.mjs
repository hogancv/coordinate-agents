import assert from 'node:assert/strict';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { release } from 'node:os';

const require = createRequire(import.meta.url);
const reportPath = process.argv[2];
let stage = 'load', pty;
const progress = (next, extra = {}) => { stage = next; process.send?.({ stage, ...extra }); };
const delay = ms => new Promise(done => setTimeout(done, ms));
async function until(check, label) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (check()) return; await delay(25); }
  throw new Error(label);
}
const report = () => { try { return JSON.parse(readFileSync(reportPath, 'utf8')); } catch { return {}; } };
try {
  const nodePty = require('node-pty');
  const lib = dirname(require.resolve('node-pty'));
  // Windows require('node-pty') alone doesn't load conpty.node.
  require(join(lib, 'utils.js')).loadNativeModule(process.platform === 'win32' ? 'conpty' : 'pty');
  if (process.platform !== 'win32') {
    for (const candidate of [join(lib, '../build/Release/spawn-helper'), join(lib, `../prebuilds/${process.platform}-${process.arch}/spawn-helper`)]) {
      if (existsSync(candidate)) chmodSync(candidate, 0o755);
    }
  }
  progress('initialization', { bindingLoaded: true });
  if (process.platform === 'win32') assert.ok(Number(release().split('.')[2]) >= 18309, 'ConPTY-capable Windows build required');
  pty = nodePty.spawn(process.execPath, [fileURLToPath(new URL('./terminal-probe.cjs', import.meta.url)), reportPath], {
    cwd: dirname(reportPath), env: { ...process.env, TERM: 'xterm-256color' }, cols: 91, rows: 27, useConpty: true,
  });
  progress('spawn', { pid: pty.pid, backend: 'node-pty' });
  let output = '', exit;
  pty.onData(data => { output += data; });
  pty.onExit(event => { exit = event; });
  pty.on('error', error => {
    // POSIX PTY read ends normally with EIO when the slave closes. node-pty's
    // own handler explicitly ignores it; it is not a failed child exit.
    if (['EIO', 'EAGAIN'].includes(error?.code) || `${error?.code}`.includes('errno 5')) return;
    progress('runtime', { errorCode: ['EPIPE', 'EBADF', 'ECONNRESET', 'ENOENT', 'EINVAL'].includes(error?.code) ? error.code : 'UNKNOWN_STREAM_ERROR' });
    process.exitCode = 1;
  });
  await until(() => report().tty?.every(Boolean), 'TTY_NOT_READY');
  assert.deepEqual(report().tty, [true, true, true]);
  assert.equal(report().cols, 91); assert.equal(report().rows, 27);
  progress('runtime');
  await until(() => output.includes('PROBE_READY') && output.includes('终端测试'), 'OUTPUT_NOT_READY');
  assert.match(output, /\x1b\[/);
  pty.write('abc\x7fd\x1b[A\x1b[B\x1b[C\x1b[D\r');
  await until(() => report().lines?.some(line => line.text === 'abd'), 'KEY_INPUT_FAILED');
  assert.deepEqual(report().keys, ['backspace', '\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D']);
  const paste = '中文 paste '.repeat(4096);
  pty.write(paste + '\r');
  await until(() => report().lines?.some(line => line.sha256 === createHash('sha256').update(paste).digest('hex')), 'PASTE_FAILED');
  pty.resize(103, 31);
  await until(() => report().cols === 103 && report().rows === 31, 'RESIZE_FAILED');
  pty.write('\x03');
  await until(() => report().interrupts > 0, 'INTERRUPT_FAILED');
  progress('cleanup');
  pty.write('/exit\r');
  await until(() => exit !== undefined, 'EXIT_NOT_RECEIVED');
  assert.equal(exit.exitCode, 0);
  assert.ok(output.includes('FINAL_OUTPUT'), 'final output drained');
  progress('complete', { tty: true, input: true, ansi: true, utf8: true, resize: true, exit: true });
  process.disconnect?.();
  // Natural worker exit is required: no process.exit masking native handle leaks.
} catch {
  process.send?.({ stage, failure: 'NATIVE_PROBE_FAILED' });
  try { pty?.kill(); } catch { /* Supervisor owns timeout cleanup. */ }
  process.exitCode = 1;
  process.disconnect?.();
}
