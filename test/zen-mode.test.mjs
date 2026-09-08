import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('Zen mode toggles presentation and resizes existing terminals without replacing sessions', () => {
  const app = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
  const source = app.slice(app.indexOf('function setZenMode('), app.indexOf('function renderRepository('));
  const classes = new Set();
  const elements = new Map(['#zen-button', '#zen-exit'].map(id => [id, { hidden: true, focus() {}, setAttribute(key, value) { this[key] = value; } }]));
  const controllers = [{ sessionId: 'codex' }, { sessionId: 'antigravity' }];
  const resized = [];
  const state = { selectedTask: { id: 'task' }, terminalViews: new Map(controllers.map(item => [item.sessionId, item])) };
  const context = vm.createContext({ state,
    document: { body: { classList: { toggle(key, enabled) { enabled ? classes.add(key) : classes.delete(key); } } }, querySelector: id => elements.get(id) },
    window: { requestAnimationFrame: callback => callback() }, resizeTerminal: controller => resized.push(controller),
  });
  vm.runInContext(source, context);
  context.setZenMode(true);
  assert.equal(classes.has('zen-mode'), true);
  assert.equal(elements.get('#zen-exit').hidden, false);
  assert.equal(elements.get('#zen-button')['aria-pressed'], 'true');
  assert.deepEqual(resized, controllers);
  context.setZenMode(false);
  assert.equal(classes.has('zen-mode'), false);
  assert.equal(elements.get('#zen-exit').hidden, true);
  assert.equal(state.terminalViews.get('codex'), controllers[0]);
  state.selectedTask = null;
  context.setZenMode(true);
  assert.equal(classes.has('zen-mode'), false);
});
