import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeWorkspace } from '../skills/coordinate-agents/scripts/workspace-init.mjs';
import { readConfig, writeConfig } from '../skills/coordinate-agents/scripts/config.mjs';
import * as runtime from '../skills/coordinate-agents/scripts/workspace-task-runtime.mjs';
import { listRecords } from '../skills/coordinate-agents/scripts/session-manager.mjs';
import { getExecutionSessionManager } from '../skills/coordinate-agents/scripts/session-service.mjs';

async function until(read, predicate, timeout = 12000) {
  const deadline = Date.now() + timeout;
  let value;
  do { value = await read(); if (predicate(value)) return value; await new Promise(done => setTimeout(done, 100)); } while (Date.now() < deadline);
  assert.fail(`Timed out: ${JSON.stringify(value)}`);
}

function fixture(t, { source = 'cli', supported = true } = {}) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'workspace-auto-binding-')));
  execFileSync('git', ['init', '-q', root]); initializeWorkspace(root);
  const home = join(root, 'codex-home'); mkdirSync(home);
  const previousHome = process.env.CODEX_HOME; process.env.CODEX_HOME = home;
  const cli = join(root, 'native-fixture.cjs');
  writeFileSync(cli, `const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
if(process.argv.includes('--version')){console.log(${JSON.stringify(supported ? 'codex-cli 0.163.0' : 'fixture 1.0')});process.exit(0)}
const args=process.argv.slice(2),slot=process.env.COORDINATE_AGENTS_SLOT;
fs.appendFileSync(path.join(process.cwd(),'launch.jsonl'),JSON.stringify({slot,args})+'\\n');
const setting=args.find(x=>x.startsWith('otel.exporter='));
const endpoint=setting?.match(/endpoint\\s*=\\s*"([^"]+)"/)?.[1];
let id=args.at(-2)==='resume'?args.at(-1):crypto.randomUUID();
async function emit(){
 const dir=path.join(process.env.CODEX_HOME,'sessions','2026','10','21');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'rollout-fixture-'+id+'.jsonl'),JSON.stringify({type:'session_meta',payload:{id,cwd:process.cwd(),source:${JSON.stringify(source)},originator:'codex_cli_rs',cli_version:'0.163.0'}})+'\\n');
 const attrs={'event.name':'codex.conversation_starts','conversation.id':id,'event.timestamp':new Date().toISOString(),'app.version':'0.163.0',originator:'codex_cli_rs'};
 if(endpoint)await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({resourceLogs:[{scopeLogs:[{logRecords:[{attributes:Object.entries(attrs).map(([key,value])=>({key,value:{stringValue:value}}))}]}]}]})}).catch(()=>{});
}
console.log(slot==='codex'?'Ask Codex to do anything':'? for shortcuts');
if(slot==='codex')setTimeout(emit,500);
process.stdin.setRawMode?.(true);process.stdin.resume();process.stdin.on('data',x=>{if(x.toString()==='switch'){id=crypto.randomUUID();void emit()}});
`);
  const config = readConfig(join(root, '.agent-bus'));
  for (const agent of config.agents) { agent.command = process.execPath; agent.args = [cli]; }
  writeConfig(join(root, '.agent-bus'), config);
  t.after(async () => {
    for (const s of listRecords(root)) try { await getExecutionSessionManager().close(root, s.id, { graceful: false, timeoutMs: 300 }); } catch {}
    if (previousHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousHome;
    rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
  });
  const read = id => runtime.readWorkspaceTask(root, id);
  const bound = id => until(() => read(id), task => Boolean(task.sessions.codex.nativeIdentity.binding));
  return { root, home, cli, read, bound, create: async () => (await runtime.runtimeWorkspaceTaskCreate({ root, language: 'en' })).workspaceTask };
}

test('creation auto-binds, concurrent reopen omits UUID and preserves original Task and timeline', { timeout: 45000 }, async t => {
  const f = fixture(t), created = await f.create(), task = await f.bound(created.id);
  const id = task.sessions.codex.nativeIdentity.binding.conversationId;
  assert.equal(task.sessions.codex.nativeIdentity.binding.source.id, 'codex-otel');
  assert.equal(task.sessions.codex.nativeIdentity.verification.state, 'UNAVAILABLE');
  await runtime.runtimeWorkspaceTaskClose({ root: f.root, workspaceTaskId: task.id });
  const input = { root: f.root, workspaceTaskId: task.id };
  const [a, b] = await Promise.all([runtime.runtimeWorkspaceTaskResume(input), runtime.runtimeWorkspaceTaskResume(input)]);
  assert.equal(a.workspaceTask.sessions.codex.sessionId, b.workspaceTask.sessions.codex.sessionId);
  assert.equal(a.workspaceTask.resume.conversationId, id);
  assert.equal(a.workspaceTask.resume.state, 'READY');
  assert.deepEqual(a.workspaceTask.collaborationEvents, task.collaborationEvents);
  assert.deepEqual(a.workspaceTask.cooperation, task.cooperation);
  const launches = readFileSync(join(f.root, 'launch.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(launches.filter(x => x.slot === 'codex').length, 2);
  assert.deepEqual(launches.filter(x => x.slot === 'codex')[1].args.slice(-2), ['resume', id]);
  const metadata = readFileSync(join(f.root, '.agent-bus', 'sessions', `${a.workspaceTask.sessions.codex.sessionId}.json`), 'utf8');
  assert.doesNotMatch(metadata, /otel\.exporter=|127\.0\.0\.1:\d+\/identity\//, 'collector capability is never persisted');
});

test('concurrent Codex tasks bind only their own process event and never guess from newest records', { timeout: 45000 }, async t => {
  const f = fixture(t);
  const [a, b] = await Promise.all([f.create(), f.create()]);
  const [one, two] = await Promise.all([f.bound(a.id), f.bound(b.id)]);
  assert.notEqual(one.sessions.codex.nativeIdentity.binding.conversationId, two.sessions.codex.nativeIdentity.binding.conversationId);
  assert.equal(one.sessions.codex.nativeIdentity.binding.sessionId, one.sessions.codex.sessionId);
  assert.equal(two.sessions.codex.nativeIdentity.binding.runtimeGeneration, two.sessions.codex.runtimeGeneration);
});

test('a bound task refuses fresh-pair restart before closing its recoverable native runtime', { timeout: 30000 }, async t => {
  const f = fixture(t), created = await f.create(), before = await f.bound(created.id);
  await assert.rejects(runtime.runtimeWorkspaceTaskRestart({ root: f.root, workspaceTaskId: before.id }), /original conversation|new Task/i);
  const after = await f.read(before.id);
  assert.equal(after.sessions.codex.sessionId, before.sessions.codex.sessionId);
  assert.equal(after.sessions.codex.nativeIdentity.firstConflict, null);
  assert.deepEqual(after.cooperation, before.cooperation);
  assert.equal(listRecords(f.root).length, 2);
});

test('unsupported CLI collection leaves ordinary terminals and the manual recovery path usable', { timeout: 30000 }, async t => {
  const f = fixture(t, { supported: false }), task = await f.create();
  assert.equal(task.status, 'RUNNING');
  assert.equal(task.sessions.codex.nativeIdentity.binding, null);
  const launches = readFileSync(join(f.root, 'launch.jsonl'), 'utf8');
  assert.doesNotMatch(launches, /otel\.exporter|--no-daemon/);
  const directory = join(f.home, 'sessions', '2026', '10', '21');
  const metadata = JSON.parse(readFileSync(join(directory, readdirSync(directory)[0]), 'utf8'));
  await runtime.runtimeWorkspaceTaskClose({ root: f.root, workspaceTaskId: task.id });
  const resumed = (await runtime.runtimeWorkspaceTaskResume({ root: f.root, workspaceTaskId: task.id, conversationId: metadata.payload.id })).workspaceTask;
  assert.equal(resumed.resume.conversationId, metadata.payload.id);
  assert.equal(resumed.resume.state, 'READY');
});

test('received TUI identity switch after resume latches conflict and blocks collaboration', { timeout: 40000 }, async t => {
  const f = fixture(t), created = await f.create(), task = await f.bound(created.id);
  const input = { root: f.root, workspaceTaskId: task.id };
  await runtime.runtimeWorkspaceTaskClose(input);
  const resumed = (await runtime.runtimeWorkspaceTaskResume(input)).workspaceTask;
  assert.equal(resumed.resume.state, 'READY');
  const session = resumed.sessions.codex;
  await getExecutionSessionManager().write(f.root, session.sessionId, 'switch', { submit: false });
  const changed = await until(() => f.read(task.id), value => Boolean(value.sessions.codex.nativeIdentity.firstConflict));
  assert.equal(changed.sessions.codex.nativeIdentity.verification.state, 'UNAVAILABLE');
  assert.equal(changed.resume.state, 'FAILED');
  assert.equal(changed.sessions.codex.nativeIdentity.binding.conversationId, session.nativeIdentity.binding.conversationId);
  await assert.rejects(runtime.dispatchWorkspaceTask(f.root, task.id, 'round-blocked', () => assert.fail('must not dispatch'),
    { caller: { taskId: task.id, slot: 'codex', sessionId: session.sessionId, runtimeGeneration: session.runtimeGeneration } }), /identity|confirmation/i);
});
