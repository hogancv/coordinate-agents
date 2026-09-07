import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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
    Date, URLSearchParams, TERMINAL_POLL_MS: 500, TERMINAL_MAX_LINES: 200, TERMINAL_MAX_BYTES: 32768,
    fetchJson: () => new Promise(resolve => { complete = resolve; }),
    sessionIsActive: () => true, updateTerminalHeader() {}, state: {},
  });
  vm.runInContext(source, context);
  const controller = { pane: { sessionId: 'a', slotId: 'codex' }, terminal: { write: x => writes.push(x) }, cursor: null, activeUntil: 0 };
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
