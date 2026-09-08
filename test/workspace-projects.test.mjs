import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import vm from 'node:vm';
import { createProjectStore } from '../inspector/server/workspace-projects.mjs';
import { startWorkspace } from '../inspector/server/server.mjs';
import { readConfig, writeConfig } from '../skills/coordinate-agents/scripts/config.mjs';

test('concurrent project registration deduplicates and failed initialization can recover', async () => {
  const home = mkdtempSync(join(tmpdir(), 'project-concurrent-'));
  try {
    const folder = join(home, 'repo'); mkdirSync(folder);
    const store = createProjectStore({ home });
    mkdirSync(join(folder, '.agent-bus'));
    writeFileSync(join(folder, '.agent-bus', 'config.json'), '{invalid');
    assert.throws(() => store.register(folder, true), /Agent Bus initialization failed/);
    assert.equal(store.list().length, 0);
    assert.ok(existsSync(join(folder, '.git')));
    rmSync(join(folder, '.agent-bus', 'config.json'));
    store.register(folder, true);
    const source = `import {createProjectStore} from ${JSON.stringify(new URL('../inspector/server/workspace-projects.mjs', import.meta.url).href)}; createProjectStore({home:process.argv[1]}).register(process.argv[2]);`;
    const extra = join(home, 'other'); mkdirSync(extra); store.register(extra, true);
    await Promise.all([folder, folder, extra].map(path => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source, home, path], { stdio: 'pipe' });
      let error = ''; child.stderr.on('data', data => { error += data; });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(error)));
    })));
    assert.equal(store.list().length, 2);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('rapid project switches discard stale repository, task list and selected task responses', async () => {
  const app = readFileSync(new URL('../inspector/web-workspace/app.js', import.meta.url), 'utf8');
  const source = app.slice(app.indexOf('async function loadRepository('), app.indexOf('async function refresh('));
  const pending = [];
  const state = { projectId: 'a', projectEpoch: 0, selectedId: 'task-a', projectTasks: new Map() };
  let rendered = 0;
  const context = vm.createContext({ state, fetchJson: () => new Promise(resolve => pending.push(resolve)),
    renderRepository() { rendered++; }, renderTaskList() { rendered++; }, renderSelectedTask() { rendered++; },
    rememberSelection() {}, disposeTerminalViews() {} });
  vm.runInContext(source, context);
  const reads = [context.loadRepository(), context.loadTaskList(), context.loadSelectedTask()];
  // Return to the same project before the first request finishes (ABA race).
  state.projectEpoch += 2;
  pending.forEach(resolve => resolve({ id: 'stale' }));
  await Promise.all(reads);
  assert.equal(rendered, 0);
  assert.equal(state.selectedTask, undefined);
  assert.equal(state.projectTasks.size, 0);
});

test('project registry initializes without commits, deduplicates repository subfolders and pages directories', () => {
  const home = mkdtempSync(join(tmpdir(), 'project-registry-'));
  try {
    const folder = join(home, 'repo'); mkdirSync(folder);
    writeFileSync(join(folder, 'user.txt'), 'preserve me');
    const store = createProjectStore({ home });
    assert.throws(() => store.register(folder), /initialization/);
    const project = store.register(folder, true);
    assert.ok(existsSync(join(folder, '.git')));
    assert.equal(readFileSync(join(folder, 'user.txt'), 'utf8'), 'preserve me');
    assert.equal(existsSync(join(folder, '.git', 'refs', 'heads', 'main')), false);
    const child = join(folder, 'nested'); mkdirSync(child);
    assert.equal(store.register(child).id, project.id);
    assert.equal(createProjectStore({ home }).list().length, 1);
    assert.throws(() => store.get('../bad'), /Invalid/);
    const browser = join(home, 'browser'); mkdirSync(browser);
    for (let i = 0; i < 103; i++) mkdirSync(join(browser, `folder-${i}`));
    mkdirSync(join(browser, '.hidden')); writeFileSync(join(browser, 'file.txt'), 'not listed');
    const first = store.browse({ path: browser });
    assert.equal(first.entries.length, 100);
    assert.equal(first.nextOffset, 100);
    assert.equal(store.browse({ path: browser, offset: 100 }).entries.length, 3);
    assert.equal(store.browse({ path: browser, offset: 100, hidden: true }).entries.length, 4);
    assert.throws(() => store.browse({ path: browser, offset: -1 }), /Invalid/);
    rmSync(folder, { recursive: true });
    assert.equal(store.list()[0].available, false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('multi-project gateway isolates settings, task groups and raw PTY operations', { timeout: 120000 }, async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'project-http-')));
  const a = join(home, 'a'); const b = join(home, 'b'); mkdirSync(a); mkdirSync(b);
  let started;
  const groups = [];
  let post;
  try {
    started = await startWorkspace({ root: a, port: 0, projectHome: home });
    const headers = { 'Content-Type': 'application/json', 'x-coordinate-agents-capability': started.capability };
    post = async (id, action, params) => {
      const response = await fetch(`${started.url}${id ? `/api/projects/${id}` : ''}/api/action`, { method: 'POST', headers, body: JSON.stringify({ action, params }) });
      return { status: response.status, ...await response.json() };
    };
    const list = await (await fetch(`${started.url}/api/projects`, { headers })).json();
    const idA = list.defaultProjectId;
    assert.equal(list.projects[0].root, realpathSync(a));
    assert.equal((await fetch(`${started.url}/api/projects`)).status, 403);
    const added = await post(null, 'projectAdd', { path: b, initialize: true });
    assert.equal(added.ok, true); const idB = added.project.id;
    assert.equal((await fetch(`${started.url}/api/projects/not-a-project/api/repository`, { headers })).status, 400);
    const tabRoots = await Promise.all([idA, idB, idA, idB].map(async id => {
      const response = await fetch(`${started.url}/api/projects/${id}/api/repository`, { headers });
      assert.equal(response.status, 200); return (await response.json()).root;
    }));
    assert.deepEqual(tabRoots, [a, b, a, b]);
    assert.equal((await post(null, 'projectAdd', { path: b })).project.id, idB);
    assert.equal((await post(null, 'projectBrowse', { path: home, offset: -1 })).ok, false);
    assert.equal((await post(null, 'projectBrowse', { path: home, offset: 100001 })).ok, false);
    assert.equal((await post(null, 'projectBrowse', { path: join(home, 'missing') })).ok, false);
    assert.equal((await fetch(`${started.url}/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'projectBrowse', params: { path: home } }) })).status, 401);
    const denied = await fetch(`${started.url}/api/action`, { method: 'POST', headers: { ...headers, Origin: 'https://example.com' }, body: JSON.stringify({ action: 'projectBrowse', params: { path: home } }) });
    assert.equal(denied.status, 403);
    const save = await post(idA, 'workspaceSettingsSave', { codex: 'my-codex', antigravity: 'agy-proxy', args: [] });
    assert.equal(save.ok, true);
    assert.equal(readConfig(join(a, '.agent-bus')).agents.find(x => x.id === 'antigravity').command, 'agy-proxy');
    assert.notEqual(readConfig(join(b, '.agent-bus')).agents.find(x => x.id === 'antigravity').command, 'agy-proxy');
    assert.equal(existsSync(join(home, '.coordinate-agents', 'config.json')), false);
    for (const [id, folder] of [[idA, a], [idB, b]]) {
      const config = readConfig(join(folder, '.agent-bus'));
      for (const agent of config.agents) {
        const fixture = join(folder, `${agent.id}.cjs`);
        writeFileSync(fixture, `const fs = require('node:fs'); if(process.argv.includes('--version')) { console.log('fixture'); process.exit(0); } console.log(${JSON.stringify(agent.id === 'codex' ? 'Ask Codex to do anything' : '? for shortcuts')}); process.stdin.setRawMode?.(true); process.stdin.resume(); process.stdin.on('data', data => { fs.appendFileSync(${JSON.stringify(join(folder, `${agent.id}.log`))}, data.toString('hex')); });`);
        agent.command = process.execPath; agent.args = [fixture];
      }
      writeConfig(join(folder, '.agent-bus'), config);
      const created = await post(id, 'workspaceTaskCreate', { language: 'en' });
      assert.equal(created.ok, true, JSON.stringify(created));
      groups.push([id, created.workspaceTask]);
    }
    const session = groups[0][1].sessions.codex.sessionId;
    assert.equal((await post(idB, 'sessionWrite', { sessionId: session, input: 'wrong', submit: false })).ok, false);
    assert.equal((await post(idA, 'sessionWrite', { sessionId: session, input: 'XYZ', submit: false })).ok, true);
    assert.equal((await post(idA, 'sessionResize', { sessionId: session, cols: 90, rows: 25 })).ok, true);
    for (let i = 0; i < 30 && !readFileSync(join(a, 'codex.log'), 'utf8').includes('58595a'); i++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.match(readFileSync(join(a, 'codex.log'), 'utf8'), /58595a/);
    const tasksB = await (await fetch(`${started.url}/api/projects/${idB}/api/workspace-tasks`, { headers })).json();
    assert.equal(tasksB.length, 1); assert.equal(tasksB[0].id, groups[1][1].id);
    const legacy = await (await fetch(`${started.url}/api/workspace-tasks`)).json();
    assert.equal(legacy[0].id, groups[0][1].id);
    assert.equal((await post(idB, 'workspaceTaskClose', { workspaceTaskId: groups[0][1].id })).ok, false);
    assert.equal((await post(idA, 'workspaceTaskClose', { workspaceTaskId: groups[0][1].id })).ok, true);
    assert.equal((await post(idB, 'sessionWrite', { sessionId: groups[1][1].sessions.codex.sessionId, input: 'alive', submit: false })).ok, true);
  } finally {
    for (const [id, group] of groups) await post(id, 'workspaceTaskClose', { workspaceTaskId: group.id });
    if (started) { started.server.closeAllConnections(); await new Promise(resolve => started.server.close(resolve)); }
    rmSync(home, { recursive: true, force: true });
  }
});
