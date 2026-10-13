import assert from 'node:assert/strict';
import test from 'node:test';
import { runNativeProbe } from './support/native-pty-probe.mjs';

const windows = process.platform === 'win32' && Number(process.versions.node.split('.')[0]) >= 20;
function assertProbe(result, backend) {
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.timedOut, false, JSON.stringify(result));
  assert.equal(result.leaked, false, JSON.stringify(result));
  assert.equal(result.directoryRemoved, true, JSON.stringify(result));
  assert.equal(result.report?.ok, true, JSON.stringify(result));
  assert.equal(result.report.backend, backend);
  assert.equal(result.stderr, '', JSON.stringify(result));
}

test('Windows native binding and detached ConPTY support real interactive I/O and child-observed resize', { skip: !windows, timeout: 35000 }, async () => {
  const result = await runNativeProbe();
  assertProbe(result, 'node-pty');
  for (const check of ['binding', 'conpty', 'tty', 'input', 'ansi', 'resize', 'ctrlC', 'finalOutput', 'cleanup']) assert.equal(result.report.checks[check], true, check);
});

test('Windows verified PtyRuntime selects native rather than passing through fallback', { skip: !windows, timeout: 35000 }, async () => {
  const result = await runNativeProbe({ mode: 'runtime' });
  assertProbe(result, 'node-pty');
  assert.equal(result.report.checks.boundedOutput, true);
});

test('Windows explicitly selected stdio fallback remains non-TTY and interactive', { skip: !windows, timeout: 35000 }, async () => {
  const result = await runNativeProbe({ mode: 'fallback' });
  assertProbe(result, 'stdio-fallback');
  assert.equal(result.report.tty.stdinTTY, false);
  assert.equal(result.report.checks.resize, undefined);
});

test('Windows Session Host persists native backend and owns independent exe/cmd lifecycles', { skip: !windows, timeout: 55000 }, async () => {
  assertProbe(await runNativeProbe({ mode: 'session', timeoutMs: 45000 }), 'node-pty');
});

test('Windows native preflight abort falls back safely without retrying user tasks', { skip: !windows, timeout: 55000 }, async () => {
  assertProbe(await runNativeProbe({ mode: 'abort-fallback', timeoutMs: 45000 }), 'stdio-fallback');
});

test('Windows native preflight timeout is bounded and cleans its own Host before fallback', { skip: !windows, timeout: 55000 }, async () => {
  assertProbe(await runNativeProbe({ mode: 'timeout-fallback', timeoutMs: 45000 }), 'stdio-fallback');
});

test('Windows system PowerShell observes native console resize and Ctrl+C', { skip: !windows, timeout: 35000 }, async () => {
  assertProbe(await runNativeProbe({ mode: 'powershell' }), 'node-pty');
});
