import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
const source = app.slice(app.indexOf('function resizeTerminal('), app.indexOf('async function pollTerminalViews('));
test('same xterm dimensions retry after failed backend resize', async () => {
  let calls = 0; const dimensions = [];
  const context = vm.createContext({ terminalSize: () => ({ cols: 91, rows: 27 }),
    postAction: async () => { if (++calls === 1) throw new Error('temporary network failure'); }, showToast() {}, t: value => value,
  });
  vm.runInContext(source, context);
  const controller = { pane: { sessionId: 'owned' }, terminal: { resize: (cols, rows) => dimensions.push([cols, rows]) }, resizePromise: Promise.resolve() };
  context.resizeTerminal(controller); await controller.resizePromise;
  context.resizeTerminal(controller); await controller.resizePromise;
  assert.equal(calls, 2); assert.equal(controller.lastSize, '91x27');
  assert.deepEqual(dimensions.at(-1), [91, 27]);
});
test('returning to acknowledged dimensions while another resize is pending restores both ends', async () => {
  let size = { cols: 103, rows: 31 }, finish;
  const requests = [], dimensions = [];
  const context = vm.createContext({ terminalSize: () => size,
    postAction: async (_, data) => { requests.push([data.cols, data.rows]); if (requests.length === 1) await new Promise(done => { finish = done; }); },
    showToast() {}, t: value => value,
  });
  vm.runInContext(source, context);
  const controller = { pane: { sessionId: 'owned' }, terminal: { resize: (cols, rows) => dimensions.push([cols, rows]) }, resizePromise: Promise.resolve(), lastSize: '91x27' };
  context.resizeTerminal(controller); await Promise.resolve();
  size = { cols: 91, rows: 27 }; context.resizeTerminal(controller);
  finish(); await controller.resizePromise;
  assert.deepEqual(requests, [[103, 31], [91, 27]]);
  assert.deepEqual(dimensions.at(-1), [91, 27]);
  assert.equal(controller.lastSize, '91x27');
});
