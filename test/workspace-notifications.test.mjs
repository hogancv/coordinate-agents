import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNotificationConfig, saveNotificationConfig, validateNotificationConfig } from '../skills/coordinate-agents/scripts/workspace-notification-config.mjs';
import { buildTaskNotification, sendNativeNotification, notifyWorkspaceReceipt, notificationCapability } from '../skills/coordinate-agents/scripts/workspace-notifications.mjs';

function project(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'notify-')));
  mkdirSync(join(root, '.agent-bus'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const enabled = { enabled: true, events: { done: false, approved: true, failed: true } };
const receipt = { id: 'workspace-notify123', title: '修复登录逻辑', mode: 'default', cooperation: { status: 'APPROVED', roundId: 'round-123' } };

test('project preferences default off, strictly validate, persist independently and reject unsafe files', t => {
  const a = project(t), b = project(t);
  assert.deepEqual(readNotificationConfig(a), { ...enabled, enabled: false });
  assert.deepEqual(saveNotificationConfig(a, enabled), enabled);
  assert.deepEqual(readNotificationConfig(a), enabled);
  assert.equal(readNotificationConfig(b).enabled, false);
  for (const value of [{ ...enabled, command: 'evil' }, { ...enabled, enabled: 1 }, { enabled: true, events: { approved: true } }]) assert.throws(() => validateNotificationConfig(value));
  const file = join(a, '.agent-bus/workspace-notifications.json');
  writeFileSync(file, 'x'.repeat(3000));
  assert.throws(() => readNotificationConfig(a));
  rmSync(file);
  symlinkSync(join(b, '.agent-bus/missing.json'), file);
  assert.throws(() => saveNotificationConfig(a, enabled));
});

test('content distinguishes statuses, limits Unicode text, excludes summaries, paths and controls', () => {
  const root = '/private/secret/project';
  const done = buildTaskNotification(root, { ...receipt, title: '🙂'.repeat(300), cooperation: { status: 'DONE', summary: 'TOKEN_SECRET' } });
  assert.match(done.title, /实现完成/); assert.match(done.body, /等待 Codex 审查/);
  assert.ok(Array.from(done.title).length <= 80); assert.ok(Array.from(done.body).length <= 240);
  assert.doesNotMatch(done.body, /private|secret|TOKEN_SECRET|\uFFFD/);
  assert.match(buildTaskNotification(root, receipt).title, /任务已完成/);
  const failed = buildTaskNotification(root, { ...receipt, title: '\x1b[31mHi\nthere token=secret123 /private/key', cooperation: { status: 'FAILED' } });
  assert.match(failed.title, /任务执行失败/);
  assert.doesNotMatch(failed.body, /\x1b|secret123|\/private\/key/);
});

test('macOS fixed script passes Chinese, emoji and quotes as argv without activation', async () => {
  const message = { title: '中文🙂"', body: '$(touch nope) & < > " \\ end' };
  let called = false;
  const result = await sendNativeNotification(message, { platform: 'darwin', run: async (command, args, options) => {
    called = true; assert.equal(command, '/usr/bin/osascript');
    assert.deepEqual(args.slice(-2), [message.title, message.body]);
    assert.doesNotMatch(args[1], /activate|tell application|touch nope/);
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    assert.ok(options.timeout <= 10000); assert.ok(options.maxBuffer <= 16384);
    return { stdout: '' };
  } });
  assert.equal(called, true); assert.equal(result.status, 'accepted'); assert.equal(result.displayed, null);
});

test('Windows runs a fixed encoded script and transmits JSON through stdin', async () => {
  const message = { title: '中文🙂"', body: '$(Start-Process evil) & < > \\ "' };
  const result = await sendNativeNotification(message, { platform: 'win32', run: async (command, args, options) => {
    assert.match(command, /WindowsPowerShell.*powershell.exe$/i);
    assert.ok(Array.isArray(args)); assert.ok(args.includes('-EncodedCommand'));
    const script = Buffer.from(args.at(-1), 'base64').toString('utf16le');
    assert.match(script, /CreateToastNotifier/); assert.match(script, /System.AppUserModel|9F4C2855/i);
    assert.match(script, /IPropertyStore/); assert.match(script, /StartMenu|Programs/);
    assert.doesNotMatch(script, /Start-Process evil|中文/);
    assert.deepEqual(JSON.parse(options.input), message);
    assert.equal(options.windowsHide, true); assert.equal(options.shell, false);
    return { stdout: 'CA_ACCEPTED' };
  } });
  assert.equal(result.status, 'accepted');
});

test('unsupported, missing tools, denied notifications, timeout and unknown output are honest bounded results', async () => {
  assert.equal(notificationCapability('linux').supported, false);
  assert.equal((await sendNativeNotification({}, { platform: 'linux', run: () => assert.fail() })).reason, 'UNSUPPORTED_PLATFORM');
  for (const [error, reason] of [[{ code: 'ENOENT' }, 'TOOL_UNAVAILABLE'], [{ killed: true }, 'COMMAND_TIMEOUT'], [{ code: 1, stderr: 'private secret' }, 'COMMAND_FAILED']]) {
    const result = await sendNativeNotification({ title: 'test', body: 'body' }, { platform: 'darwin', run: async () => { throw error; } });
    assert.equal(result.reason, reason); assert.doesNotMatch(JSON.stringify(result), /private|secret/);
  }
  assert.equal((await sendNativeNotification({ title: 't', body: 'b' }, { platform: 'win32', run: async () => ({ stdout: 'CA_DISABLED' }) })).reason, 'NOTIFICATIONS_DISABLED');
  assert.equal((await sendNativeNotification({ title: 't', body: 'b' }, { platform: 'win32', run: async () => ({ stdout: '' }) })).reason, 'NATIVE_UNAVAILABLE');
});

test('events hot-read preferences and persist at-most-once claims independent of summary and process lifetime', async t => {
  const root = project(t); let calls = 0;
  const options = { platform: 'darwin', send: async () => { calls++; return { status: 'accepted', displayed: null }; } };
  assert.equal((await notifyWorkspaceReceipt(root, receipt, options)).reason, 'DISABLED');
  saveNotificationConfig(root, enabled);
  assert.equal((await notifyWorkspaceReceipt(root, receipt, options)).status, 'accepted');
  assert.equal((await notifyWorkspaceReceipt(root, { ...receipt, cooperation: { ...receipt.cooperation, summary: 'new' } }, options)).reason, 'DUPLICATE');
  for (const status of ['DONE', 'WORKING', 'REVIEWING', 'CHANGES_REQUESTED', 'IDLE', 'CLOSED', 'EXITED']) await notifyWorkspaceReceipt(root, { ...receipt, cooperation: { ...receipt.cooperation, status } }, options);
  await notifyWorkspaceReceipt(root, { ...receipt, mode: 'custom' }, options);
  assert.equal(calls, 1);
  saveNotificationConfig(root, { ...enabled, events: { ...enabled.events, done: true } });
  await notifyWorkspaceReceipt(root, { ...receipt, cooperation: { ...receipt.cooperation, status: 'DONE' } }, options);
  await notifyWorkspaceReceipt(root, { ...receipt, cooperation: { status: 'FAILED', roundId: 'round-next' } }, options);
  await notifyWorkspaceReceipt(root, { ...receipt, id: 'workspace-another123' }, options);
  assert.equal(calls, 4);
  const ledger = readFileSync(join(root, '.agent-bus/notifications/dispatch.json'), 'utf8');
  assert.doesNotMatch(ledger, /修复|new|summary|APPROVED/);
});

// Real on-disk receipts/sessions, without starting terminals or a Web server.
async function receiptProject(t) {
  const root = project(t);
  const { validateWorkspaceTaskRecord } = await import('../skills/coordinate-agents/scripts/workspace-task-runtime.mjs');
  mkdirSync(join(root, '.agent-bus/workspace-tasks'));
  mkdirSync(join(root, '.agent-bus/sessions'));
  const sessions = Object.fromEntries(['codex', 'antigravity'].map(agent => [agent, {
    agent, role: agent === 'codex' ? 'planner-reviewer' : 'implementer', sessionId: `session_${agent}12345678`,
  }]));
  const task = validateWorkspaceTaskRecord({ ...receipt, schemaVersion: 1, status: 'RUNNING', promptVersion: 'test', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sessions,
    cooperation: { status: 'SENT', roundId: 'round-123', revision: 1, summary: '', updatedAt: new Date().toISOString() } });
  const file = join(root, `.agent-bus/workspace-tasks/${task.id}.json`);
  writeFileSync(file, JSON.stringify(task));
  for (const [agent, session] of Object.entries(sessions)) writeFileSync(join(root, `.agent-bus/sessions/${session.sessionId}.json`), JSON.stringify({ id: session.sessionId, command: 'unused', agent, taskId: task.id, cwd: root, state: 'idle' }));
  saveNotificationConfig(root, { ...enabled, events: { ...enabled.events, done: true } });
  return { root, task, file };
}

test('receipt hook sees committed state outside locks; duplicate summaries never replay and notification failure is isolated', async t => {
  const { root, task, file } = await receiptProject(t);
  const { reportWorkspaceTask } = await import('../skills/coordinate-agents/scripts/workspace-task-runtime.mjs');
  const { existsSync } = await import('node:fs');
  const events = [];
  const notify = (repository, snapshot) => {
    assert.equal(repository, root); assert.equal(existsSync(`${file}.lock`), false);
    assert.equal(JSON.parse(readFileSync(file)).cooperation.status, snapshot.cooperation.status);
    events.push(snapshot); throw new Error('OS secret error');
  };
  for (const status of ['WORKING', 'DONE', 'REVIEWING', 'APPROVED']) {
    const result = await reportWorkspaceTask(root, task.id, status, 'round-123', '', { notify });
    assert.deepEqual(Object.keys(result).sort(), ['revision', 'roundId', 'status', 'summary', 'updatedAt']);
  }
  assert.deepEqual(events.map(item => item.cooperation.status), ['DONE', 'APPROVED']);
  await reportWorkspaceTask(root, task.id, 'APPROVED', 'round-123', '', { notify });
  await reportWorkspaceTask(root, task.id, 'APPROVED', 'round-123', 'changed summary', { notify });
  assert.equal(events.length, 2);
  assert.equal(JSON.parse(readFileSync(file)).cooperation.status, 'APPROVED');
});

test('rejected receipts and failed task persistence cannot dispatch notifications', async t => {
  const { root, task, file } = await receiptProject(t);
  const { reportWorkspaceTask } = await import('../skills/coordinate-agents/scripts/workspace-task-runtime.mjs');
  const options = { notify: () => assert.fail('rejected receipt notified') };
  await assert.rejects(reportWorkspaceTask(root, task.id, 'DONE', 'round-wrong', '', options), /roundId/);
  await assert.rejects(reportWorkspaceTask(root, task.id, 'APPROVED', 'round-123', '', options), /transition/);
  const sessionFile = join(root, `.agent-bus/sessions/${task.sessions.antigravity.sessionId}.json`);
  writeFileSync(sessionFile, JSON.stringify({ id: task.sessions.antigravity.sessionId, command: 'unused', state: 'idle', agent: 'antigravity', cwd: root, taskId: 'workspace-other123' }));
  await assert.rejects(reportWorkspaceTask(root, task.id, 'DONE', 'round-123', '', options), /binding/);
  writeFileSync(sessionFile, JSON.stringify({ id: task.sessions.antigravity.sessionId, command: 'unused', state: 'idle', agent: 'antigravity', cwd: root, taskId: task.id }));
  rmSync(join(root, '.agent-bus/tmp'), { recursive: true }); writeFileSync(join(root, '.agent-bus/tmp'), 'blocked');
  await assert.rejects(reportWorkspaceTask(root, task.id, 'DONE', 'round-123', '', options));
  assert.equal(JSON.parse(readFileSync(file)).cooperation.status, 'SENT');
});

test('concurrent processes and a fresh process claim the same event once without any browser/server', async t => {
  const { spawn } = await import('node:child_process');
  const { root, task } = await receiptProject(t);
  const module = new URL('../skills/coordinate-agents/scripts/workspace-notifications.mjs', import.meta.url).href;
  const code = `import { notifyWorkspaceReceipt } from ${JSON.stringify(module)};
import { appendFileSync } from 'node:fs';
await notifyWorkspaceReceipt(process.argv[1], JSON.parse(process.argv[2]), {platform:'darwin', send:async()=>{appendFileSync(process.argv[3], 'dispatch\\n');return {status:'accepted',reason:null,displayed:null};}});`;
  const log = join(root, 'dispatch.log');
  const run = (r = root, event = task) => new Promise((done, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, r, JSON.stringify({ ...event, cooperation: { ...event.cooperation, status: 'APPROVED' } }), log], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('exit', status => status === 0 ? done() : reject(new Error(stderr)));
  });
  await Promise.all([run(), run(), run(), run()]);
  await run();
  assert.equal(readFileSync(log, 'utf8'), 'dispatch\n');
  await run(root, { ...task, cooperation: { ...task.cooperation, roundId: 'round-next' } });
  await run(root, { ...task, id: 'workspace-another123' });
  const second = await receiptProject(t); await run(second.root, second.task);
  assert.equal(readFileSync(log, 'utf8').trim().split('\n').length, 4);
});

test('ledger corruption, unsafe paths and capacity fail closed; failed native commands stay claimed', async t => {
  const { root, task, file } = await receiptProject(t);
  const { MAX_NOTIFICATION_CLAIMS } = await import('../skills/coordinate-agents/scripts/workspace-notifications.mjs');
  const ledger = join(root, '.agent-bus/notifications/dispatch.json');
  let calls = 0;
  const options = { platform: 'darwin', send: async () => { calls++; throw new Error('native failure'); } };
  assert.equal((await notifyWorkspaceReceipt(root, { ...task, cooperation: { ...task.cooperation, status: 'APPROVED' } }, options)).status, 'unavailable');
  await notifyWorkspaceReceipt(root, { ...task, cooperation: { ...task.cooperation, status: 'APPROVED' } }, options);
  assert.equal(calls, 1);
  const full = { schemaVersion: 1, claims: Array.from({ length: MAX_NOTIFICATION_CLAIMS }, (_, i) => ({ key: i.toString(16).padStart(64, '0'), taskId: task.id })) };
  writeFileSync(ledger, JSON.stringify(full));
  assert.equal((await notifyWorkspaceReceipt(root, { ...receipt, cooperation: { status: 'FAILED', roundId: 'round-full' } }, options)).reason, 'DEDUP_CAPACITY_REACHED');
  assert.equal(JSON.parse(readFileSync(ledger)).claims.length, MAX_NOTIFICATION_CLAIMS);
  writeFileSync(ledger, '{bad');
  assert.equal((await notifyWorkspaceReceipt(root, receipt, options)).reason, 'NOTIFICATION_STORE_UNAVAILABLE');
  assert.equal(calls, 1);
  rmSync(ledger); symlinkSync(file, ledger);
  assert.equal((await notifyWorkspaceReceipt(root, receipt, options)).reason, 'NOTIFICATION_STORE_UNAVAILABLE');
  assert.equal(JSON.parse(readFileSync(file)).cooperation.status, 'SENT');
});

test('bounded command executor kills timed-out children and limits output', async () => {
  const { runNotificationCommand } = await import('../skills/coordinate-agents/scripts/workspace-notifications.mjs');
  await assert.rejects(runNotificationCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 50, maxBuffer: 256, windowsHide: true, shell: false }), error => error.killed === true);
  await assert.rejects(runNotificationCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(4096))'], { timeout: 1000, maxBuffer: 256, windowsHide: true, shell: false }), /maxBuffer/);
});

test('a process initializing the notification lock cannot have its ownerless lock stolen', async t => {
  const { root } = await receiptProject(t);
  const { existsSync } = await import('node:fs');
  const lock = join(root, '.agent-bus/notifications.lock'); mkdirSync(lock);
  const result = await notifyWorkspaceReceipt(root, receipt, { platform: 'darwin', send: () => assert.fail('lock was stolen') });
  assert.equal(result.reason, 'NOTIFICATION_STORE_UNAVAILABLE');
  assert.equal(existsSync(lock), true);
});

test('JSON-valid corrupt ledgers fail closed instead of forgetting prior dispatches', async t => {
  const { root } = await receiptProject(t);
  const options = { platform: 'darwin', send: async () => ({ status: 'accepted', reason: null, displayed: null }) };
  await notifyWorkspaceReceipt(root, receipt, options);
  for (const invalid of [null, false, 0, '', [], {}, { schemaVersion: 1, claims: null }]) {
    writeFileSync(join(root, '.agent-bus/notifications/dispatch.json'), JSON.stringify(invalid));
    const result = await notifyWorkspaceReceipt(root, receipt, { ...options, send: async () => assert.fail('corrupt ledger replayed') });
    assert.equal(result.reason, 'NOTIFICATION_STORE_UNAVAILABLE', JSON.stringify(invalid));
  }
});

test('two dead-owner recoverers cannot remove a newly held notification lock', { timeout: 10000 }, async t => {
  const { spawn } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const { hostname } = await import('node:os');
  const { root } = await receiptProject(t);
  const lock = join(root, '.agent-bus/notifications.lock'); mkdirSync(lock);
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 2147483647, host: hostname(), token: 'dead' }));
  const module = new URL('../skills/coordinate-agents/scripts/workspace-notification-config.mjs', import.meta.url).href;
  const code = `import {withNotificationStore} from ${JSON.stringify(module)};
import {existsSync,writeFileSync} from 'node:fs';
const [root,role]=process.argv.slice(1); const kill=process.kill;
process.kill=(pid,...args)=>{if(pid!==2147483647)return kill(pid,...args);
writeFileSync(root+'/'+role+'-observed',''); while(!existsSync(root+'/'+role+'-go'))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);
throw Object.assign(new Error('dead'),{code:'ESRCH'});};
try{withNotificationStore(root,()=>{writeFileSync(root+'/'+role+'-entered','');while(!existsSync(root+'/finish'))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);});}catch{}
writeFileSync(root+'/'+role+'-done','');`;
  const children = ['a', 'b'].map(role => spawn(process.execPath, ['--input-type=module', '-e', code, root, role], { windowsHide: true, stdio: 'ignore' }));
  const exited = children.map(child => new Promise(done => child.once('exit', done)));
  const wait = async check => { const until = Date.now() + 3000; while (!check()) { if (Date.now() > until) throw new Error('barrier timed out'); await new Promise(done => setTimeout(done, 5)); } };
  try {
    await wait(() => ['a', 'b'].every(role => existsSync(join(root, role + '-observed'))));
    writeFileSync(join(root, 'a-go'), ''); await wait(() => existsSync(join(root, 'a-entered')));
    writeFileSync(join(root, 'b-go'), ''); await wait(() => existsSync(join(root, 'b-entered')) || existsSync(join(root, 'b-done')));
    assert.equal(existsSync(join(root, 'b-entered')), false, 'second recoverer entered while A still held the lock');
  } finally { writeFileSync(join(root, 'finish'), ''); for (const child of children) child.kill(); await Promise.all(exited); }
});

test('standalone report CLI dispatches after persistence with no Web server and keeps its JSON return compatible', async t => {
  const { root, task, file } = await receiptProject(t);
  const { spawn } = await import('node:child_process');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const log = join(root, 'native-attempts.jsonl');
  const adapter = join(root, 'mock-child-process.mjs');
  writeFileSync(adapter, `export * from 'node:child_process';
import {execFile as real} from 'node:child_process';
import {readFileSync,appendFileSync,existsSync} from 'node:fs';
import {Writable} from 'node:stream';
export function execFile(command,args,options,callback){
 if(command!=='/usr/bin/osascript'&&!command.endsWith('powershell.exe'))return real(command,args,options,callback);
 const record=JSON.parse(readFileSync(${JSON.stringify(file)},'utf8'));
 appendFileSync(${JSON.stringify(log)},JSON.stringify({status:record.cooperation.status,locked:existsSync(${JSON.stringify(file + '.lock')})})+'\\n');
 const child={stdin:new Writable({write(chunk,encoding,done){done();}})};
 setTimeout(()=>{appendFileSync(${JSON.stringify(log)},'accepted\\n');callback(null,command.endsWith('powershell.exe')?'CA_ACCEPTED':'','');},100);
 return child;
}`);
  const loader = join(root, 'loader.mjs');
  writeFileSync(loader, `export async function resolve(specifier,context,next){
 if(specifier==='node:child_process'&&context.parentURL?.endsWith('/workspace-notifications.mjs'))return {url:${JSON.stringify(pathToFileURL(adapter).href)},shortCircuit:true};
 return next(specifier,context);
}`);
  const bootstrap = join(root, 'platform.cjs');
  writeFileSync(bootstrap, "if(process.platform==='linux')Object.defineProperty(process,'platform',{value:'darwin'});");
  const cli = new URL('../skills/coordinate-agents/scripts/workspace-message.mjs', import.meta.url);
  const run = status => new Promise((done, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', '--require', bootstrap, '--experimental-loader', pathToFileURL(loader).href, fileURLToPath(cli), task.id, 'report', status, 'round-123'], { windowsHide: true, cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject); child.on('exit', code => code === 0 ? done(JSON.parse(stdout)) : reject(new Error(stderr)));
  });
  for (const status of ['done', 'reviewing', 'approved', 'approved']) {
    const result = await run(status);
    assert.equal(result.status, status.toUpperCase()); assert.equal(result.ok, true); assert.equal(result.reported, true);
    assert.deepEqual(Object.keys(result).sort(), ['ok', 'reported', 'revision', 'roundId', 'status', 'summary', 'updatedAt']);
  }
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.deepEqual(lines, [JSON.stringify({ status: 'DONE', locked: false }), 'accepted', JSON.stringify({ status: 'APPROVED', locked: false }), 'accepted']);
});
