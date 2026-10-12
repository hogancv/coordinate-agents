import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ExecutionSessionManager, readRecord } from '../../skills/coordinate-agents/scripts/session-manager.mjs';
import { resolveExecutable } from '../../skills/coordinate-agents/adapters/executable.mjs';
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
function killOwned(pid) {
  if (alive(pid)) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
}
async function until(predicate, description, timeoutMs = 5000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error(`Timed out: ${description}`);
}

const fixture = fileURLToPath(new URL('./native-pty-fixture.mjs', import.meta.url));
const host = fileURLToPath(new URL('../../skills/coordinate-agents/scripts/session-host.mjs', import.meta.url));
export async function runSessionChecks(directory, { failedProbe = false, hangProbe = false } = {}) {
  const suppliedRoot = join(directory, '项目 with spaces');
  mkdirSync(join(suppliedRoot, '.agent-bus', 'tmp'), { recursive: true });
  // Session Manager canonicalizes roots. Windows CI can expose both the long
  // runner profile path and an 8.3 alias; direct readRecord calls must use the
  // same canonical root, without weakening the production containment guard.
  const root = realpathSync.native(suppliedRoot);
  const records = [], opened = [];
  let manager;
  const facts = agent => join(root, `${agent}.jsonl`);
  const readFacts = agent => existsSync(facts(agent)) ? readFileSync(facts(agent), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const seen = (agent, type, predicate = () => true) => readFacts(agent).find(f => f.type === type && predicate(f));
  const expected = failedProbe ? 'stdio-fallback' : 'node-pty';
  const probeLog = join(root, 'preflight-count.txt');
  const exitLog = join(root, 'host-exits.jsonl');
  const monitoredHost = join(root, 'monitored-host.mjs');
  writeFileSync(monitoredHost, `import { appendFileSync } from 'node:fs';\nprocess.once('exit', code => appendFileSync(${JSON.stringify(exitLog)}, JSON.stringify({pid:process.pid,code})+'\\n'));\nif (${Boolean(failedProbe)} && process.argv.includes('--native-pty-probe')) { appendFileSync(${JSON.stringify(probeLog)}, 'P'); ${hangProbe ? 'setInterval(() => {}, 1000);' : 'process.abort();'} } else { await import(${JSON.stringify(pathToFileURL(host).href)}); }\n`);
  manager = new ExecutionSessionManager({ hostPath: monitoredHost, maxOutputBytes: 4096 });
  async function open(agent, command = process.execPath, launchArgs = [fixture, facts(agent), agent, '--native-pty-fixture']) {
    const executable = resolveExecutable(command);
    const adapter = {
      id: 'native-test-only',
      detect: () => ({ available: true, resolvedCommand: command }),
      resolveLaunch: () => ({ command: executable.command, prefix: executable.prefix, args: launchArgs }),
    };
    const value = await manager.open({ root, agent, resolved: { command }, adapter, workspace: true });
    opened.push(value.session);
    records.push(readRecord(root, value.session.id));
    return value;
  }
  try {
    // Real adapters accept .cmd with a safe .cjs sibling, not arbitrary batch
    // shell strings. Preserve the configured .cmd identity and launch via Node.
    const cmdPath = join(root, 'mock agy 中文.cmd');
    writeFileSync(cmdPath, `@"${process.execPath}" "${fixture}" "${facts('antigravity')}" antigravity\r\n`);
    writeFileSync(cmdPath.replace(/\.cmd$/, '.cjs'), `import(${JSON.stringify(pathToFileURL(fixture).href)});\n`);
    const first = await open('codex');
    const second = await open('antigravity', cmdPath, [facts('antigravity'), 'antigravity', '--native-pty-fixture']);
    for (const value of [first, second]) {
      assert.equal(value.session.backend, expected);
      assert.ok(['running', 'idle', 'busy'].includes(value.session.state), JSON.stringify(value));
    }
    assert.notEqual(first.session.pid, second.session.pid);
    assert.equal((await open('codex')).session.id, first.session.id);
    for (const [agent, session] of [['codex', first.session], ['antigravity', second.session]]) {
      await manager.write(root, session.id, 'hello中文\r\x1b[A\x7f', { submit: false });
      await until(() => seen(agent, 'line', f => f.value === 'hello中文') && seen(agent, 'key', f => f.name === 'up'), `${agent} input`);
    }
    if (!failedProbe) {
      await manager.resize(root, first.session.id, 71, 18);
      await manager.write(root, first.session.id, ':size\r', { submit: false });
      await until(() => seen('codex', 'size', f => f.cols === 71 && f.rows === 18), 'first native resize');
      await manager.write(root, second.session.id, ':size\r', { submit: false });
      await until(() => seen('antigravity', 'size', f => f.cols === 120 && f.rows === 30), 'second size independent');
    }
    await manager.write(root, first.session.id, ':fail\r', { submit: false });
    await until(() => !alive(first.session.pid), 'failed CLI exited');
    // Native output flush takes up to one second before Host terminal facts.
    for (let i = 0; i < 100; i++) {
      const state = await manager.status(root, first.session.id);
      if (state.state === 'failed') break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const failed = await manager.status(root, first.session.id);
    assert.equal(failed.state, 'failed'); assert.equal(failed.exitCode, 7);
    await until(() => !alive(records[0].hostPid), 'natural Host exit');
    const tail = await manager.read(root, first.session.id);
    assert.match(tail.output, /FINAL-OUTPUT-中文/);
    assert.equal(await manager.findReusable(root, 'codex', process.execPath), null);
    assert.equal(alive(second.session.pid), true, 'closing first must not close second');
    const replacement = await open('codex');
    assert.notEqual(replacement.session.id, first.session.id);
    const closed = await manager.close(root, second.session.id, { graceful: false, timeoutMs: 1500 });
    assert.ok(['exited', 'failed'].includes(closed.state));
    await until(() => !alive(records[1].hostPid) && !alive(second.session.pid), 'forced Host/CLI tree exit');
    assert.equal(alive(replacement.session.pid), true);
    if (!failedProbe) {
      // Cooked console Ctrl+C and a client dropping its slow close response
      // reproduced the original premature Host shutdown/EPIPE failures.
      const cooked = await open('cooked', process.execPath, [fixture, facts('cooked'), 'cooked', '--native-pty-fixture', '--cooked']);
      const owned = readRecord(root, cooked.session.id);
      await manager.write(root, cooked.session.id, 'cooked一\ncooked二\n', { submit: true });
      await until(() => seen('cooked', 'line', f => f.value === 'cooked一') && seen('cooked', 'line', f => f.value === 'cooked二'), 'cooked logical multiline Enter');
      await new Promise((resolve, reject) => {
        const socket = createConnection(owned.endpoint);
        socket.on('error', reject);
        socket.once('connect', () => socket.write(JSON.stringify({ id: 'disconnect', op: 'close', graceful: true, timeoutMs: 1000 })+'\n', () => { socket.destroy(); resolve(); }));
      });
      await until(() => !alive(owned.hostPid) && !alive(owned.pid), 'dropped close owns cleanup', 8000);
      const exits = readFileSync(exitLog, 'utf8').trim().split('\n').map(JSON.parse);
      assert.equal(exits.find(value => value.pid === owned.hostPid)?.code, 0, 'client disconnect must not crash Host');
    }
    if (failedProbe) assert.equal(readFileSync(probeLog, 'utf8'), 'P', 'abort preflight is bounded and cached; no automatic task retry');
    return { backend: expected, native: !failedProbe, checks: { hostLifecycle: true, cmdEntry: true, input: true, resize: !failedProbe, independentSessions: true, finalOutput: true, deadNotReused: true, abortFallback: failedProbe, cleanup: true } };
  } finally {
    const closeErrors = [];
    for (const session of opened) {
      try { await manager.close(root, session.id, { graceful: false, timeoutMs: 1500 }); }
      catch (error) { closeErrors.push(`${session.id}: ${error.message}`); }
    }
    const leaked = [];
    for (const record of records) {
      if (alive(record.hostPid) || alive(record.pid)) leaked.push({ id: record.id, agent: record.agent, hostAlive: alive(record.hostPid), cliAlive: alive(record.pid) });
      if (alive(record.hostPid)) killOwned(record.hostPid);
      if (alive(record.pid)) killOwned(record.pid);
    }
    assert.deepEqual(leaked, [], 'cleanup intervention is a failure, not a passing runtime cleanup');
    assert.deepEqual(closeErrors, [], 'Session close errors must fail acceptance');
  }
}
