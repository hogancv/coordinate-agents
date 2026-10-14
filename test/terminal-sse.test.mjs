import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ExecutionSessionManager } from '../skills/coordinate-agents/scripts/session-manager.mjs';
import { createLocalServer } from '../inspector/server/http-server.mjs';
import { createWorkspaceData } from '../inspector/server/workspace-data.mjs';
import { consumeTerminalStream } from '../inspector/web-workspace/terminal-stream.mjs';
import vm from 'node:vm';

async function fixture(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'terminal-stream-')));
  const id = 'session_' + randomUUID();
  const taskId = 'workspace-' + randomUUID();
  const directory = join(root, '.agent-bus');
  mkdirSync(join(directory, 'sessions'), { recursive: true });
  mkdirSync(join(directory, 'tmp'));
  mkdirSync(join(directory, 'workspace-tasks'));
  const taskPath = join(directory, 'workspace-tasks', taskId + '.json');
  writeFileSync(taskPath, JSON.stringify({ schemaVersion: 1, id: taskId, title: 'stream fixture', promptVersion: 'test',
    status: 'RUNNING', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    sessions: { codex: { slot: 'codex', agent: 'codex', role: 'planner-reviewer', sessionId: id },
      antigravity: { slot: 'antigravity', agent: 'antigravity', role: 'implementer', sessionId: null } } }));
  const metadataPath = join(directory, 'sessions', id + '.json');
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\${id}` : `/tmp/${id}.sock`;
  const child = fork(fileURLToPath(new URL('../skills/coordinate-agents/scripts/session-host.mjs', import.meta.url)), [], {
    execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, COORDINATE_AGENTS_PTY_MODE: 'stdio' },
  });
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk; });
  child.send({ type: 'init', session: { id, root, cwd: root, agent: 'codex', command: process.execPath,
    spawnCommand: process.execPath, spawnArgs: ['-e', "process.stdout.write('history\\n');process.stdin.setEncoding('utf8');process.stdin.on('data',x=>{if(x==='exit') { process.stdout.write('final😀\\n');process.exit(0); } else if(x==='burst') process.stdout.write('B'.repeat(100000)+'BURST-END\\n'); else process.stdout.write('reply:'+x)})"],
    endpoint, metadataPath, taskId, tmpDirectory: join(directory, 'tmp'), createdAt: new Date().toISOString(), maxOutputBytes: 65536 } });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    rmSync(root, { recursive: true, force: true });
  });
  const deadline = Date.now() + 3000;
  while (!existsSync(metadataPath) || !readFileSync(metadataPath, 'utf8').includes('history')) {
    assert.ok(Date.now() < deadline, errors || 'host startup timed out');
    await new Promise(done => setTimeout(done, 10));
  }
  return { root, id, child, taskPath, metadataPath, manager: new ExecutionSessionManager() };
}
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'event delivery timed out');
    await new Promise(done => setTimeout(done, 5));
  }
}
test('Host subscription replays history, pushes on output, resumes by cursor and drains before exit', { timeout: 10000 }, async t => {
  const { root, id, child, manager } = await fixture(t);
  const events = [];
  const errors = [];
  let stop = await manager.subscribe(root, id, { cursor: 0, onEvent: event => events.push(event), onError: error => errors.push(error) });
  await until(() => events.some(event => event.event === 'terminal-output'));
  assert.equal(events.filter(e => e.event === 'terminal-output').map(e => e.output.output).join(''), 'history\n');
  const cursor = events.filter(e => e.event === 'terminal-output').at(-1).output.nextCursor;
  stop();
  await manager.write(root, id, '中文\x1b[32m\n', { submit: false });
  const resumed = [];
  stop = await manager.subscribe(root, id, { cursor, onEvent: e => resumed.push(e), onError: e => errors.push(e) });
  await until(() => resumed.some(e => e.output?.output?.includes('reply:')));
  assert.equal(resumed.some(e => e.output?.output?.includes('history')), false);
  await manager.write(root, id, 'exit', { submit: false });
  await until(() => resumed.some(e => e.event === 'terminal-state' && e.session.state === 'exited'));
  const final = resumed.findIndex(e => e.event === 'terminal-state' && e.session.state === 'exited');
  assert.ok(resumed.slice(0, final).some(e => e.output?.output?.includes('final😀')));
  assert.deepEqual(errors, []);
  stop();
  if (child.exitCode === null) await once(child, 'exit');
  const finalCursor = resumed.filter(e => e.output).at(-1).output.nextCursor;
  const consumed = await manager.read(root, id, { cursor: finalCursor });
  assert.equal(consumed.output, '');
  assert.equal(consumed.nextCursor, finalCursor);
  assert.equal(consumed.truncated, false);
  const missedFinal = await manager.read(root, id, { cursor: finalCursor - Buffer.byteLength('final😀\n') });
  assert.equal(missedFinal.output, 'final😀\n');
});
test('SSE requires capability/loopback and forwards JSON output with resume cursor', async t => {
  const events = [];
  let subscribed = 0;
  let released = 0;
  const data = { async subscribeSessionOutput(id, options) {
    assert.equal(id, 'session_fixture'); assert.equal(options.cursor, 7);
    subscribed += 1;
    options.onEvent({ event: 'terminal-output', output: { output: '\n中文😀\x1b[2J', nextCursor: 30, truncated: false } });
    options.onEvent({ event: 'terminal-state', session: { state: 'exited' } });
    return () => { released += 1; };
  } };
  const server = createLocalServer({ ui: 'workspace', data, capability: 'fixture-capability' });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => { server.close(done); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/sessions/session_fixture/stream?cursor=7`;
  for (const headers of [{}, { 'x-coordinate-agents-capability': 'fixture-capability', origin: 'https://evil.example' }]) {
    assert.equal((await fetch(url, { headers })).status, 403);
  }
  const response = await fetch(url, { headers: { 'x-coordinate-agents-capability': 'fixture-capability' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  events.push(await response.text());
  assert.match(events[0], /id: 30\nevent: terminal-output/);
  assert.match(events[0], /event: terminal-state/);
  assert.equal(subscribed, 1); assert.equal(released, 1);
});

test('real Host → Workspace → fetch SSE isolates two concurrent Sessions and projects, and restores missed output', { timeout: 10000 }, async t => {
  const a = await fixture(t);
  const b = await fixture(t);
  const projects = { contexts: new Map(), store: { get(id) {
    return { id, root: id === 'a' ? a.root : b.root };
  } } };
  const server = createLocalServer({ root: a.root, ui: 'workspace', capability: 'integration', projects });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const aborts = [];
  t.after(() => {
    for (const abort of aborts) abort.abort();
    return new Promise(done => { server.close(done); server.closeAllConnections(); });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'x-coordinate-agents-capability': 'integration' };
  assert.equal((await fetch(`${base}/api/projects/b/api/sessions/${a.id}/stream`, { headers })).status, 404);
  async function listen(fixture, project, cursor = 0) {
    const abort = new AbortController(); aborts.push(abort);
    const response = await fetch(`${base}/api/projects/${project}/api/sessions/${fixture.id}/stream?cursor=${cursor}`, { headers, signal: abort.signal });
    assert.equal(response.status, 200);
    const messages = [];
    const completed = consumeTerminalStream(response, { signal: abort.signal, onEvent: (event, data) => messages.push({ event, ...data }) }).catch(error => {
      if (!abort.signal.aborted) throw error;
    });
    return { abort, messages, completed };
  }
  const first = await listen(a, 'a');
  const second = await listen(b, 'b');
  await until(() => first.messages.some(e => e.output) && second.messages.some(e => e.output));
  await Promise.all([a.manager.write(a.root, a.id, 'only-A\n', { submit: false }), b.manager.write(b.root, b.id, 'only-B\n', { submit: false })]);
  await until(() => first.messages.some(e => e.output?.output.includes('reply:only-A')) && second.messages.some(e => e.output?.output.includes('reply:only-B')));
  assert.equal(first.messages.some(e => e.output?.output.includes('only-B')), false);
  assert.equal(second.messages.some(e => e.output?.output.includes('only-A')), false);
  const cursor = first.messages.filter(e => e.output).at(-1).output.nextCursor;
  first.abort.abort(); await first.completed;
  await a.manager.write(a.root, a.id, 'missed😀\n', { submit: false });
  const resumed = await listen(a, 'a', cursor);
  await until(() => resumed.messages.some(e => e.output?.output.includes('reply:missed😀')));
  assert.equal(resumed.messages.some(e => e.output?.output.includes('only-A') || e.output?.output.includes('history')), false);
  // Reject a Session that exists in the project but is no longer in its Task.
  const task = JSON.parse(readFileSync(a.taskPath)); task.sessions.codex.sessionId = null;
  writeFileSync(a.taskPath, JSON.stringify(task));
  assert.equal((await fetch(`${base}/api/projects/a/api/sessions/${a.id}/stream`, { headers })).status, 400);
  assert.equal((await fetch(`${base}/api/projects/a/api/sessions/${a.id}/read`, { headers })).status, 400);
  assert.equal((await createWorkspaceData(b.root).readSessionOutput(b.id)).session.id, b.id);
});

test('evicted history emits an SSE gap and HTTP pagination retains every remaining byte', { timeout: 10000 }, async t => {
  const fixtureSession = await fixture(t);
  const { root, id, manager, metadataPath } = fixtureSession;
  await manager.write(root, id, 'burst', { submit: false });
  await until(() => JSON.parse(readFileSync(metadataPath)).outputTail.includes('BURST-END'));
  let cursor = 0;
  let retained = '';
  let first = true;
  let page;
  do {
    page = await manager.read(root, id, { cursor, maxBytes: 8192 });
    assert.equal(page.truncated, first);
    retained += page.output; cursor = page.nextCursor; first = false;
  } while (page.hasMore);
  assert.equal(retained, ('B'.repeat(100000) + 'BURST-END\n').slice(-65536));
  const server = createLocalServer({ root, ui: 'workspace', capability: 'gap-test' });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const abort = new AbortController();
  t.after(() => { abort.abort(); return new Promise(done => { server.close(done); server.closeAllConnections(); }); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sessions/${id}/stream?cursor=0`, {
    headers: { 'x-coordinate-agents-capability': 'gap-test' }, signal: abort.signal,
  });
  const events = [];
  const stream = consumeTerminalStream(response, { signal: abort.signal, onEvent: (event, message) => events.push({ event, ...message }) });
  await until(() => events.filter(e => e.output).at(-1)?.output.nextCursor === cursor);
  abort.abort(); await stream;
  assert.equal(events.filter(e => e.event === 'terminal-gap').length, 1);
  assert.equal(events.filter(e => e.output).map(e => e.output.output).join(''), retained);
});

test('browser disconnect releases the pending subscription even before it becomes ready', async t => {
  let release;
  let cancelled = false;
  let cleaned = 0;
  const data = { subscribeSessionOutput(_id, options) {
    options.signal.addEventListener('abort', () => { cancelled = true; });
    return new Promise(done => { release = () => done(() => { cleaned += 1; }); });
  } };
  const server = createLocalServer({ ui: 'workspace', data, capability: 'cancel-test' });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => { server.close(done); server.closeAllConnections(); }));
  const abort = new AbortController();
  const pending = fetch(`http://127.0.0.1:${server.address().port}/api/sessions/session_fixture/stream`, {
    headers: { 'x-coordinate-agents-capability': 'cancel-test' }, signal: abort.signal,
  }).catch(() => {});
  await until(() => release);
  abort.abort(); await pending;
  await until(() => cancelled);
  release();
  await until(() => cleaned === 1);
});

test('Host IPC can pause and resume without replay, and unsubscribe leaves its CLI running', { timeout: 10000 }, async t => {
  const { root, id, manager } = await fixture(t);
  const messages = [];
  let paused = true;
  const stop = await manager.subscribe(root, id, { cursor: 0, onEvent: message => {
    messages.push(message);
    if (paused && message.output) return false;
  } });
  await until(() => messages.some(e => e.output));
  await manager.write(root, id, 'while-paused\n', { submit: false });
  assert.equal(messages.some(e => e.output?.output.includes('while-paused')), false);
  paused = false; stop.resume();
  await until(() => messages.some(e => e.output?.output.includes('reply:while-paused')));
  assert.equal(messages.filter(e => e.output?.output.includes('history')).length, 1);
  stop();
  const count = messages.length;
  await manager.write(root, id, 'after-unsubscribe\n', { submit: false });
  assert.equal(messages.length, count);
  assert.ok(['running', 'idle', 'busy'].includes((await manager.status(root, id)).state));
});

test('HTTP backpressure pauses IPC, drain resumes it, and a stalled client is closed with cleanup', async () => {
  const timers = new Map();
  let timerId = 0;
  let resumeCount = 0;
  let cleanupCount = 0;
  let options;
  const response = new EventEmitter();
  Object.assign(response, { headersSent: false, writes: [], writableLength: 100,
    writeHead() { this.headersSent = true; }, flushHeaders() {},
    write(frame) { this.writes.push(frame); return false; },
    destroy() { this.emit('close'); }, end() { this.emit('close'); },
  });
  const context = vm.createContext({ AbortController, Number, JSON,
    setInterval() { return { unref() {} }; }, clearInterval() {},
    setTimeout(fn, delay) { const id = { value: ++timerId, unref() {} }; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }, apiError() { assert.fail('unexpected subscription failure'); },
  });
  const source = readFileSync(new URL('../inspector/server/http-server.mjs', import.meta.url), 'utf8');
  vm.runInContext(source.slice(source.indexOf('async function streamTerminal('), source.indexOf('export function createLocalServer(')), context);
  const stop = () => { cleanupCount += 1; }; stop.resume = () => { resumeCount += 1; };
  await context.streamTerminal({}, response, { async subscribeSessionOutput(_id, opts) { options = opts; return stop; } }, 'session_fixture', 0);
  const event = { event: 'terminal-output', output: { output: 'text', nextCursor: 4 } };
  assert.equal(options.onEvent(event), false);
  assert.equal([...timers.values()][0].delay, 5000);
  response.emit('drain');
  assert.equal(resumeCount, 1); assert.equal(timers.size, 0);
  options.onEvent(event);
  [...timers.values()][0].fn();
  assert.equal(cleanupCount, 1);
  assert.equal(options.signal.aborted, true);
  assert.equal(timers.size, 0);
  assert.equal(options.onEvent(event), false);
  assert.equal(response.writes.length, 2);
});
