import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import * as runtime from '../skills/coordinate-agents/scripts/workspace-task-runtime.mjs';
import { fixtureIdentityAuthority } from './support/native-identity-authority.mjs';
import { getExecutionSessionManager } from '../skills/coordinate-agents/scripts/session-service.mjs';
import { invokeRuntimeOperation } from '../skills/coordinate-agents/scripts/workspace-services.mjs';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const script = pathToFileURL(join(process.cwd(), 'skills/coordinate-agents/scripts/workspace-task-runtime.mjs')).href;
const authorityScript = pathToFileURL(join(process.cwd(), 'test/support/native-identity-authority.mjs')).href;
const reason = expected => error => error?.details?.reason === expected;

function fixture(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'native-identity-store-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['workspace-tasks', 'sessions', 'locks', 'tmp']) mkdirSync(join(root, '.agent-bus', directory), { recursive: true });
  const authority = fixtureIdentityAuthority();
  const taskPath = id => join(root, '.agent-bus/workspace-tasks', `${id}.json`);
  const raw = id => JSON.parse(readFileSync(taskPath(id), 'utf8'));
  const save = task => writeFileSync(taskPath(task.id), JSON.stringify(task));
  const session = (task, slot, generation = randomUUID()) => {
    const id = `session_${randomUUID().replaceAll('-', '')}`;
    const record = { schemaVersion: 1, id, agent: slot, adapter: `${slot === 'antigravity' ? 'antigravity' : 'codex'}-cli`,
      command: 'storage-fixture', cwd: root, state: 'running', pid: process.pid, hostPid: process.pid,
      taskId: task.id, subtaskId: slot, runtimeGeneration: generation, createdAt: new Date().toISOString() };
    writeFileSync(join(root, '.agent-bus/sessions', `${id}.json`), JSON.stringify(record));
    task.sessions[slot].sessionId = id;
    task.sessions[slot].runtimeGeneration = generation;
    save(task);
    return record;
  };
  const task = () => {
    const id = `workspace-${randomUUID()}`;
    const value = { schemaVersion: 1, id, title: 'Storage fixture', status: 'RUNNING', promptVersion: 'fixture',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sessions: {
        codex: { slot: 'codex', agent: 'codex', role: 'planner-reviewer', sessionId: null },
        antigravity: { slot: 'antigravity', agent: 'antigravity', role: 'implementer', sessionId: null },
      }, cooperation: { status: 'IDLE', roundId: null, revision: 0, summary: '', updatedAt: null }, collaborationEvents: [] };
    session(value, 'codex'); session(value, 'antigravity');
    return value;
  };
  const claims = (task, slot = 'codex', extra = {}) => ({ schemaVersion: 1, projectRoot: root, taskId: task.id, slot,
    sessionId: task.sessions[slot].sessionId, runtimeGeneration: task.sessions[slot].runtimeGeneration,
    adapter: slot === 'codex' ? 'codex-cli' : 'antigravity-cli', conversationId: A,
    source: { id: 'fixture-authority', version: '1' }, observedAt: new Date().toISOString(),
    sequence: 1, expectedRevision: 0, ...extra });
  return { root, task, taskPath, raw, save, session, claims, authority,
    store: () => runtime.createWorkspaceNativeIdentityStore({ root, verifyAttestation: authority.verifyAttestation }) };
}

test('legacy and new unbound default slots expose UNAVAILABLE without inventing native IDs', async t => {
  const f = fixture(t), task = f.task();
  const before = readFileSync(f.taskPath(task.id), 'utf8');
  const view = await runtime.readWorkspaceTask(f.root, task.id);
  assert.equal(view.sessions.codex.nativeIdentity.binding, null);
  assert.equal(view.sessions.codex.nativeIdentity.verification.state, 'UNAVAILABLE');
  assert.equal(view.sessions.antigravity.nativeIdentity.binding, null);
  assert.equal(f.raw(task.id).nativeConversations, undefined);
  assert.equal(readFileSync(f.taskPath(task.id), 'utf8'), before, 'reading must not migrate or verify a legacy record');
});

test('trusted binding persists in the Task, while fresh readers never revive current verification', async t => {
  const f = fixture(t), task = f.task();
  assert.equal(typeof runtime.createWorkspaceNativeIdentityStore, 'function');
  const store = f.store();
  await store.observe(f.authority.issue(f.claims(task)));
  const stored = f.raw(task.id).nativeConversations.codex;
  assert.equal(stored.binding.conversationId, A);
  assert.equal(stored.binding.runtimeGeneration, task.sessions.codex.runtimeGeneration);
  assert.equal(stored.projectRoot, f.root);
  assert.equal(stored.taskId, task.id);
  assert.equal(stored.revision, 1);
  assert.equal(stored.verification, undefined, 'live verification must not be serialized');
  const view = await runtime.readWorkspaceTask(f.root, task.id);
  assert.equal(view.sessions.codex.nativeIdentity.binding.conversationId, A);
  assert.equal(view.sessions.codex.nativeIdentity.verification.state, 'UNAVAILABLE');
  const child = await runChild(`import { readWorkspaceTask } from ${JSON.stringify(script)};
    console.log(JSON.stringify((await readWorkspaceTask(${JSON.stringify(f.root)}, ${JSON.stringify(task.id)})).sessions.codex.nativeIdentity));`);
  assert.equal(child.code, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).binding.conversationId, A);
  assert.equal(JSON.parse(child.stdout).verification.state, 'UNAVAILABLE');
});

test('identity changes latch a conflict and never replace the original binding, including a new Runtime', async t => {
  const f = fixture(t), task = f.task(), store = f.store();
  await store.observe(f.authority.issue(f.claims(task)));
  await store.observe(f.authority.issue(f.claims(task, 'codex', { conversationId: B, sequence: 2, expectedRevision: 1 })));
  let record = f.raw(task.id).nativeConversations.codex;
  assert.equal(record.binding.conversationId, A);
  assert.equal(record.firstConflict.conversationId, B);
  assert.equal((await runtime.readWorkspaceTask(f.root, task.id)).sessions.codex.nativeIdentity.bindingState, 'IDENTITY_CHANGED');
  const current = f.raw(task.id); f.session(current, 'codex');
  await store.observe(f.authority.issue(f.claims(current, 'codex', { conversationId: C, expectedRevision: 2 })));
  record = f.raw(task.id).nativeConversations.codex;
  assert.equal(record.binding.conversationId, A);
  assert.equal(record.firstConflict.conversationId, B);
  assert.equal(record.lastObservation.conversationId, C);
  await store.observe(f.authority.issue(f.claims(current, 'codex', { conversationId: A, sequence: 2, expectedRevision: 3 })));
  assert.equal((await runtime.readWorkspaceTask(f.root, task.id)).sessions.codex.nativeIdentity.bindingState, 'IDENTITY_CHANGED');
});

test('old generation, revision, sequence and exited/closed lifecycle events cannot change facts', async t => {
  const f = fixture(t), task = f.task(), store = f.store();
  const old = f.claims(task);
  await store.observe(f.authority.issue(old));
  await assert.rejects(store.observe(f.authority.issue({ ...old, conversationId: B })), reason('REVISION_MISMATCH'));
  await assert.rejects(store.observe(f.authority.issue({ ...old, expectedRevision: 1 })), reason('OUT_OF_ORDER'));
  const current = f.raw(task.id); f.session(current, 'codex');
  await assert.rejects(store.observe(f.authority.issue({ ...old, expectedRevision: 1, sequence: 2 })), reason('RUNTIME_MISMATCH'));
  const path = join(f.root, '.agent-bus/sessions', `${current.sessions.codex.sessionId}.json`);
  const session = JSON.parse(readFileSync(path)); session.state = 'exited'; writeFileSync(path, JSON.stringify(session));
  await assert.rejects(store.observe(f.authority.issue(f.claims(current, 'codex', { expectedRevision: 1 }))), reason('RUNTIME_UNAVAILABLE'));
  current.status = 'CLOSED'; f.save(current);
  await assert.rejects(store.observe(f.authority.issue(f.claims(current, 'codex', { expectedRevision: 1 }))), reason('TASK_UNAVAILABLE'));
  assert.equal(f.raw(task.id).nativeConversations.codex.binding.conversationId, A);
});

test('source verification finishes before the locked CAS, so a delayed event cannot follow a replaced Session', async t => {
  const f = fixture(t), task = f.task();
  let resolve;
  const delayed = runtime.createWorkspaceNativeIdentityStore({ root: f.root,
    verifyAttestation: () => new Promise(done => { resolve = done; }) });
  const pending = delayed.observe({});
  const old = f.claims(task), current = f.raw(task.id); f.session(current, 'codex');
  resolve(old);
  await assert.rejects(pending, reason('RUNTIME_MISMATCH'));
  assert.equal(f.raw(task.id).nativeConversations, undefined);
});

test('project, Task, Slot, adapter and Session ownership are checked independently of source trust', async t => {
  const f = fixture(t), a = f.task(), b = f.task(), store = f.store();
  const cases = [
    [{ projectRoot: f.root + '-other' }, 'PROJECT_MISMATCH'],
    [{ taskId: b.id }, 'RUNTIME_MISMATCH'],
    [{ slot: 'antigravity', adapter: 'antigravity-cli' }, 'RUNTIME_MISMATCH'],
    [{ slot: 'terminal1' }, 'INVALID_OBSERVATION'],
    [{ slot: ['codex'] }, 'INVALID_OBSERVATION'],
    [{ adapter: 'generic-cli' }, 'INVALID_OBSERVATION'],
    [{ runtimeGeneration: randomUUID() }, 'RUNTIME_MISMATCH'],
  ];
  for (const [extra, expected] of cases) await assert.rejects(store.observe(f.authority.issue(f.claims(a, 'codex', extra))), reason(expected));
  assert.equal(f.raw(a.id).nativeConversations, undefined);
  assert.equal(f.raw(b.id).nativeConversations, undefined);
});

test('forged, malformed, stale and future observations fail without writing prompt or account data', async t => {
  const f = fixture(t), task = f.task(), store = f.store();
  const production = runtime.createWorkspaceNativeIdentityStore({ root: f.root });
  await assert.rejects(production.observe({ ...f.claims(task), trusted: true }), reason('UNTRUSTED_SOURCE'));
  await assert.rejects(store.observe({ ...f.claims(task), verified: true }), reason('UNTRUSTED_SOURCE'));
  for (const conversationId of ['', 'not-a-uuid', [], 123, '00000000-0000-0000-0000-000000000000']) {
    await assert.rejects(store.observe(f.authority.issue(f.claims(task, 'codex', { conversationId }))), reason('INVALID_OBSERVATION'));
  }
  for (const observedAt of ['invalid', new Date(Date.now() - 60_000).toISOString(), new Date(Date.now() + 60_000).toISOString()]) {
    await assert.rejects(store.observe(f.authority.issue(f.claims(task, 'codex', { observedAt }))), reason('INVALID_OBSERVATION'));
  }
  await assert.rejects(store.observe(f.authority.issue(f.claims(task, 'codex', { prompt: 'SECRET_PROMPT', email: 'PRIVATE_ACCOUNT' }))), reason('INVALID_OBSERVATION'));
  assert.equal(f.raw(task.id).nativeConversations, undefined);
  assert.doesNotMatch(readFileSync(f.taskPath(task.id), 'utf8'), /SECRET_PROMPT|PRIVATE_ACCOUNT|verified/);
});

test('Task/Slot bindings remain separate and one adapter conversation cannot be occupied by two Tasks', async t => {
  const f = fixture(t), a = f.task(), b = f.task(), store = f.store();
  await store.observe(f.authority.issue(f.claims(a)));
  await store.observe(f.authority.issue(f.claims(a, 'antigravity', { conversationId: B })));
  await assert.rejects(store.observe(f.authority.issue(f.claims(b))), reason('CONVERSATION_ALREADY_BOUND'));
  await store.observe(f.authority.issue(f.claims(b, 'codex', { conversationId: C })));
  assert.equal(f.raw(a.id).nativeConversations.codex.binding.conversationId, A);
  assert.equal(f.raw(a.id).nativeConversations.antigravity.binding.conversationId, B);
  assert.equal(f.raw(b.id).nativeConversations.codex.binding.conversationId, C);
});

test('two processes racing the same revision produce one atomic binding and reject the loser', async t => {
  const f = fixture(t), task = f.task();
  const worker = claims => `import { createWorkspaceNativeIdentityStore } from ${JSON.stringify(script)};
    import { fixtureIdentityAuthority } from ${JSON.stringify(authorityScript)};
    const authority = fixtureIdentityAuthority();
    const store = createWorkspaceNativeIdentityStore({root:${JSON.stringify(f.root)},verifyAttestation:authority.verifyAttestation});
    try { await store.observe(authority.issue(${JSON.stringify(claims)})); console.log('accepted'); }
    catch(e) { console.log(e.details?.reason); }`;
  const results = await Promise.all([runChild(worker(f.claims(task))), runChild(worker(f.claims(task, 'codex', { conversationId: B })))]);
  assert.deepEqual(results.map(r => r.code), [0, 0]);
  assert.deepEqual(results.map(r => r.stdout.trim()).sort(), ['REVISION_MISMATCH', 'accepted'].sort());
  const record = f.raw(task.id);
  assert.equal(record.nativeConversations.codex.revision, 1);
  assert.ok([A, B].includes(record.nativeConversations.codex.binding.conversationId));
  assert.deepEqual(record.cooperation, task.cooperation);
  assert.deepEqual(record.collaborationEvents, []);
});

test('copied project identities and linked Task paths are rejected rather than trusted', async t => {
  const f = fixture(t), task = f.task(), store = f.store();
  await store.observe(f.authority.issue(f.claims(task)));
  const copy = f.raw(task.id); copy.nativeConversations.codex.projectRoot = f.root + '-other'; f.save(copy);
  await assert.rejects(runtime.readWorkspaceTask(f.root, task.id));
  // Use a separately owned target, never touch global or repository data.
  const other = fixture(t), target = other.task();
  rmSync(f.taskPath(task.id));
  if (process.platform === 'win32') linkSync(other.taskPath(target.id), f.taskPath(task.id));
  else symlinkSync(other.taskPath(target.id), f.taskPath(task.id), 'file');
  await assert.rejects(store.observe(f.authority.issue(f.claims(task))));
  assert.equal(other.raw(target.id).nativeConversations, undefined);
});

test('a stale Close snapshot retains an identity committed while Session shutdown was pending', async t => {
  const f = fixture(t), task = f.task(), store = f.store();
  let resumeClose, enteredClose;
  const waiting = new Promise(resolve => { enteredClose = resolve; });
  const gate = new Promise(resolve => { resumeClose = resolve; });
  // Only replace external Session shutdown, not Task persistence or its locks.
  t.mock.method(getExecutionSessionManager(), 'close', async (_root, id) => {
    enteredClose(); await gate;
    const path = join(f.root, '.agent-bus/sessions', `${id}.json`);
    const session = JSON.parse(readFileSync(path)); session.state = 'exited'; writeFileSync(path, JSON.stringify(session));
    return session;
  });
  const pending = runtime.runtimeWorkspaceTaskClose({ root: f.root, workspaceTaskId: task.id });
  await waiting;
  try { await store.observe(f.authority.issue(f.claims(task))); }
  finally { resumeClose(); }
  const closed = (await pending).workspaceTask;
  assert.equal(closed.status, 'CLOSED');
  assert.equal(closed.sessions.codex.nativeIdentity.binding.conversationId, A);
  assert.equal(f.raw(task.id).nativeConversations.codex.binding.conversationId, A);
  assert.deepEqual(f.raw(task.id).cooperation, task.cooperation);
  assert.deepEqual(f.raw(task.id).collaborationEvents, []);
});

test('different Slot writers preserve each other and the same UUID race across Tasks cannot double bind', async t => {
  const f = fixture(t), a = f.task(), b = f.task();
  const worker = claims => `import { createWorkspaceNativeIdentityStore } from ${JSON.stringify(script)};
    import { fixtureIdentityAuthority } from ${JSON.stringify(authorityScript)};
    const auth = fixtureIdentityAuthority();
    try { await createWorkspaceNativeIdentityStore({root:${JSON.stringify(f.root)},verifyAttestation:auth.verifyAttestation})
      .observe(auth.issue(${JSON.stringify(claims)})); console.log('accepted'); }
    catch(e) { console.log(e.details?.reason); }`;
  const results = await Promise.all([
    runChild(worker(f.claims(a))),
    runChild(worker(f.claims(a, 'antigravity', { conversationId: B }))),
    runChild(worker(f.claims(b))),
  ]);
  assert.ok(results.every(result => result.code === 0), JSON.stringify(results));
  assert.equal(results.filter(result => result.stdout.trim() === 'accepted').length, 2);
  assert.equal(results.filter(result => result.stdout.trim() === 'CONVERSATION_ALREADY_BOUND').length, 1);
  assert.equal(f.raw(a.id).nativeConversations.antigravity.binding.conversationId, B);
  const codexBindings = [f.raw(a.id), f.raw(b.id)].flatMap(task => task.nativeConversations?.codex ? [task.nativeConversations.codex.binding] : []);
  assert.equal(codexBindings.length, 1);
  assert.equal(codexBindings[0].conversationId, A);
});

test('legacy runtime metadata remains readable but cannot attest until it has a real new generation', async t => {
  const f = fixture(t), task = f.task(), store = f.store();
  const claims = f.claims(task);
  delete task.sessions.codex.runtimeGeneration; f.save(task);
  assert.equal((await runtime.readWorkspaceTask(f.root, task.id)).sessions.codex.nativeIdentity.verification.state, 'UNAVAILABLE');
  await assert.rejects(store.observe(f.authority.issue(claims)), reason('RUNTIME_MISMATCH'));
  assert.equal(f.raw(task.id).nativeConversations, undefined);
});

test('public Runtime operations cannot configure a verifier or submit an identity event', async t => {
  const f = fixture(t), task = f.task();
  await assert.rejects(invokeRuntimeOperation('workspaceNativeIdentityObserve', { root: f.root, ...f.claims(task), trusted: true }), /Unknown Workspace operation/);
  const auth = fixtureIdentityAuthority(), other = fixtureIdentityAuthority();
  const token = auth.issue(f.claims(task));
  const receiver = runtime.createWorkspaceNativeIdentityStore({ root: f.root, verifyAttestation: other.verifyAttestation });
  await assert.rejects(receiver.observe(token), reason('UNTRUSTED_SOURCE'));
  assert.equal(f.raw(task.id).nativeConversations, undefined);
});

test('persisted verification flags and mismatched Task payload identity are not authoritative', async t => {
  const f = fixture(t), task = f.task(), store = f.store();
  await store.observe(f.authority.issue(f.claims(task)));
  const raw = f.raw(task.id);
  raw.nativeConversations.codex.verification = { state: 'VERIFIED' }; f.save(raw);
  await assert.rejects(runtime.readWorkspaceTask(f.root, task.id));
  const other = f.task();
  writeFileSync(f.taskPath(task.id), JSON.stringify(other));
  await assert.rejects(store.observe(f.authority.issue(f.claims(task))), reason('RUNTIME_MISMATCH'));
  assert.equal(f.raw(other.id).nativeConversations, undefined);
});

test('Custom Tasks cannot acquire native capability even from an authenticated storage fixture', async t => {
  const f = fixture(t), task = f.task();
  const claims = f.claims(task);
  task.mode = 'custom'; task.cooperation = null;
  task.custom = { terminal1: { command: process.execPath }, terminal2: { command: process.execPath },
    prompts: { project: '', terminal1: '', terminal2: '' } };
  task.sessions = Object.fromEntries(['terminal1', 'terminal2'].map((slot, index) => [slot,
    { slot, agent: 'workspace-custom', role: 'custom', sessionId: index === 0 ? claims.sessionId : null }]));
  f.save(task);
  const view = await runtime.readWorkspaceTask(f.root, task.id);
  assert.equal(view.sessions.terminal1.nativeIdentity, undefined);
  await assert.rejects(f.store().observe(f.authority.issue(claims)), reason('TASK_UNAVAILABLE'));
  assert.equal(f.raw(task.id).nativeConversations, undefined);
});

test('a Task cannot retain an orphaned generation after dropping its Session association', async t => {
  const f = fixture(t), task = f.task();
  task.sessions.codex.sessionId = null; f.save(task);
  await assert.rejects(runtime.readWorkspaceTask(f.root, task.id));
});

test('config lock contenders cannot steal an unpublished owner or a live owner older than staleMs', async t => {
  const f = fixture(t);
  const lock = join(f.root, '.agent-bus/locks/config'); mkdirSync(lock);
  const config = pathToFileURL(join(process.cwd(), 'skills/coordinate-agents/scripts/config.mjs')).href;
  const worker = `import { acquireConfigLock } from ${JSON.stringify(config)};
    try { const release = acquireConfigLock(${JSON.stringify(join(f.root, '.agent-bus'))}, {timeoutMs:120,staleMs:1});
      console.log('stolen'); release(); } catch { console.log('blocked'); }`;
  let result = await runChild(worker);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'blocked', 'mkdir-to-owner publication must be exclusive');
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ owner: randomUUID(), pid: process.pid, host: hostname() }));
  const old = new Date(Date.now() - 60_000); utimesSync(lock, old, old);
  result = await runChild(worker);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'blocked', 'age alone cannot revoke a live writer');
});

test('dead config owners can be recovered by competing processes without losing a Slot update', async t => {
  const f = fixture(t), task = f.task();
  const exited = await runChild('');
  const lock = join(f.root, '.agent-bus/locks/config'); mkdirSync(lock);
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ owner: randomUUID(), pid: exited.pid, host: hostname() }));
  const worker = claims => `import { createWorkspaceNativeIdentityStore } from ${JSON.stringify(script)};
    import { fixtureIdentityAuthority } from ${JSON.stringify(authorityScript)};
    const auth = fixtureIdentityAuthority();
    await createWorkspaceNativeIdentityStore({root:${JSON.stringify(f.root)},verifyAttestation:auth.verifyAttestation})
      .observe(auth.issue(${JSON.stringify(claims)}));`;
  const results = await Promise.all([runChild(worker(f.claims(task))), runChild(worker(f.claims(task, 'antigravity', { conversationId: B })))]);
  assert.ok(results.every(result => result.code === 0), JSON.stringify(results));
  assert.equal(f.raw(task.id).nativeConversations.codex.binding.conversationId, A);
  assert.equal(f.raw(task.id).nativeConversations.antigravity.binding.conversationId, B);
});

function runChild(code) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject); child.once('close', code => resolve({ code, stdout, stderr, pid: child.pid }));
  });
}
