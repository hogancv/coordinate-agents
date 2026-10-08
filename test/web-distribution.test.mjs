import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { startWorkspace } from './support/workspace-server.mjs';

const repo = resolve('.');
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
  assert.equal(manifest.version, '3.0.0');
  assert.equal(manifest.exports?.['./*'], undefined);
  for (const item of ['skills', 'lib', 'scripts', 'inspector', 'mcp', 'schemas', '.codex-plugin', 'examples', 'adapter-sdk.mjs']) assert.ok(!manifest.files.includes(item), item);
});

test('artifact loader runs from a temporary directory containing spaces', async () => {
  const { loaderNodeOptions } = await import('../scripts/verify-release-artifact.mjs');
  assert.equal(typeof loaderNodeOptions, 'function');
  const temporary = mkdtempSync(join(tmpdir(), 'release loader with spaces-'));
  try {
    const loader = join(temporary, 'loader with spaces.mjs');
    writeFileSync(loader, 'export async function load(url, context, next) { return next(url, context); }');
    const result = spawnSync(process.execPath, ['-e', 'console.log("loaded")'], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: loaderNodeOptions(loader) } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'loaded');
    assert.match(loaderNodeOptions(loader), /file:/);
    assert.doesNotMatch(loaderNodeOptions(loader), / /);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('HTTP read defaults preserve bounded terminal output without query parameters', async () => {
  const { createLocalServer } = await import('../inspector/server/http-server.mjs');
  const server = createLocalServer({ ui: 'workspace', data: { readSessionOutput: async (_id, options) => options } });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sessions/session-fixture/read`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { cursor: null, maxLines: 200, maxBytes: 32768 });
  } finally { await new Promise(done => { server.close(done); server.closeAllConnections?.(); }); }
});
