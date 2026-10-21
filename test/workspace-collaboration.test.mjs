import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { dispatchWorkspaceTask, reportWorkspaceTask, readWorkspaceTask, readWorkspaceTasks, validateWorkspaceTaskRecord, runtimeWorkspaceArchivesClear } from '../skills/coordinate-agents/scripts/workspace-task-runtime.mjs';
import { startWorkspace } from './support/workspace-server.mjs';

function fixture(t, id = 'workspace-timeline123') {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'collaboration-')));
  for (const directory of ['workspace-tasks', 'sessions', 'tmp']) mkdirSync(join(root, '.agent-bus', directory), { recursive: true });
  const sessions = Object.fromEntries(['codex', 'antigravity'].map(agent => [agent, {
    slot: agent, agent, role: agent === 'codex' ? 'planner-reviewer' : 'implementer', sessionId: `session_${agent}12345678`,
  }]));
  const record = { schemaVersion: 1, id, mode: 'default', title: 'Timeline', status: 'RUNNING', promptVersion: 'test',
    createdAt: '2026-10-16T00:00:00Z', updatedAt: '2026-10-16T00:00:00Z', sessions };
  const file = join(root, '.agent-bus/workspace-tasks', `${id}.json`);
  writeFileSync(file, JSON.stringify(record));
  for (const [agent, session] of Object.entries(sessions)) writeFileSync(join(root, '.agent-bus/sessions', `${session.sessionId}.json`), JSON.stringify({ id: session.sessionId, command: 'unused', agent, taskId: id, cwd: root, state: 'idle' }));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, id, file, record };
}
const quiet = { notify: () => {} };
const report = (f, status, round = 'round-first', summary = '') => reportWorkspaceTask(f.root, f.id, status, round, summary, quiet);
const history = async f => (await readWorkspaceTask(f.root, f.id)).collaborationEvents;

function seedHistory(f, count) {
  const statuses = ['SENT', 'WORKING', 'DONE', 'REVIEWING', 'CHANGES_REQUESTED'];
  const events = Array.from({ length: count }, (_, i) => ({ taskId: f.id, roundId: `round-${Math.floor(i / 5)}`,
    revision: i * 2 + 1, timestamp: '2026-10-16T00:00:00Z', status: statuses[i % 5],
    fromStatus: i ? statuses[(i - 1) % 5] : 'IDLE', agent: [1, 2].includes(i % 5) ? 'antigravity' : 'codex', summary: `Event ${i}` }));
  const last = events.at(-1);
  writeFileSync(f.file, JSON.stringify({ ...f.record, collaborationEvents: events,
    cooperation: { status: last.status, roundId: last.roundId, revision: last.revision, summary: last.summary, updatedAt: last.timestamp } }));
  return events;
}

test('long legacy histories migrate to bounded pages without losing events or revision gaps', async t => {
  const f = fixture(t), original = seedHistory(f, 390);
  await dispatchWorkspaceTask(f.root, f.id, 'round-next', async () => {});
  await report(f, 'WORKING', 'round-next');
  await report(f, 'WORKING', 'round-next', 'Progress only');
  await report(f, 'DONE', 'round-next');
  const recent = await readWorkspaceTask(f.root, f.id);
  assert.ok(recent.collaborationEvents.length <= 128, 'normal reads must carry bounded history');
  assert.equal(recent.cooperation.revision, 783, 'migration cannot reset or renumber revisions');
  assert.deepEqual(recent.collaborationHistory, { archivedEvents: 384, previousPage: 3 });
  const pages = [];
  for (let page = recent.collaborationHistory.previousPage; page; ) {
    const value = await readWorkspaceTask(f.root, f.id, { historyPage: page });
    assert.equal(value.collaborationEvents.length, 128);
    pages.unshift(...value.collaborationEvents);
    page = value.collaborationHistory.previousPage;
  }
  const all = [...pages, ...recent.collaborationEvents];
  assert.deepEqual(all.slice(0, 390), original);
  assert.deepEqual(all.slice(390).map(e => e.revision), [780, 781, 783]);
  assert.ok(JSON.parse(readFileSync(f.file)).collaborationEvents.length <= 128);
  assert.equal((await readWorkspaceTasks(f.root))[0].collaborationEvents, undefined);
  await assert.rejects(readWorkspaceTask(f.root, f.id, { historyPage: 4 }), /page/i);
  await assert.rejects(readWorkspaceTask(f.root, f.id, { historyPage: '../1' }), /page/i);
  for (let i = 0; i < 2; i++) {
    const server = await startWorkspace({ root: f.root, port: 0 });
    try {
      const response = await fetch(`${server.url.replace('localhost', '127.0.0.1')}/api/workspace-tasks/${f.id}?historyPage=1`,
        { headers: { 'x-coordinate-agents-capability': server.capability } });
      assert.equal(response.status, 200);
      const value = await response.json(); assert.deepEqual(value.collaborationEvents, original.slice(0, 128));
      assert.equal(value.collaborationHistory.previousPage, null);
    } finally { await new Promise(done => { server.server.close(done); server.server.closeAllConnections?.(); }); }
  }
});

test('failed Task commits cannot publish archive pages and a retry preserves all events once', async t => {
  const f = fixture(t), original = seedHistory(f, 128), before = readFileSync(f.file, 'utf8');
  const code = `
    import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => { if (to === process.argv[3]) throw Error('injected Task commit failure'); return rename(from, to); };
    syncBuiltinESMExports();
    const { reportWorkspaceTask } = await import(${JSON.stringify(new URL('../skills/coordinate-agents/scripts/workspace-task-runtime.mjs', import.meta.url).href)});
    try { await reportWorkspaceTask(process.argv[1], process.argv[2], 'REVIEWING', 'round-25', '', { notify: () => {} }); process.exitCode = 1; }
    catch (error) { if (!error.message.includes('injected Task commit failure')) throw error; }
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, f.root, f.id, f.file], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); assert.equal(readFileSync(f.file, 'utf8'), before);
  assert.deepEqual(await history(f), original);
  await assert.rejects(readWorkspaceTask(f.root, f.id, { historyPage: 1 }), /page/i);
  await report(f, 'REVIEWING', 'round-25');
  const recent = await readWorkspaceTask(f.root, f.id);
  assert.equal(recent.collaborationEvents.length, 1);
  assert.deepEqual((await readWorkspaceTask(f.root, f.id, { historyPage: 1 })).collaborationEvents, original);
  assert.equal(recent.collaborationEvents[0].revision, 256);
  assert.equal(recent.collaborationHistory.archivedEvents, 128);
});

test('normal reads skip archived pages, explicit paging rejects corruption and linked files, and clearing removes history', async t => {
  const f = fixture(t); seedHistory(f, 390);
  await dispatchWorkspaceTask(f.root, f.id, 'round-next', async () => {});
  const directory = join(f.root, '.agent-bus/workspace-tasks/collaboration-history', f.id), pageFile = join(directory, '1.json');
  assert.equal(readdirSync(directory).length, 3);
  const page = readFileSync(pageFile, 'utf8');
  writeFileSync(pageFile, 'corrupt');
  assert.equal((await readWorkspaceTask(f.root, f.id)).collaborationHistory.archivedEvents, 384);
  assert.equal((await readWorkspaceTasks(f.root)).length, 1, 'polling must not parse archived pages');
  await assert.rejects(readWorkspaceTask(f.root, f.id, { historyPage: 1 }));
  rmSync(pageFile); const outside = join(f.root, 'private.json'); writeFileSync(outside, page);
  symlinkSync(outside, pageFile);
  await assert.rejects(readWorkspaceTask(f.root, f.id, { historyPage: 1 }), /link|path/i);
  const record = JSON.parse(readFileSync(f.file)); record.status = 'CLOSED'; record.archivedAt = '2026-10-16T00:00:00Z';
  writeFileSync(f.file, JSON.stringify(record));
  for (const session of Object.values(record.sessions)) {
    const file = join(f.root, '.agent-bus/sessions', `${session.sessionId}.json`);
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file)), state: 'exited' }));
  }
  assert.equal((await runtimeWorkspaceArchivesClear({ root: f.root })).deletedTasks, 1);
  assert.throws(() => readdirSync(directory), /ENOENT/);
  assert.equal(readFileSync(outside, 'utf8'), page, 'history cleanup must never follow a linked page');
});

test('concurrent report processes cross an archive boundary without duplicating or replacing committed pages', async t => {
  const f = fixture(t), original = seedHistory(f, 128);
  const code = `import { reportWorkspaceTask } from ${JSON.stringify(new URL('../skills/coordinate-agents/scripts/workspace-task-runtime.mjs', import.meta.url).href)};
    await reportWorkspaceTask(process.argv[1], process.argv[2], 'REVIEWING', 'round-25', '', { notify: () => {} });`;
  const child = () => new Promise((done, reject) => {
    const process = spawn(globalThis.process.execPath, ['--input-type=module', '-e', code, f.root, f.id], { stdio: ['ignore', 'ignore', 'pipe'] });
    let error = ''; process.stderr.on('data', chunk => { error += chunk; }); process.on('error', reject);
    process.on('exit', status => status === 0 ? done() : reject(Error(error)));
  });
  await Promise.all([child(), child(), child()]);
  const pageFile = join(f.root, '.agent-bus/workspace-tasks/collaboration-history', f.id, '1.json');
  const before = readFileSync(pageFile, 'utf8');
  assert.deepEqual((await readWorkspaceTask(f.root, f.id, { historyPage: 1 })).collaborationEvents, original);
  assert.deepEqual((await history(f)).map(event => [event.status, event.revision]), [['REVIEWING', 256]]);
  await report(f, 'APPROVED', 'round-25');
  assert.equal(readFileSync(pageFile, 'utf8'), before, 'later receipts must not rewrite committed history pages');
});

test('formal transitions persist atomically with revisions, keep rework rounds and survive fresh processes', async t => {
  const f = fixture(t);
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  for (const status of ['WORKING', 'DONE', 'REVIEWING', 'CHANGES_REQUESTED']) await report(f, status);
  await dispatchWorkspaceTask(f.root, f.id, 'round-second', async () => {});
  for (const status of ['WORKING', 'DONE', 'REVIEWING', 'CHANGES_REQUESTED']) await report(f, status, 'round-second');
  await dispatchWorkspaceTask(f.root, f.id, 'round-third', async () => {});
  for (const status of ['WORKING', 'DONE', 'REVIEWING', 'APPROVED']) await report(f, status, 'round-third', 'Test receipt');
  const events = await history(f);
  assert.deepEqual(events.map(e => e.status), ['SENT', 'WORKING', 'DONE', 'REVIEWING', 'CHANGES_REQUESTED', 'SENT', 'WORKING', 'DONE', 'REVIEWING', 'CHANGES_REQUESTED', 'SENT', 'WORKING', 'DONE', 'REVIEWING', 'APPROVED']);
  assert.deepEqual(events.map(e => e.roundId), [...Array(5).fill('round-first'), ...Array(5).fill('round-second'), ...Array(5).fill('round-third')]);
  assert.deepEqual(events.slice(0, 5).map(e => e.agent), ['codex', 'antigravity', 'antigravity', 'codex', 'codex']);
  for (const [i, e] of events.entries()) {
    assert.equal(e.taskId, f.id); assert.equal(e.revision, i + 1);
    assert.equal(e.fromStatus, i ? events[i - 1].status : 'IDLE');
    assert.ok(Number.isFinite(Date.parse(e.timestamp)));
  }
  const persisted = JSON.parse(readFileSync(f.file));
  assert.equal(persisted.cooperation.revision, events.at(-1).revision);
  assert.equal(persisted.cooperation.updatedAt, events.at(-1).timestamp);
  assert.equal((await readWorkspaceTasks(f.root))[0].collaborationEvents, undefined, 'list polling must not carry full history');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import {readWorkspaceTask} from ${JSON.stringify(new URL('../skills/coordinate-agents/scripts/workspace-task-runtime.mjs', import.meta.url).href)}; console.log(JSON.stringify((await readWorkspaceTask(process.argv[1], process.argv[2])).collaborationEvents));`, f.root, f.id], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); assert.deepEqual(JSON.parse(child.stdout), events);
});

test('duplicate receipts and summary edits never manufacture transitions; stale and failed writes leave history unchanged', async t => {
  const f = fixture(t);
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  await Promise.all([report(f, 'WORKING'), report(f, 'WORKING')]);
  await report(f, 'WORKING', 'round-first', 'changed');
  await report(f, 'DONE');
  assert.deepEqual((await history(f)).map(e => [e.status, e.revision]), [['SENT', 1], ['WORKING', 2], ['DONE', 4]]);
  const before = readFileSync(f.file, 'utf8');
  await assert.rejects(report(f, 'REVIEWING', 'round-stale'), /roundId/);
  await assert.rejects(dispatchWorkspaceTask(f.root, f.id, 'round-next', async () => { throw Error('no delivery'); }), /delivery/);
  assert.equal(readFileSync(f.file, 'utf8'), before);
  rmSync(join(f.root, '.agent-bus/tmp'), { recursive: true }); writeFileSync(join(f.root, '.agent-bus/tmp'), 'blocked');
  await assert.rejects(report(f, 'REVIEWING'));
  assert.equal(readFileSync(f.file, 'utf8'), before);
});

test('history never infers completion from sessions or reconstructs legacy snapshots and rejects corrupted history', async t => {
  const f = fixture(t);
  assert.deepEqual(await history(f), []);
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  const before = await history(f);
  for (const state of ['idle', 'exited', 'failed']) {
    const sessionFile = join(f.root, '.agent-bus/sessions', `${f.record.sessions.antigravity.sessionId}.json`);
    const session = JSON.parse(readFileSync(sessionFile)); writeFileSync(sessionFile, JSON.stringify({ ...session, state }));
    assert.deepEqual(await history(f), before);
  }
  const value = JSON.parse(readFileSync(f.file)); delete value.collaborationEvents;
  writeFileSync(f.file, JSON.stringify(value));
  assert.deepEqual(await history(f), [], 'legacy snapshot is not an event log');
  assert.throws(() => validateWorkspaceTaskRecord({ ...value, collaborationEvents: [{ status: 'DONE' }] }), /collaboration/i);
});

test('summaries are single-line, credential-redacted, Unicode bounded and do not include dispatch instructions', async t => {
  const f = fixture(t);
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  const secret = '\x1b[31mDone\x1b[0m\nTOKEN="abc def" Authorization: Basic dXNlcjpwYXNz https://alice:pwd@example.com/path?api_key=hidden ghp_123456789012345678901234567890123456 sk-proj-123456789012345678901234567890';
  await report(f, 'WORKING', 'round-first', secret);
  await report(f, 'DONE', 'round-first', '🙂'.repeat(400));
  const events = await history(f);
  assert.equal(events[0].summary, '');
  assert.doesNotMatch(JSON.stringify(events), /abc|def\"|dXNlcjpwYXNz|alice|pwd|hidden|ghp_|sk-proj-|\\u001b/);
  assert.doesNotMatch(events[1].summary, /[\r\n\x00-\x1f\x7f]/);
  assert.ok(Array.from(events[2].summary).length <= 240);
  assert.doesNotMatch(events[2].summary, /\uFFFD/);
});

test('existing task API returns isolated history after server restart, serves timeline assets', async t => {
  const f = fixture(t);
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  await report(f, 'DONE');
  const expected = await history(f);
  for (let i = 0; i < 2; i++) {
    const server = await startWorkspace({ root: f.root, port: 0 });
    try {
      const base = server.url.replace('localhost', '127.0.0.1');
      const url = `${base}/api/workspace-tasks/${f.id}`;
      const response = await fetch(url, { headers: { 'x-coordinate-agents-capability': server.capability } });
      assert.equal(response.status, 200); assert.deepEqual((await response.json()).collaborationEvents, expected);
      const asset = await fetch(`${base}/collaboration-timeline.mjs`); assert.equal(asset.status, 200);
    } finally { await new Promise(done => { server.server.close(done); server.server.closeAllConnections?.(); }); }
  }
});

test('independent report processes serialize duplicate transitions and preserve another task unchanged', async t => {
  const f = fixture(t);
  const other = { ...f.record, id: 'workspace-other12345' };
  const otherFile = join(f.root, '.agent-bus/workspace-tasks', `${other.id}.json`);
  writeFileSync(otherFile, JSON.stringify(other));
  const before = readFileSync(otherFile, 'utf8');
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  const { spawn } = await import('node:child_process');
  const code = `import {reportWorkspaceTask} from ${JSON.stringify(new URL('../skills/coordinate-agents/scripts/workspace-task-runtime.mjs', import.meta.url).href)}; await reportWorkspaceTask(process.argv[1], process.argv[2], 'WORKING', 'round-first', 'same');`;
  const child = () => new Promise((done, reject) => {
    const process = spawn(globalThis.process.execPath, ['--input-type=module', '-e', code, f.root, f.id], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let error = ''; process.stderr.on('data', chunk => { error += chunk; });
    process.on('error', reject); process.on('exit', status => status === 0 ? done() : reject(Error(error)));
  });
  await Promise.all([child(), child(), child()]);
  assert.deepEqual((await history(f)).map(event => event.status), ['SENT', 'WORKING']);
  await report(f, 'FAILED', 'round-first', 'Formal failure');
  assert.equal((await history(f)).at(-1).status, 'FAILED');
  assert.equal(readFileSync(otherFile, 'utf8'), before);
});

test('history sanitizer redacts before Unicode truncation, including load-time untrusted previews', async () => {
  const { collaborationSummary } = await import('../skills/coordinate-agents/scripts/workspace-collaboration.mjs');
  for (const input of ['prefix password="secret with spaces" suffix', '{"api_key":"hidden value"}', 'https://name:pass@host/?token=hidden&x=ok', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature', '-----BEGIN RSA PRIVATE KEY-----\nprivate-content\n-----END RSA PRIVATE KEY-----']) {
    assert.doesNotMatch(collaborationSummary(input), /secret with spaces|hidden|name:pass|private-content|eyJhbGci/);
  }
  const preview = collaborationSummary('safe '.repeat(42) + 'TOKEN=' + 'a'.repeat(700));
  assert.ok(Array.from(preview).length <= 240); assert.doesNotMatch(preview, /a{10}/);
});


test('complete Cookie headers are private, including quoted values, multiple cookies and following text', async t => {
  const { collaborationSummary } = await import('../skills/coordinate-agents/scripts/workspace-collaboration.mjs');
  for (const value of ['Cookie: session=alpha; sid=bravo', 'Set-Cookie: session=alpha; Secure; HttpOnly', 'cookie="sid=alpha; auth=bravo"', 'COOKIE: session=alpha;\nTests passed']) {
    assert.doesNotMatch(collaborationSummary(value), /alpha|bravo|HttpOnly/);
  }
  assert.match(collaborationSummary('Cookie: session=alpha; sid=bravo\nTests passed'), /Tests passed/);
  const f = fixture(t);
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  await report(f, 'WORKING', 'round-first', 'Cookie: session=alpha; sid=bravo');
  const stored = JSON.parse(readFileSync(f.file));
  assert.doesNotMatch(JSON.stringify(stored.collaborationEvents), /alpha|bravo/);
  stored.collaborationEvents[1].summary = 'Cookie: session=alpha; sid=bravo';
  writeFileSync(f.file, JSON.stringify(stored));
  assert.doesNotMatch(JSON.stringify(await history(f)), /alpha|bravo/);

});

test('a receipt retries if another owner releases the lock during inspection', async t => {
  const f = fixture(t);
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  const lock = `${f.file}.lock`; mkdirSync(lock);
  const code = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const lock = process.argv[3], original = fs.lstatSync;
    let released = false;
    fs.lstatSync = (path, ...args) => {
      if (String(path) === lock && !released) { released = true; fs.rmSync(lock, { recursive: true }); }
      return original(path, ...args);
    };
    syncBuiltinESMExports();
    const { reportWorkspaceTask } = await import(${JSON.stringify(new URL('../skills/coordinate-agents/scripts/workspace-task-runtime.mjs', import.meta.url).href)});
    await reportWorkspaceTask(process.argv[1], process.argv[2], 'WORKING', 'round-first', 'Progress', { notify: () => {} });
    if (!released) throw Error('Race was not exercised');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code, f.root, f.id, lock], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual((await history(f)).map(event => event.status), ['SENT', 'WORKING']);
});

test('receipt retry still rejects a non-directory cooperation lock without changing records', async t => {
  const f = fixture(t);
  await dispatchWorkspaceTask(f.root, f.id, 'round-first', async () => {});
  const before = readFileSync(f.file, 'utf8');
  writeFileSync(`${f.file}.lock`, 'unsafe');
  await assert.rejects(report(f, 'WORKING'), /Unsafe cooperation lock/);
  assert.equal(readFileSync(f.file, 'utf8'), before);
});
