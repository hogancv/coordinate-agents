import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { consumeTerminalStream, deliverTerminalOutput } from '../inspector/web-workspace/terminal-stream.mjs';

// Exercise the browser's actual scheduling code with deterministic timers/HTTP.
const app = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('function scheduleTerminalRead('), app.indexOf('async function loadRepository('));
function setup() {
  const timers = new Map();
  let next = 0;
  let complete;
  const writes = [];
  const context = vm.createContext({
    window: { setTimeout(fn, delay) { timers.set(++next, { fn, delay }); return next; }, clearTimeout(id) { timers.delete(id); } },
    Date, URLSearchParams, AbortController, deliverTerminalOutput, TERMINAL_POLL_MS: 500, TERMINAL_MAX_LINES: 200, TERMINAL_MAX_BYTES: 32768,
    fetchJson: () => new Promise(resolve => { complete = resolve; }),
    sessionIsActive: () => true, updateTerminalHeader() {}, state: {},
  });
  vm.runInContext(source, context);
  const controller = { pane: { sessionId: 'a', slotId: 'codex' }, terminal: { write: (x, done) => { writes.push(x); done?.(); } }, cursor: null, activeUntil: 0 };
  return { context, controller, timers, writes, finish: output => complete({ output: { output, nextCursor: 1 } }) };
}
test('input during an outstanding read schedules one immediate follow-up, never overlapping reads', async () => {
  const { context, controller, timers, finish } = setup();
  const pending = context.readTerminal(controller);
  context.scheduleTerminalRead(controller, 0);
  context.scheduleTerminalRead(controller, 0);
  assert.equal(timers.size, 0);
  finish('');
  await pending;
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 0);
});
test('output uses fast polling and idle uses slower polling', async () => {
  for (const [output, expected] of [['hello', 50], ['', 500]]) {
    const { context, controller, timers, finish, writes } = setup();
    const pending = context.readTerminal(controller);
    finish(output);
    await pending;
    assert.equal([...timers.values()][0].delay, expected);
    assert.deepEqual(writes, output ? [output] : []);
  }
});
test('late response after switching tasks cannot render or restart polling', async () => {
  const { context, controller, timers, finish, writes } = setup();
  const pending = context.readTerminal(controller);
  controller.disposed = true;
  finish('stale output');
  await pending;
  assert.equal(timers.size, 0);
  assert.deepEqual(writes, []);
});

function transportSetup(fetchStream) {
  const timers = new Map();
  const writes = [];
  let next = 0;
  const context = vm.createContext({
    window: { setTimeout(fn, delay) { timers.set(++next, { fn, delay }); return next; }, clearTimeout(id) { timers.delete(id); } },
    Date, URLSearchParams, AbortController, consumeTerminalStream, deliverTerminalOutput,
    TERMINAL_POLL_MS: 500, TERMINAL_MAX_LINES: 200, TERMINAL_MAX_BYTES: 32768,
    CAPABILITY_HEADER: 'x-coordinate-agents-capability', capability: 'fixture',
    fetch: fetchStream,
    fetchJson: async () => ({ session: { state: 'running' }, output: { output: 'old', nextCursor: 10 } }),
    sessionIsActive: session => session.state === 'running', updateTerminalHeader() {}, state: {},
    showToast() {}, t: value => value,
  });
  vm.runInContext(app.slice(app.indexOf('async function connectTerminalStream('), app.indexOf('async function loadRepository(')), context);
  const controller = { projectId: 'project-a', pane: { sessionId: 'session-a', slotId: 'codex' },
    terminal: { write(text, done) { writes.push(text); done(); } }, cursor: null, activeUntil: 0, retryDelay: 5000 };
  return { context, controller, timers, writes };
}
function sseResponse(messages) {
  return new Response(messages.map(message => `event: ${message.event}\ndata: ${JSON.stringify(message)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } });
}
test('SSE failure falls back, then reconnect serializes against polling and uses its cursor without replay', async () => {
  const requests = [];
  const { context, controller, timers, writes } = transportSetup(async (url, options) => {
    requests.push({ url, options });
    if (requests.length === 1) return new Response('unsupported', { status: 404 });
    return sseResponse([
      { event: 'terminal-output', session: { state: 'running' }, output: { output: 'old', nextCursor: 10 } },
      { event: 'terminal-output', session: { state: 'running' }, output: { output: 'new', nextCursor: 13 } },
      { event: 'terminal-state', session: { state: 'exited' } },
    ]);
  });
  await context.connectTerminalStream(controller);
  assert.equal(controller.transport, 'polling');
  assert.ok([...timers.values()].some(timer => timer.delay === 5000));
  const read = context.readTerminal(controller);
  const connect = context.connectTerminalStream(controller);
  assert.equal(requests.length, 1, 'reconnect waits for pending read and render');
  await read; await connect;
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /^\/api\/projects\/project-a\/api\/sessions\/session-a\/stream\?cursor=10$/);
  assert.equal(requests[1].options.headers['x-coordinate-agents-capability'], 'fixture');
  assert.deepEqual(writes, ['old', 'new']);
  assert.equal(controller.finished, true);
  assert.equal(controller.cursor, 13);
  assert.equal(timers.size, 0);
});
test('a late SSE response after project/task disposal cannot render or start fallback', async () => {
  let resolve;
  const { context, controller, timers, writes } = transportSetup(() => new Promise(done => { resolve = done; }));
  const connect = context.connectTerminalStream(controller);
  controller.disposed = true;
  controller.streamAbort.abort();
  resolve(sseResponse([{ event: 'terminal-output', output: { output: 'stale', nextCursor: 5 } }]));
  await connect;
  assert.deepEqual(writes, []);
  assert.equal(timers.size, 0);
});
