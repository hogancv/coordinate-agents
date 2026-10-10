// Offline acceptance against installed files only. The verifier copies this
// script into the isolated consumer; it has no repository imports/dependencies.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const [packagePath, temporaryPath, expectedVersion] = process.argv.slice(2);
const packageRoot = realpathSync.native(packagePath);
const temporary = realpathSync.native(temporaryPath);
const cli = join(packageRoot, 'bin/coordinate-agents.mjs');
const project = join(temporary, 'project with spaces');
const second = join(temporary, 'second project');
const fixture = join(temporary, 'mock CLI with spaces.cjs');
const home = process.env.COORDINATE_AGENTS_HOME;
mkdirSync(project, { recursive: true }); mkdirSync(second, { recursive: true });
mkdirSync(join(home, '.coordinate-agents'), { recursive: true });
writeFileSync(fixture, `const fs = require('node:fs');
const agent = process.argv[2];
if (process.argv.includes('--version')) { console.log('offline-mock-1'); process.exit(0); }
if (process.argv[3] !== 'argument with spaces') process.exit(23);
fs.appendFileSync(${JSON.stringify(join(temporary, 'launches.jsonl'))}, JSON.stringify({ agent, argv:process.argv.slice(2), cwd:process.cwd(), pid:process.pid, tty:Boolean(process.stdin.isTTY) })+'\\n');
console.log(agent === 'codex' ? 'Ask Codex to do anything' : '? for shortcuts');
process.stdin.setRawMode?.(true); process.stdin.resume();
process.stdin.on('data', data => { fs.appendFileSync(${JSON.stringify(join(temporary, 'inputs.jsonl'))}, JSON.stringify({agent, input:String(data)})+'\\n'); console.log('mock-reply:'+agent+':'+String(data)); });
process.on('SIGINT', () => process.exit(0));
`);
// A real executable with a space in its filename, without a shell command wrapper.
// Windows must get an independent file image: the verifier itself still runs
// the original Node executable and can lock a hardlinked mock even after every
// mock CLI exits. Unix can use a hardlink without that image-deletion lock.
const { linkSync, copyFileSync } = await import('node:fs');
const executable = join(temporary, process.platform === 'win32' ? 'mock node.exe' : 'mock node');
try {
  if (process.platform === 'win32') copyFileSync(process.execPath, executable);
  else linkSync(process.execPath, executable);
} catch (error) {
  if (!['EXDEV', 'EPERM', 'EACCES'].includes(error.code)) throw error;
  copyFileSync(process.execPath, executable);
}
writeFileSync(join(home, '.coordinate-agents/config.json'), JSON.stringify({ version: 1, adapters: [], agents: Object.fromEntries(['codex', 'antigravity'].map(agent => [agent, { command: executable, args: [fixture, agent, 'argument with spaces'] }])) }));
const requireInstalled = createRequire(join(packageRoot, 'package.json'));
assert.equal(typeof requireInstalled('node-pty').spawn, 'function', 'installed production node-pty loads');
const run = args => {
  const result = spawnSync(process.execPath, args, { cwd: project, env: process.env, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.stdout); return result.stdout;
};
assert.equal(run([cli, '--version']).trim(), expectedVersion);
assert.match(run([cli, '--help']), /web/);
const removed = spawnSync(process.execPath, [cli, 'task', 'status'], { cwd: project, env: process.env, encoding: 'utf8' });
assert.equal(removed.status, 1); assert.match(removed.stderr, /2\.4\.0/); assert.doesNotMatch(removed.stderr, /ERR_MODULE_NOT_FOUND/);
const delay = ms => new Promise(done => setTimeout(done, ms));
async function poll(get, check, label) {
  const deadline = Date.now()+10000; let latest;
  while (Date.now()<deadline) { const result=await get(); latest=result; if (check(result)) return result; await delay(60); }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(latest).slice(-5000)}`);
}
let child, base, capability, projectId;
const allTasks = [];
async function start() {
  child = spawn(process.execPath, [cli, 'web', '--root', project, '--port', '0', '--json'], { cwd: temporary, env: process.env, stdio: ['ignore','pipe','pipe'] });
  let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  const ready = await new Promise((done, reject) => {
    let stdout=''; const timeout=setTimeout(()=>reject(new Error(`Web startup timeout: ${stderr}`)),15000);
    child.stdout.on('data', data => { stdout+=data; if (stdout.includes('\n')) { clearTimeout(timeout); try { done(JSON.parse(stdout.split('\n')[0])); } catch(error) { reject(error); } } });
    child.once('exit', code=>{ clearTimeout(timeout); reject(new Error(`Web exited ${code}: ${stderr}`)); });
  });
  assert.equal(ready.ok,true,JSON.stringify(ready)); assert.equal(ready.host,'127.0.0.1');
  base=ready.url.replace('localhost','127.0.0.1');
  const page=await (await fetch(base)).text(); assert.match(page,/Coordinate Agents Workspace/);
  capability=page.match(/name="coordinate-agents-capability" content="([^"]+)"/)?.[1]; assert.ok(capability);
  const projects=await get('/api/projects',false); projectId=projects.defaultProjectId; assert.ok(projectId);
}
async function stop() {
  if (!child || child.exitCode!==null) return;
  const exited=once(child,'exit'); child.kill('SIGTERM');
  let timer; try { await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Web did not shut down'));},5000);})]); } finally {clearTimeout(timer);}
}
function url(path, scoped=true) {return base+(scoped?`/api/projects/${projectId}`:'')+path;}
async function get(path, scoped=true) {
  const response=await fetch(url(path,scoped),{headers:{'x-coordinate-agents-capability':capability}});
  assert.equal(response.status,200,`${path}: ${await response.clone().text()}`); return response.json();
}
async function action(name,params={},scoped=true) {
  const response=await fetch(url('/api/action',scoped),{method:'POST',headers:{'content-type':'application/json','x-coordinate-agents-capability':capability},body:JSON.stringify({action:name,params})});
  assert.equal(response.status,200,name); const result=await response.json();
  if (!result.ok) {
    const store=join(project,'.agent-bus/sessions');
    const diagnostics=existsSync(store)?readdirSync(store).filter(f=>f.endsWith('.json')).map(f=>{const r=JSON.parse(readFileSync(join(store,f),'utf8'));return {agent:r.agent,state:r.state,exitCode:r.exitCode,signal:r.signal,error:r.error,outputTail:r.outputTail};}):[];
    assert.fail(JSON.stringify({result,diagnostics}));
  } return result;
}
async function read(sessionId) {return get(`/api/sessions/${sessionId}/read`);}
try {
  await start();
  for (const asset of ['/app.js','/styles.css','/terminal-model.mjs','/composer-model.mjs','/vendor/xterm.js','/vendor/xterm.css']) assert.equal((await fetch(base+asset)).status,200,asset);
  assert.ok((await get('/api/repository')).root);
  assert.equal((await get('/api/workspace-settings')).codex.command,executable);
  assert.deepEqual(await get('/api/workspace-tasks'),[]);
  const missing=await fetch(base+'/api/action',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}); assert.equal(missing.status,401);
  const badOrigin=await fetch(base+'/api/action',{method:'POST',headers:{'content-type':'application/json','origin':'https://example.com','x-coordinate-agents-capability':capability},body:'{}'}); assert.equal(badOrigin.status,403);
  for (const name of ['taskCreate','taskGraphRun','taskReview','sessionOpen']) {
    const response=await fetch(base+'/api/action',{method:'POST',headers:{'content-type':'application/json','x-coordinate-agents-capability':capability},body:JSON.stringify({action:name,params:{}})}); assert.equal(response.status,404,name);
  }
  const created=await action('workspaceTaskCreate',{language:'en'}); const task=created.workspaceTask || created.task;
  assert.ok(task?.id,JSON.stringify(created)); allTasks.push(task.id);
  const detail=await get(`/api/workspace-tasks/${task.id}`); assert.equal(detail.status,'RUNNING');
  const codex=detail.sessions.codex.sessionId, agy=detail.sessions.antigravity.sessionId; assert.notEqual(codex,agy);
  for (const id of [codex,agy]) {const record=JSON.parse(readFileSync(join(project,'.agent-bus/sessions',`${id}.json`),'utf8')); assert.equal(record.taskId,task.id);}
  await poll(()=>read(codex),r=>r.output.output.includes('You clarify and review.'),'Codex role prompt');
  await poll(()=>read(agy),r=>r.output.output.includes('You implement.'),'Antigravity role prompt');
  await action('sessionWrite',{sessionId:codex,input:'input-output-check',submit:true});
  await poll(()=>read(codex),r=>r.output.output.includes('mock-reply:codex:input-output-check'),'terminal reply');
  await action('sessionResize',{sessionId:codex,cols:91,rows:27});
  const message=join(packageRoot,'skills/coordinate-agents/scripts/workspace-message.mjs');
  const sent=JSON.parse(run([message,task.id,'send','directed-message-check'])); assert.equal(sent.sessionId,agy); assert.equal(sent.sent,true);
  await poll(()=>read(agy),r=>r.output.output.includes('mock-reply:antigravity:directed-message-check'),'directed reply');
  const received=JSON.parse(run([message,task.id,'read',String(sent.cursor)])); assert.match(received.output,/directed-message-check/);
  const another=await action('workspaceTaskCreate',{language:'zh-CN'}); const task2=another.workspaceTask || another.task; allTasks.push(task2.id);
  assert.notEqual(task2.sessions.antigravity.sessionId,agy);
  const secondRead=await read(task2.sessions.antigravity.sessionId); assert.doesNotMatch(secondRead.output.output,/directed-message-check/);
  // Settings round trip preserves configured Node args and existing pair launches.
  await action('workspaceSettingsSave',{codex:executable,antigravity:executable,args:[fixture,'codex','argument with spaces','--model','fixture-model','-c','model_reasoning_effort="high"']});
  assert.ok((await get('/api/workspace-settings')).codex.args.includes('fixture-model'));
  const added=await action('projectAdd',{path:second,initialize:true},false); const firstId=projectId;projectId=added.project.id;
  assert.deepEqual(await get('/api/workspace-tasks'),[]);
  const denied=await fetch(url('/api/action'),{method:'POST',headers:{'content-type':'application/json','x-coordinate-agents-capability':capability},body:JSON.stringify({action:'sessionWrite',params:{sessionId:agy,input:'wrong-project'}})});
  assert.equal((await denied.json()).ok,false); projectId=firstId;
  assert.equal((await get('/api/workspace-tasks')).length,2);
  // Refresh/new server must reconnect the independent hosts, not launch new CLIs.
  const launchesBefore=readFileSync(join(temporary,'launches.jsonl'),'utf8').trim().split('\n').length;
  await stop();await start(); assert.equal((await get(`/api/workspace-tasks/${task.id}`)).sessions.codex.sessionId,codex);
  assert.equal(readFileSync(join(temporary,'launches.jsonl'),'utf8').trim().split('\n').length,launchesBefore);
  assert.match((await read(agy)).output.output,/directed-message-check/);
  await action('workspaceTaskClose',{workspaceTaskId:task.id});
  const restarted=await action('workspaceTaskRestart',{workspaceTaskId:task.id}); const current=restarted.workspaceTask || restarted.task;
  assert.notEqual(current.sessions.codex.sessionId,codex); assert.equal(current.status,'RUNNING');
  await action('sessionClose',{sessionId:current.sessions.codex.sessionId});
  for (const id of allTasks) await action('workspaceTaskClose',{workspaceTaskId:id});
  assert.equal(existsSync(join(project,'.agent-bus/tasks')),false); assert.equal(existsSync(join(project,'.agent-bus/graphs')),false);
  assert.equal(existsSync(join(project,'.agent-bus/inbox')),false);
  const records=readdirSync(join(project,'.agent-bus/sessions')).filter(f=>f.endsWith('.json')).map(f=>JSON.parse(readFileSync(join(project,'.agent-bus/sessions',f),'utf8')));
  assert.ok(records.every(r=>['exited','failed'].includes(r.state)));
  for (const record of records) {
    if (process.platform!=='win32') assert.equal(existsSync(record.endpoint),false,'owned socket removed');
    let alive=false;try {process.kill(record.hostPid,0);alive=true;} catch {} assert.equal(alive,false,'owned host exited');
  }
  // Archive/cleanup must also work in the installed tarball, including restart transcripts.
  await action('workspaceTaskArchive', { workspaceTaskId: task.id });
  assert.equal((await get('/api/workspace-tasks')).length, 1);
  const archiveStatus = await action('workspaceArchivesStatus', {}, false);
  assert.equal(archiveStatus.tasks, 1);
  const cleared = await action('workspaceArchivesClear', {}, false);
  assert.equal(cleared.deletedTasks, 1); assert.equal(cleared.deletedSessions, 4);
  assert.equal(existsSync(join(project, '.agent-bus/workspace-tasks', task.id + '.json')), false);
  await action('projectArchive', { projectId }, false);
  const visibleProjects = await get('/api/projects', false);
  assert.equal(visibleProjects.projects.some(p => p.id === projectId), false);
  assert.equal(readFileSync(join(project, '.agent-bus/config.json'), 'utf8').length > 0, true);
  const projectCleanup = await action('workspaceArchivesClear', {}, false);
  assert.equal(projectCleanup.deletedTasks, 1); assert.equal(projectCleanup.deletedSessions, 2);
  console.log(JSON.stringify({ok:true,version:expectedVersion,dualTerminals:true,rolePrompts:true,messageRoundTrip:true,taskIsolation:true,customPathsAndArgs:true,resize:true,settings:true,multipleProjects:true,serverReconnect:true,restart:true,cleanup:true,archive:true,archiveCleanup:true,backend:JSON.parse(readFileSync(join(temporary,'launches.jsonl'),'utf8').trim().split('\n')[0]).tty ? 'node-pty' : 'stdio-fallback',sessionCount:records.length}));
} finally {
  // If any assertion fails, close only hosts persisted by this isolated install.
  try {
    const service=await import(pathToFileURL(join(packageRoot,'skills/coordinate-agents/scripts/session-service.mjs')).href);
    const pids = new Set();
    const launches = join(temporary, 'launches.jsonl');
    if (existsSync(launches)) for (const line of readFileSync(launches, 'utf8').trim().split('\n').filter(Boolean)) pids.add(JSON.parse(line).pid);
    for (const directory of [project,second]) {
      const store=join(directory,'.agent-bus/sessions');if (!existsSync(store)) continue;
      for (const file of readdirSync(store).filter(f=>f.endsWith('.json'))) {
        const record = JSON.parse(readFileSync(join(store, file), 'utf8'));
        if (record.hostPid) pids.add(record.hostPid);
        await service.runtimeSessionClose({root:directory,sessionId:file.slice(0,-5),graceful:false,timeoutMs:1000});
      }
    }
    // Windows locks executable files until the process has actually exited.
    // Check all CLIs we launched, including archived/removed Session records.
    await poll(async () => [...pids].filter(pid => { try { process.kill(pid, 0); return true; } catch { return false; } }), alive => alive.length === 0, 'owned CLI and host exit');
  } finally {await stop();}
}
