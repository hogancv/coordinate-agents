import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { startWorkspace } from './support/workspace-server.mjs';

const repo = resolve('.');
test('native identity capture runtime ships in the Web package', () => {
  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.ok(manifest.files.includes('skills/coordinate-agents/scripts/codex-identity-capture.mjs'));
});
test('custom terminal modules ship in the precise package whitelist and UI helper is served', async () => {
  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  for (const file of ['inspector/web-workspace/custom-terminal-model.mjs', 'skills/coordinate-agents/scripts/workspace-custom-config.mjs']) assert.ok(manifest.files.includes(file), file);
  const { createLocalServer } = await import('../inspector/server/http-server.mjs');
  const server = createLocalServer({ ui: 'workspace', capability: 'custom-test', data: {} });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try { assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/custom-terminal-model.mjs`)).status, 200); }
  finally { await new Promise(done => { server.close(done); server.closeAllConnections?.(); }); }
});
test('the Web server serves the dictionary imported by app.js as a JavaScript module', async () => {
  const { createLocalServer } = await import('../inspector/server/http-server.mjs');
  const server = createLocalServer({ ui: 'workspace', capability: 'dictionary-test', data: {} });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const app = await (await fetch(`${base}/app.js`)).text();
    const specifier = app.match(/import \{ I18N \} from ['"]([^'"]+)['"]/)[1];
    const response = await fetch(new URL(specifier, `${base}/app.js`));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    const { I18N } = await import(`data:text/javascript;base64,${Buffer.from(await response.text()).toString('base64')}`);
    assert.equal(I18N.en['terminal.live'], '● Live');
    assert.equal(I18N.zh['terminal.live'], '● 实时');
  } finally { await new Promise(done => { server.close(done); server.closeAllConnections?.(); }); }
});

test('npm CLI help loads no Legacy runtime', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'web-imports-'));
  try {
    const loader = join(temporary, 'loader.mjs');
    const log = join(temporary, 'imports.txt');
    writeFileSync(loader, `import { appendFileSync } from 'node:fs';
export async function load(url, context, next) { appendFileSync(${JSON.stringify(log)}, url+'\\n'); return next(url,context); }`);
    const result = spawnSync(process.execPath, ['--experimental-loader', pathToFileURL(loader).href, join(repo, 'bin/coordinate-agents.mjs'), '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(readFileSync(log, 'utf8'), /cli-core|task-graph|\/task-runtime\.mjs|agent-bus\.mjs|runtime-services\.mjs|inspector-data/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('default Web API refuses structured Task/Graph operations and read routes', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'web-only-'));
  let started;
  try {
    started = await startWorkspace({ root: temporary, port: 0 });
    const base = started.url.replace('localhost', '127.0.0.1');
    for (const action of ['taskCreate', 'taskGraphValidate', 'taskGraphRun', 'taskReview', 'recoverInspect']) {
      const response = await fetch(`${base}/api/action`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-coordinate-agents-capability': started.capability }, body: JSON.stringify({ action, params: {} }) });
      assert.equal(response.status, 404, action);
      assert.equal((await response.json()).error.code, 'ACTION_NOT_ALLOWED');
    }
    for (const path of ['/api/tasks', '/api/graphs']) assert.equal((await fetch(base+path, { headers: { 'x-coordinate-agents-capability': started.capability } })).status, 404);
  } finally {
    if (started) await new Promise(done => { started.server.close(done); started.server.closeAllConnections?.(); });
    rmSync(temporary, { recursive: true, force: true });
  }
});

test('npm payload has an explicit runtime whitelist and no Plugin distribution', () => {
  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.equal(manifest.version, '3.0.2');
  assert.equal(manifest.exports?.['./*'], undefined);
  for (const item of ['skills', 'lib', 'scripts', 'inspector', 'mcp', 'schemas', '.codex-plugin', 'examples', 'adapter-sdk.mjs']) assert.ok(!manifest.files.includes(item), item);
});

test('artifact loader runs from a temporary directory containing spaces', async () => {
  const { loaderNodeOptions } = await import('../scripts/verify-release-artifact.mjs');
  assert.equal(typeof loaderNodeOptions, 'function');
  const temporary = mkdtempSync(join(tmpdir(), 'release loader with spaces-'));
  try {
    const loader = join(temporary, 'loader with spaces.mjs');
    const marker = join(temporary, 'loader-ran.txt');
    writeFileSync(loader, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'loaded'); export async function load(url, context, next) { return next(url, context); }`);
    const result = spawnSync(process.execPath, ['-e', 'console.log("loaded")'], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: loaderNodeOptions(loader) } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'loaded');
    assert.equal(readFileSync(marker, 'utf8'), 'loaded');
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('HTTP read defaults preserve bounded terminal output without query parameters', async () => {
  const { createLocalServer } = await import('../inspector/server/http-server.mjs');
  const server = createLocalServer({ ui: 'workspace', capability: 'read-test', data: { readSessionOutput: async (_id, options) => options } });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sessions/session-fixture/read`, { headers: { 'x-coordinate-agents-capability': 'read-test' } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { cursor: null, maxLines: 200, maxBytes: 32768 });
  } finally { await new Promise(done => { server.close(done); server.closeAllConnections?.(); }); }
});

test('review helper ships in the explicit whitelist and is served as JavaScript', async () => {
  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  assert.ok(manifest.files.includes('inspector/web-workspace/review-feedback.mjs'));
  const { createLocalServer } = await import('../inspector/server/http-server.mjs');
  const server = createLocalServer({ ui: 'workspace', capability: 'review-test', data: {} });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/review-feedback.mjs`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
    const helpers = await import(`data:text/javascript;base64,${Buffer.from(await response.text()).toString('base64')}`);
    assert.equal(helpers.REVIEW_MAX_LINES, 40);
    assert.equal(helpers.REVIEW_MAX_BYTES, 8192);
  } finally { await new Promise(done => { server.close(done); server.closeAllConnections?.(); }); }
});

test('native notification core and trusted Windows script ship in the precise npm whitelist', () => {
  const manifest = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  for (const name of ['workspace-notification-config.mjs', 'workspace-notifications.mjs', 'workspace-notifications-windows.ps1']) {
    assert.ok(manifest.files.includes(`skills/coordinate-agents/scripts/${name}`), name);
  }
});
