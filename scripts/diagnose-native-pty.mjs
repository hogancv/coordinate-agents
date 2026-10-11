#!/usr/bin/env node
// Isolated raw node-pty reproduction. No Runtime selection or provider CLI.
import { fork, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const launch = process.argv.includes('--attached') ? 'attached' : 'detached';
const directory = mkdtempSync(join(tmpdir(), 'coordinate-native-probe-'));
const stages = [];
let ownedPid, timedOut = false;
const worker = fork(fileURLToPath(new URL('./pty-probes/native-pty-probe.mjs', import.meta.url)), [join(directory, 'report.json')], {
  cwd: directory, detached: launch === 'detached', execArgv: [],
  stdio: launch === 'detached' ? ['ignore', 'ignore', 'ignore', 'ipc'] : ['ignore', 'pipe', 'pipe', 'ipc'],
  windowsHide: true,
});
worker.stdout?.resume(); worker.stderr?.resume();
worker.on('message', message => { stages.push(message); if (message.pid) ownedPid = message.pid; });
const timer = setTimeout(() => {
  timedOut = true;
  if (process.platform === 'win32') spawnSync('taskkill.exe', ['/PID', String(worker.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else {
    if (ownedPid) { try { process.kill(ownedPid, 'SIGKILL'); } catch {} }
    worker.kill('SIGKILL');
  }
}, 20_000);
const result = await new Promise(done => {
  worker.once('error', () => done({ code: null, signal: null, spawnError: true }));
  worker.once('close', (code, signal) => done({ code, signal }));
});
clearTimeout(timer);
let childAlive = false;
if (ownedPid) { try { process.kill(ownedPid, 0); childAlive = true; } catch {} }
const complete = stages.some(item => item.stage === 'complete');
let cleanup = false;
try { rmSync(directory, { recursive: true, force: true }); cleanup = !existsSync(directory); } catch {}
const ok = result.code === 0 && complete && !timedOut && !childAlive && cleanup;
console.log(JSON.stringify({ ok, platform: process.platform, osRelease: release(), arch: process.arch, nodeVersion: process.versions.node,
  launch, backend: 'node-pty', stages, workerExit: result, timedOut, childAlive, cleanup,
  failureStage: ok ? null : childAlive || !cleanup || (complete && timedOut) ? 'cleanup' : stages.at(-1)?.stage || 'load' }, null, 2));
process.exitCode = ok ? 0 : 1;
