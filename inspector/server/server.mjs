#!/usr/bin/env node
// Source-only Inspector compatibility; the npm Workspace never imports this file.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInspectorData } from './inspector-data.mjs';
import { createLocalServer, startLocalServer } from './http-server.mjs';
import { startWorkspace } from './workspace-server.mjs';
export { startWorkspace };
const assetsRoot = fileURLToPath(new URL('../web', import.meta.url));
const staticFiles = new Map([
  ['/index.html', { file: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/styles.css', { file: 'styles.css', type: 'text/css; charset=utf-8' }],
]);

export function createInspectorServer(options = {}) {
  return createLocalServer({ ...options, ui: options.ui || 'inspector', dataFactory: createInspectorData, ...(options.ui === 'workspace' ? {} : { assetsRoot, staticFiles }) });
}
export function startInspector(options = {}) {
  return startLocalServer({ ...options, ui: 'inspector', dataFactory: createInspectorData, ...(options.ui === 'workspace' ? {} : { assetsRoot, staticFiles }) });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = key => args[args.indexOf(key) + 1];
  try {
    const ui = args.includes('--ui') ? value('--ui') : 'inspector';
    const started = await (ui === 'workspace' ? startWorkspace : startInspector)({ root: args.includes('--root') ? value('--root') : process.cwd(), port: args.includes('--port') ? Number(value('--port')) : 3000 });
    console.log(`${ui === 'workspace' ? 'Workspace' : 'Inspector'} running:\n\n${started.url}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
