import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('function resizeTerminal('), app.indexOf('async function pollTerminalViews('));
function terminal(resize) {
  return { resize, buffer: { active: { viewportY: 0, baseY: 0 } }, scrollToBottom() {} };
}
const settle = () => new Promise(setImmediate);
test('same xterm dimensions retry after failed backend resize', async () => {
  let calls = 0; const dimensions = [], timers = [];
  const context = vm.createContext({ terminalSize: () => ({ cols: 91, rows: 27 }),
    window: { setTimeout: callback => { timers.push(callback); return timers.length; } },
    postAction: async () => { if (++calls === 1) throw new Error('temporary network failure'); }, showToast() {}, t: value => value,
  });
  vm.runInContext(source, context);
  const controller = { pane: { sessionId: 'owned' }, terminal: terminal((cols, rows) => dimensions.push([cols, rows])) };
  context.resizeTerminal(controller); timers.shift()(); await settle();
  context.resizeTerminal(controller);
  assert.equal(timers.length, 1, 'Failed dimensions must remain eligible for retry');
  timers.shift()(); await settle();
  assert.equal(calls, 2); assert.equal(controller.lastSize, '91x27');
  assert.deepEqual(dimensions.at(-1), [91, 27]);
});
test('returning to acknowledged dimensions while another resize is pending restores both ends', async () => {
  let size = { cols: 103, rows: 31 }, finish;
  const requests = [], dimensions = [], timers = [];
  const context = vm.createContext({ terminalSize: () => size,
    window: { setTimeout: callback => { timers.push(callback); return timers.length; } },
    postAction: async (_, data) => { requests.push([data.cols, data.rows]); if (requests.length === 1) await new Promise(done => { finish = done; }); },
    showToast() {}, t: value => value,
  });
  vm.runInContext(source, context);
  const controller = { pane: { sessionId: 'owned' }, terminal: terminal((cols, rows) => dimensions.push([cols, rows])), lastSize: '91x27' };
  context.resizeTerminal(controller); timers.shift()(); await Promise.resolve();
  size = { cols: 91, rows: 27 }; context.resizeTerminal(controller);
  finish(); await settle();
  timers.shift()(); await settle();
  assert.deepEqual(requests, [[103, 31], [91, 27]]);
  assert.deepEqual(dimensions.at(-1), [91, 27]);
  assert.equal(controller.lastSize, '91x27');
});
