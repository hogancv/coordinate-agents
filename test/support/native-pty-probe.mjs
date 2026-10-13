// A supervisor keeps native crashes and timeouts outside the test runner/Web host.
import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactOutput } from '../../skills/coordinate-agents/adapters/executable.mjs';

const self = fileURLToPath(import.meta.url);
const fixture = fileURLToPath(new URL('./native-pty-fixture.mjs', import.meta.url));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
export function killOwned(pid) {
  if (!alive(pid)) return;
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
  else { try { process.kill(pid, 'SIGKILL'); } catch {} }
}
export async function until(predicate, description, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const result = predicate(); if (result) return result; await delay(25); }
  throw new Error(`Timed out: ${description}`);
}

export async function runNativeProbe({ node = process.execPath, mode = 'native', timeoutMs = 25000, detached = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'coordinate-conpty-中文 空格-'));
  const factsPath = join(directory, 'facts.jsonl');
  let stdout = '', stderr = '', report = null, ownedPid = null, timedOut = false;
  const child = fork(self, ['--worker', mode, factsPath], { execPath: node, execArgv: [], cwd: directory, detached, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.on('data', data => { stdout = (stdout + data).slice(-65536); });
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-65536); });
  child.on('message', message => {
    if (message.type === 'owned') ownedPid = message.pid;
    if (message.type === 'report') report = message.report;
  });
  const result = await new Promise(resolve => {
    const timer = setTimeout(() => { timedOut = true; killOwned(child.pid); }, timeoutMs);
    child.once('error', error => { stderr += String(error); });
    child.once('close', (exitCode, signal) => { clearTimeout(timer); resolve({ exitCode, signal }); });
  });
  // Never turn a cleanup intervention into a passing native result.
  const leaked = alive(ownedPid);
  if (leaked) killOwned(ownedPid);
  await until(() => !alive(ownedPid) && !alive(child.pid), 'owned probe processes exit');
  let directoryRemoved = false;
  try { rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); directoryRemoved = !existsSync(directory); }
  catch (error) { stderr += `\ncleanup: ${error.code}`; }
  return { mode, detached, ...result, timedOut, leaked, directoryRemoved, report, stdout: redactOutput(stdout, 65536), stderr: redactOutput(stderr, 65536) };
}

async function worker(mode, factsPath) {
  if (mode === 'session' || mode === 'abort-fallback' || mode === 'timeout-fallback') {
    try {
      const { runSessionChecks } = await import('./native-session-probe.mjs');
      const result = await runSessionChecks(process.cwd(), { failedProbe: mode !== 'session', hangProbe: mode === 'timeout-fallback' });
      process.send?.({ type: 'report', report: { ok: true, node: process.version, ...result } }, () => process.exit(0));
    } catch (error) {
      process.send?.({ type: 'report', report: { ok: false, error: redactOutput(error.stack || String(error), 4096) } }, () => process.exit(1));
    }
    return;
  }
  const require = createRequire(import.meta.url);
  const report = { node: process.version, abi: process.versions.modules, platform: process.platform, arch: process.arch, os: release(), backend: 'node-pty', checks: {} };
  let terminal, runtime;
  let output = '', exited = null;
  try {
    const pty = require('node-pty');
    report.checks.module = true;
    if (process.platform === 'win32') {
      const native = require('node-pty/lib/utils.js').loadNativeModule('conpty');
      report.binding = native.dir;
      report.checks.binding = typeof native.module.startProcess === 'function';
    }
    const options = { cols: 100, rows: 30, cwd: process.cwd(), env: { ...process.env, TERM: 'xterm-256color' }, useConpty: true };
    if (mode === 'powershell') {
      const command = join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const shellHome = join(process.cwd(), 'shell-home'); mkdirSync(shellHome);
      terminal = pty.spawn(command, ['-NoLogo', '-NoProfile', '-NoExit', '-Command', "function global:prompt { 'PROBE> ' }"], {
        ...options, env: { ...options.env, APPDATA: shellHome, USERPROFILE: shellHome, HOME: shellHome },
      });
      const pid = terminal.pid;
      process.send?.({ type: 'owned', pid });
      terminal.onData(data => { output = (output + data).slice(-65536); });
      terminal.onExit(event => { exited = event; });
      await until(() => output.includes('PROBE>'), 'PowerShell prompt', 10000);
      terminal.write("Write-Output ('PS-'+'中文')\r");
      await until(() => output.includes('PS-中文'), 'PowerShell Unicode');
      terminal.resize(73, 19);
      terminal.write("Write-Output ('SIZE'+':'+[Console]::WindowWidth+','+[Console]::WindowHeight)\r");
      await until(() => output.includes('SIZE:73,19'), 'PowerShell console size');
      terminal.write('Start-Sleep -Seconds 20\r'); await delay(200);
      const beforeInterrupt = output.length;
      terminal.write('\x03');
      await until(() => output.slice(beforeInterrupt).includes('PROBE>'), 'PowerShell returned from interrupted sleep');
      terminal.write("Write-Output ('PS-'+'AFTER-'+'CTRL-C')\r");
      await until(() => output.includes('PS-AFTER-CTRL-C'), 'PowerShell Ctrl+C interrupted sleep');
      terminal.write("Write-Output ('PS-'+'FINAL-'+'中文'); exit 0\r");
      await until(() => exited, 'PowerShell exit', 10000);
      assert.equal(exited.exitCode, 0); assert.match(output, /PS-FINAL-中文/);
      assert.equal(output.includes('Oops, something went wrong'), false, 'PowerShell line editor error');
      await until(() => !alive(pid), 'PowerShell cleanup');
      report.checks = { ...report.checks, unicode: true, resize: true, ctrlC: true, finalOutput: true, cleanup: true };
      report.ok = true;
      process.send?.({ type: 'report', report }, () => process.exit(0));
      return;
    }
    if (mode === 'runtime' || mode === 'fallback') {
      const { PtyRuntime } = await import('../../skills/coordinate-agents/scripts/pty-runtime.mjs');
      runtime = new PtyRuntime({ id: 'native-probe', command: process.execPath, args: [fixture, factsPath, 'probe', '--native-pty-fixture'], ...options, maxOutputBytes: 4096, nativePtyVerified: mode !== 'fallback', onOutput: data => { output = (output + data).slice(-131072); } });
      runtime.open(); terminal = runtime.pty;
      report.backend = runtime.backend;
      runtime.exitPromise.then(snapshot => { exited = snapshot; });
    } else {
      terminal = pty.spawn(process.execPath, [fixture, factsPath, 'probe', '--native-pty-fixture'], options);
      terminal.onData(data => { output = (output + data).slice(-131072); });
      terminal.onExit(event => { exited = event; });
    }
    const ownedPid = runtime?.pid || terminal.pid;
    process.send?.({ type: 'owned', pid: ownedPid });
    report.pid = ownedPid;
    if (mode === 'early-exit') { await delay(100); process.exit(0); }
    const facts = () => existsSync(factsPath) ? readFileSync(factsPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
    const has = (type, predicate = () => true) => facts().find(value => value.type === type && predicate(value));
    const send = input => runtime ? runtime.write(input, { submit: false }) : terminal.write(input);
    const ready = await until(() => has('ready'), 'CLI ready');
    report.tty = ready;
    if (mode !== 'fallback') { assert.equal(report.backend, 'node-pty'); assert.equal(ready.stdinTTY, true); assert.equal(ready.stdoutTTY, true); }
    else { assert.equal(report.backend, 'stdio-fallback'); assert.equal(ready.stdinTTY, false); }
    report.checks.tty = true;
    if (process.platform === 'win32' && terminal) { assert.equal(terminal._agent._useConpty, true); report.checks.conpty = true; }
    send('hello中文\r');
    await until(() => has('line', f => f.value === 'hello中文'), 'Unicode input');
    send('abc\x7f\r');
    await until(() => has('line', f => f.value === 'ab'), 'Backspace');
    send('\x1b[A\x1b[B\x1b[C\x1b[D');
    await until(() => ['up', 'down', 'left', 'right'].every(name => has('key', f => f.name === name)), 'direction keys');
    send('paste一\rpaste二\r');
    await until(() => has('line', f => f.value === 'paste一') && has('line', f => f.value === 'paste二'), 'multiline paste');
    report.checks.input = true;
    if (runtime) {
      runtime.write('submit一\nsubmit二\n', { submit: true });
      await until(() => has('line', f => f.value === 'submit一') && has('line', f => f.value === 'submit二'), 'logical multiline submit');
      report.checks.logicalSubmit = true;
    }
    send(':ansi\r');
    await until(() => output.includes('REPAINT') && output.includes('中文'), 'ANSI output');
    assert.match(output, /\x1b\[/); report.checks.ansi = true;
    if (terminal) {
      if (runtime) runtime.resize(73, 19); else terminal.resize(73, 19);
      send(':size\r');
      await until(() => has('size', f => f.cols === 73 && f.rows === 19), 'child-observed resize');
      report.checks.resize = true;
    }
    send('\x03'); await until(() => has('ctrl-c'), 'Ctrl+C'); report.checks.ctrlC = true;
    send(':long\r'); await until(() => has('long-done'), 'long output');
    await until(() => output.includes('long-done'), 'long output drained');
    if (runtime) assert.ok(runtime.read().bufferedBytes <= 4096);
    report.checks.boundedOutput = Boolean(runtime);
    send(':exit\r'); await until(() => exited, 'PTY exit', 8000);
    assert.equal(exited.exitCode, 0); assert.match(output, /FINAL-OUTPUT-中文/);
    report.checks.finalOutput = true;
    await until(() => !alive(ownedPid), 'CLI exit');
    report.checks.cleanup = true;
    report.exit = exited;
    report.ok = true;
    if (mode !== 'drain') {
      // The owned host exits after the native exit callback/output flush.
      // node-pty 1.1.0's conout worker alone does not drain naturally.
      process.send?.({ type: 'report', report }, () => process.exit(0));
    } else process.send?.({ type: 'report', report });
  } catch (error) {
    report.ok = false; report.error = redactOutput(error.stack || String(error), 4096);
    report.output = redactOutput(output, 4096);
    report.facts = existsSync(factsPath) ? readFileSync(factsPath, 'utf8').slice(-4096) : '';
    process.send?.({ type: 'report', report });
    if (runtime) { try { await runtime.close({ graceful: false, timeoutMs: 500 }); } catch {} }
    else if (terminal) { try { terminal.kill(); } catch {} }
    process.exitCode = 1;
  }
  // Natural event-loop drain tests native handle release; supervisor owns timeout.
  process.disconnect?.();
}

if (process.argv[2] === '--worker') await worker(process.argv[3], process.argv[4]);
else if (process.argv[1] === self && process.argv[2]) {
  const result = await runNativeProbe({ mode: process.argv[2] || 'native', timeoutMs: 45000 });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.exitCode === 0 && result.report?.ok && !result.timedOut && !result.leaked && result.directoryRemoved ? 0 : 1;
}
