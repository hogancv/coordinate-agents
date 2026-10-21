import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { initializeWorkspace } from '../skills/coordinate-agents/scripts/workspace-init.mjs';
import { readConfig, writeConfig } from '../skills/coordinate-agents/scripts/config.mjs';
import * as runtime from '../skills/coordinate-agents/scripts/workspace-task-runtime.mjs';
import { listRecords } from '../skills/coordinate-agents/scripts/session-manager.mjs';
import { getExecutionSessionManager } from '../skills/coordinate-agents/scripts/session-service.mjs';

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'workspace-resume-')));
  execFileSync('git', ['init', '-q', root]);
  initializeWorkspace(root);
  const home = join(root, 'codex-home');
  const dir = join(home, 'sessions', '2026', '10', '20'); mkdirSync(dir, { recursive: true });
  const previousHome = process.env.CODEX_HOME; process.env.CODEX_HOME = home; t.after(() => { if(previousHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previousHome; });
  const id = randomUUID();
  writeFileSync(join(dir, `rollout-test-${id}.jsonl`), `${JSON.stringify({type:'session_meta',payload:{id,cwd:root,source:'cli'}})}\n`);
  const script = join(root, 'cli.cjs');
  writeFileSync(script, `const fs=require('node:fs');
if(process.argv.includes('--version')){console.log('fixture 1.0');process.exit(0)}
const slot=process.env.COORDINATE_AGENTS_SLOT || (process.argv.includes('--executor')?'antigravity':'codex');
fs.appendFileSync(${JSON.stringify(join(root,'launch.jsonl'))},JSON.stringify({slot,args:process.argv.slice(2),sessionId:process.env.COORDINATE_AGENTS_SESSION_ID,generation:process.env.COORDINATE_AGENTS_RUNTIME_GENERATION})+'\\n');
console.log(slot==='codex'?'Ask Codex to do anything':'? for shortcuts');process.stdin.setRawMode?.(true);process.stdin.resume();
process.stdin.on('data',x=>fs.appendFileSync(${JSON.stringify(join(root,'input.log'))},slot+':'+x.toString('hex')+'\\n'));
`);
  const config = readConfig(join(root,'.agent-bus'));
  for(const agent of config.agents) { agent.command=process.execPath; agent.args=[script,...(agent.id==='antigravity'?['--executor']:[])]; }
  writeConfig(join(root,'.agent-bus'),config);
  const taskId = `workspace-${randomUUID().replaceAll('-','')}`;
  const stamp = new Date().toISOString();
  const path=join(root,'.agent-bus','workspace-tasks');mkdirSync(path,{recursive:true});
  writeFileSync(join(path,`${taskId}.json`),JSON.stringify({schemaVersion:1,id:taskId,title:'Resume',status:'CLOSED',promptVersion:'test',createdAt:stamp,updatedAt:stamp,
    sessions:{codex:{slot:'codex',agent:'codex',role:'planner-reviewer',sessionId:null},antigravity:{slot:'antigravity',agent:'antigravity',role:'implementer',sessionId:null}},sessionHistory:[],error:null}));
  t.after(async()=>{for(const s of listRecords(root))try{await getExecutionSessionManager().close(root,s.id,{graceful:false,timeoutMs:300})}catch{}rmSync(root,{recursive:true,force:true,maxRetries:process.platform==='win32'?30:0,retryDelay:100})});
  return {root,id,taskId,taskFile:join(path,`${taskId}.json`),script};
}

test('closed Task resumes exact Codex, rebuilds executor, is immediately ready and retains history', {timeout:45000}, async t=>{
  const f=fixture(t);
  assert.equal(typeof runtime.runtimeWorkspaceTaskResume,'function');
  const input={root:f.root,workspaceTaskId:f.taskId,conversationId:f.id};
  const [a,b]=await Promise.all([runtime.runtimeWorkspaceTaskResume(input),runtime.runtimeWorkspaceTaskResume(input)]);
  assert.equal(a.workspaceTask.sessions.codex.sessionId,b.workspaceTask.sessions.codex.sessionId);
  assert.equal(listRecords(f.root).length,2);
  const task=await runtime.readWorkspaceTask(f.root,f.taskId);
  assert.equal(task.resume.state,'READY');
  assert.equal(task.resume.verification,null);
  const legacy=JSON.parse(readFileSync(f.taskFile));legacy.resume.state='AWAITING_CONFIRMATION';writeFileSync(f.taskFile,JSON.stringify(legacy));
  const snapshot=readFileSync(f.taskFile,'utf8');
  assert.equal((await runtime.readWorkspaceTask(f.root,f.taskId)).resume.state,'READY');
  assert.equal(readFileSync(f.taskFile,'utf8'),snapshot);
  await runtime.dispatchWorkspaceTask(f.root,f.taskId,'round-ready',async()=>{},{caller:caller(task,'codex')});
  await runtime.reportWorkspaceTask(f.root,f.taskId,'DONE','round-ready','ready without confirmation',{caller:caller(task,'antigravity'),notify:()=>{}});
  await runtime.reportWorkspaceTask(f.root,f.taskId,'REVIEWING','round-ready','',{caller:caller(task,'codex'),notify:()=>{}});
  await runtime.reportWorkspaceTask(f.root,f.taskId,'APPROVED','round-ready','reviewed without confirmation',{caller:caller(task,'codex'),notify:()=>{}});
  const launches=readFileSync(join(f.root,'launch.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(launches.find(x=>x.slot==='codex').args.slice(-2),['resume',f.id]);
  assert.ok(launches.every(x=>x.sessionId&&x.generation));
  const inputs=readFileSync(join(f.root,'input.log'),'utf8');
  assert.doesNotMatch(inputs,/codex:/);
  const confirmed=await runtime.runtimeWorkspaceTaskConfirmConversation({...input,confirmed:true,sessionId:task.sessions.codex.sessionId,runtimeGeneration:task.sessions.codex.runtimeGeneration});
  assert.equal(confirmed.workspaceTask.resume.state,'READY');
  assert.equal(confirmed.workspaceTask.sessions.codex.nativeIdentity.binding.conversationId,f.id);
  assert.equal(confirmed.workspaceTask.sessions.codex.nativeIdentity.verification.state,'MANUAL_CONFIRMED');
  const beforeClose=await runtime.readWorkspaceTask(f.root,f.taskId);
  await runtime.runtimeWorkspaceTaskClose(input);
  const closed=await runtime.readWorkspaceTask(f.root,f.taskId);
  assert.equal(closed.sessions.codex.nativeIdentity.verification.state,'UNAVAILABLE');
  assert.equal(closed.sessions.codex.nativeIdentity.binding.conversationId,f.id);
  const resumed=(await runtime.runtimeWorkspaceTaskResume({root:f.root,workspaceTaskId:f.taskId})).workspaceTask;
  assert.notEqual(resumed.sessions.codex.sessionId,task.sessions.codex.sessionId);
  assert.deepEqual(resumed.cooperation,beforeClose.cooperation);
  assert.deepEqual(resumed.collaborationEvents,beforeClose.collaborationEvents);
  await assert.rejects(runtime.runtimeWorkspaceTaskConfirmConversation({...input,confirmed:true,sessionId:task.sessions.codex.sessionId,runtimeGeneration:task.sessions.codex.runtimeGeneration}),/changed|runtime/i);
});

test('Resume refuses missing/wrong identities, archived Tasks and Custom Terminals before opening', async t=>{
  const f=fixture(t); assert.equal(typeof runtime.runtimeWorkspaceTaskResume,'function');
  const input={root:f.root,workspaceTaskId:f.taskId};
  await assert.rejects(runtime.runtimeWorkspaceTaskResume(input),/identity|UUID|conversation/i);
  await assert.rejects(runtime.runtimeWorkspaceTaskResume({...input,conversationId:randomUUID()}),/not found/i);
  const task=JSON.parse(readFileSync(f.taskFile));task.archivedAt=new Date().toISOString();writeFileSync(f.taskFile,JSON.stringify(task));
  await assert.rejects(runtime.runtimeWorkspaceTaskResume({...input,conversationId:f.id}),/archived/i);
  assert.equal(listRecords(f.root).length,0);
});

test('executor failure preserves valid Codex and retry opens only the missing executor', {timeout:45000}, async t=>{
  const f=fixture(t);const bus=join(f.root,'.agent-bus');let config=readConfig(bus);
  config.agents.find(x=>x.id==='antigravity').command='missing-executor-for-resume';writeConfig(bus,config);
  const input={root:f.root,workspaceTaskId:f.taskId,conversationId:f.id};
  const partial=(await runtime.runtimeWorkspaceTaskResume(input)).workspaceTask;
  assert.equal(partial.resume.state,'PARTIAL');assert.ok(partial.sessions.codex.sessionId);assert.equal(partial.sessions.antigravity.sessionId,null);
  config=readConfig(bus);config.agents.find(x=>x.id==='antigravity').command=process.execPath;writeConfig(bus,config);
  const resumed=(await runtime.runtimeWorkspaceTaskResume(input)).workspaceTask;
  assert.equal(resumed.sessions.codex.sessionId,partial.sessions.codex.sessionId);
  assert.equal(resumed.resume.state,'READY');
  assert.equal(listRecords(f.root).filter(x=>x.agent==='codex').length,1);
});

test('manual confirmation cannot bind a different Task target or accept a client verification flag', {timeout:30000}, async t=>{
 const f=fixture(t);const input={root:f.root,workspaceTaskId:f.taskId,conversationId:f.id};
 const task=(await runtime.runtimeWorkspaceTaskResume(input)).workspaceTask;
 const proof={...input,sessionId:task.sessions.codex.sessionId,runtimeGeneration:task.sessions.codex.runtimeGeneration};
 await assert.rejects(runtime.runtimeWorkspaceTaskConfirmConversation({...proof,verified:true}),/manual confirmation/i);
 await assert.rejects(runtime.runtimeWorkspaceTaskConfirmConversation({...proof,confirmed:true,conversationId:randomUUID()}),/identity/i);
 assert.equal((await runtime.readWorkspaceTask(f.root,f.taskId)).sessions.codex.nativeIdentity.binding,null);
});

function caller(task,slot){const s=task.sessions[slot];return {taskId:task.id,slot,sessionId:s.sessionId,runtimeGeneration:s.runtimeGeneration};}
async function confirm(f,task){return (await runtime.runtimeWorkspaceTaskConfirmConversation({root:f.root,workspaceTaskId:f.taskId,conversationId:f.id,confirmed:true,sessionId:task.sessions.codex.sessionId,runtimeGeneration:task.sessions.codex.runtimeGeneration})).workspaceTask;}

test('resumed collaboration rejects stale runtimes and replacement executor receipts for an old round', {timeout:45000}, async t=>{
 const f=fixture(t),input={root:f.root,workspaceTaskId:f.taskId,conversationId:f.id};
 let task=await confirm(f,(await runtime.runtimeWorkspaceTaskResume(input)).workspaceTask);
 await assert.rejects(runtime.dispatchWorkspaceTask(f.root,f.taskId,'round-old',()=>assert.fail('must not deliver')),/runtime|caller/i);
 const codexCaller=caller(task,'codex'),oldExecutor=caller(task,'antigravity');
 await runtime.dispatchWorkspaceTask(f.root,f.taskId,'round-old',async()=>{},{caller:codexCaller});
 await runtime.reportWorkspaceTask(f.root,f.taskId,'WORKING','round-old','before close',{notify:()=>{},caller:oldExecutor});
 const previous=await runtime.readWorkspaceTask(f.root,f.taskId);
 await runtime.runtimeWorkspaceTaskClose(input);
 task=(await runtime.runtimeWorkspaceTaskResume(input)).workspaceTask;
 await assert.rejects(runtime.reportWorkspaceTask(f.root,f.taskId,'DONE','round-old','replacement before confirmation',{notify:()=>{},caller:caller(task,'antigravity')}),/round.*runtime|executor/i);
 assert.equal(task.resume.state,'READY');
 assert.deepEqual(task.cooperation,previous.cooperation);assert.deepEqual(task.collaborationEvents,previous.collaborationEvents);
 assert.equal(task.resume.interruption.roundId,'round-old');
 await assert.rejects(runtime.reportWorkspaceTask(f.root,f.taskId,'DONE','round-old','late',{notify:()=>{},caller:oldExecutor}),/runtime|caller/i);
 await assert.rejects(runtime.reportWorkspaceTask(f.root,f.taskId,'DONE','round-old','replacement',{notify:()=>{},caller:caller(task,'antigravity')}),/round.*runtime|executor/i);
 await assert.rejects(runtime.dispatchWorkspaceTask(f.root,f.taskId,'round-stale',()=>assert.fail('must not deliver'),{caller:codexCaller}),/runtime|caller/i);
 await runtime.dispatchWorkspaceTask(f.root,f.taskId,'round-new',async()=>{},{caller:caller(task,'codex')});
 await runtime.reportWorkspaceTask(f.root,f.taskId,'DONE','round-new','new work',{notify:()=>{},caller:caller(task,'antigravity')});
 assert.equal((await runtime.readWorkspaceTask(f.root,f.taskId)).cooperation.status,'DONE');
});

test('Close waits for dispatch transaction and preserves the sent receipt without replay', {timeout:30000}, async t=>{
 const f=fixture(t),input={root:f.root,workspaceTaskId:f.taskId,conversationId:f.id};
 const task=await confirm(f,(await runtime.runtimeWorkspaceTaskResume(input)).workspaceTask);
 let release,entered;const held=new Promise(done=>release=done),started=new Promise(done=>entered=done);
 const sent=runtime.dispatchWorkspaceTask(f.root,f.taskId,'round-race',async()=>{entered();await held},{caller:caller(task,'codex')});
 await started;const closed=runtime.runtimeWorkspaceTaskClose(input);release();await sent;await closed;
 const final=await runtime.readWorkspaceTask(f.root,f.taskId);assert.equal(final.status,'CLOSED');assert.equal(final.cooperation.status,'SENT');
 await assert.rejects(runtime.reportWorkspaceTask(f.root,f.taskId,'WORKING','round-race','late',{notify:()=>{},caller:caller(task,'antigravity')}),/ready|runtime/i);
});

test('interrupted launch adopts the exact unassociated owned runtime instead of creating a duplicate', {timeout:30000},async t=>{
 const f=fixture(t);const {runtimeSessionOpen}=await import('../skills/coordinate-agents/scripts/session-service.mjs');
 const record=JSON.parse(readFileSync(f.taskFile));record.status='STARTING';record.startup={language:'en',slots:{codex:'WAITING',antigravity:'WAITING'}};
 record.resume={schemaVersion:1,conversationId:f.id,state:'STARTING',verification:null,interruption:null};writeFileSync(f.taskFile,JSON.stringify(record));
 const orphan=(await runtimeSessionOpen({root:f.root,agent:'codex',workspace:true,taskId:f.taskId,subtaskId:'codex',reuseExisting:false,conversationId:f.id})).session;
 const result=(await runtime.runtimeWorkspaceTaskResume({root:f.root,workspaceTaskId:f.taskId})).workspaceTask;
 assert.equal(result.sessions.codex.sessionId,orphan.id);assert.equal(listRecords(f.root).length,2);
});

test('uncertain dispatch is recorded before delivery and Resume never resends it', {timeout:30000},async t=>{
 const f=fixture(t),input={root:f.root,workspaceTaskId:f.taskId,conversationId:f.id};
 const task=await confirm(f,(await runtime.runtimeWorkspaceTaskResume(input)).workspaceTask);
 let writes=0;await assert.rejects(runtime.dispatchWorkspaceTask(f.root,f.taskId,'round-uncertain',async()=>{writes++;throw new Error('lost acknowledgement')},{caller:caller(task,'codex')}),/acknowledgement/);
 let result=await runtime.readWorkspaceTask(f.root,f.taskId);assert.equal(result.resume.interruption.status,'DISPATCH_UNCERTAIN');assert.equal(result.resume.interruption.roundId,'round-uncertain');
 result=(await runtime.runtimeWorkspaceTaskResume(input)).workspaceTask;assert.equal(writes,1);assert.equal(result.cooperation.status,'IDLE');
});

test('Resume HTTP action is capability/project bound and manual proof uses exact runtime claims', {timeout:30000},async t=>{
 const f=fixture(t);const {startWorkspace}=await import('./support/workspace-server.mjs');const server=await startWorkspace({root:f.root,port:0});
 t.after(()=>new Promise(done=>{server.server.close(done);server.server.closeAllConnections?.()}));
 const base=server.url.replace('localhost','127.0.0.1'),headers={'content-type':'application/json','x-coordinate-agents-capability':server.capability};
 const post=(action,params,auth=true)=>fetch(`${base}/api/action`,{method:'POST',headers:auth?headers:{'content-type':'application/json'},body:JSON.stringify({action,params})});
 const input={workspaceTaskId:f.taskId,conversationId:f.id};
 assert.equal((await post('workspaceTaskResume',input,false)).status,401);
 assert.ok([400,403].includes((await post('workspaceTaskResume',{...input,root:tmpdir()})).status));
 const response=await post('workspaceTaskResume',input);assert.equal(response.status,200,await response.clone().text());const task=(await response.json()).workspaceTask;
 const proof={...input,confirmed:true,sessionId:task.sessions.codex.sessionId,runtimeGeneration:task.sessions.codex.runtimeGeneration};
 assert.equal((await post('workspaceTaskConfirmConversation',{...proof,verified:true})).status,400);
 assert.equal((await post('workspaceTaskConfirmConversation',proof)).status,200);
});

test('native Resume refuses generic adapters instead of silently opening a new Codex conversation', {timeout:20000},async t=>{
 const f=fixture(t),config=readConfig(join(f.root,'.agent-bus'));config.agents.find(x=>x.id==='codex').adapter='generic-cli';writeConfig(join(f.root,'.agent-bus'),config);
 const task=(await runtime.runtimeWorkspaceTaskResume({root:f.root,workspaceTaskId:f.taskId,conversationId:f.id})).workspaceTask;
 assert.equal(task.resume.state,'FAILED');assert.equal(task.sessions.codex.sessionId,null);assert.equal(listRecords(f.root).length,0);
});

function requireLogin(f,slot){
 let source=readFileSync(f.script,'utf8');
 const marker="console.log(slot==='codex'?'Ask Codex to do anything':'? for shortcuts');";
 source=source.replace(marker,`if(slot===${JSON.stringify(slot)}){console.log(slot==='codex'?'Sign in with ChatGPT':'Select login method:');process.stdin.on('data',()=>console.log('\\x1b[2J'+(slot==='codex'?'Ask Codex to do anything':'? for shortcuts')))}else{${marker}}`);
 writeFileSync(f.script,source);
}
for(const slot of ['antigravity','codex']) test(`Resume continues ${slot} login and commits final startup plus resume state`,{timeout:30000},async t=>{
 const f=fixture(t);requireLogin(f,slot);
 let task=(await runtime.runtimeWorkspaceTaskResume({root:f.root,workspaceTaskId:f.taskId,conversationId:f.id})).workspaceTask;
 assert.equal(task.status,'AWAITING_INPUT');assert.equal(task.startup.slots[slot],'AUTH_REQUIRED');
 await getExecutionSessionManager().write(f.root,task.sessions[slot].sessionId,'y',{submit:false});
 task=(await runtime.runtimeWorkspaceTaskContinue({root:f.root,workspaceTaskId:f.taskId})).workspaceTask;
 assert.equal(task.status,'RUNNING');assert.equal(task.startup.slots[slot],'READY');assert.equal(task.resume.state,'READY');
 const persisted=JSON.parse(readFileSync(f.taskFile));assert.equal(persisted.resume.state,'READY');
 const inputs=readFileSync(join(f.root,'input.log'),'utf8');assert.doesNotMatch(inputs,/codex:(?!79)/);
});

test('read-only resume views downgrade exited runtimes without rewriting persisted history', {timeout:30000},async t=>{
 const f=fixture(t),input={root:f.root,workspaceTaskId:f.taskId,conversationId:f.id};
 const task=await confirm(f,(await runtime.runtimeWorkspaceTaskResume(input)).workspaceTask);
 await getExecutionSessionManager().close(f.root,task.sessions.codex.sessionId,{graceful:false,timeoutMs:300});
 const saved=readFileSync(f.taskFile,'utf8');assert.equal(JSON.parse(saved).resume.state,'READY');
 const detail=await runtime.readWorkspaceTask(f.root,f.taskId),listed=(await runtime.readWorkspaceTasks(f.root))[0];
 assert.equal(detail.status,'DEGRADED');assert.ok(['exited','failed'].includes(detail.sessions.codex.state));
 assert.equal(detail.resume.state,'FAILED');assert.equal(listed.resume.state,'FAILED');
 assert.equal(detail.sessions.codex.nativeIdentity.verification.state,'UNAVAILABLE');
 assert.deepEqual(detail.resume.verification,task.resume.verification);
 assert.equal(readFileSync(f.taskFile,'utf8'),saved);
 await getExecutionSessionManager().close(f.root,task.sessions.antigravity.sessionId,{graceful:false,timeoutMs:300});
 const exited=await runtime.readWorkspaceTask(f.root,f.taskId);assert.equal(exited.status,'EXITED');assert.equal(exited.resume.state,'FAILED');
 assert.equal(readFileSync(f.taskFile,'utf8'),saved);
});

test('read-only resume views show partial recovery when only the executor exits', {timeout:30000},async t=>{
 const f=fixture(t),input={root:f.root,workspaceTaskId:f.taskId,conversationId:f.id};
 const task=await confirm(f,(await runtime.runtimeWorkspaceTaskResume(input)).workspaceTask);
 await getExecutionSessionManager().close(f.root,task.sessions.antigravity.sessionId,{graceful:false,timeoutMs:300});
 const saved=readFileSync(f.taskFile,'utf8'),view=await runtime.readWorkspaceTask(f.root,f.taskId);
 assert.equal(view.status,'DEGRADED');assert.equal(view.resume.state,'PARTIAL');
 assert.equal(view.sessions.codex.nativeIdentity.verification.state,'MANUAL_CONFIRMED');
 assert.equal(readFileSync(f.taskFile,'utf8'),saved);
});

for(const login of [false,true]) test(`original executor receipts survive Codex recovery without confirmation (login=${login})`,{timeout:45000},async t=>{
 const f=fixture(t),input={root:f.root,workspaceTaskId:f.taskId,conversationId:f.id};
 const original=await confirm(f,(await runtime.runtimeWorkspaceTaskResume(input)).workspaceTask);
 const executor=caller(original,'antigravity');let notifications=0;
 const report=(status,roundId='round-inflight',summary='')=>runtime.reportWorkspaceTask(f.root,f.taskId,status,roundId,summary,{caller:executor,notify:()=>notifications++});
 await runtime.dispatchWorkspaceTask(f.root,f.taskId,'round-inflight',async()=>{},{caller:caller(original,'codex')});
 await report('WORKING');
 await getExecutionSessionManager().close(f.root,original.sessions.codex.sessionId,{graceful:false,timeoutMs:300});
 if(login)requireLogin(f,'codex');
 let task=(await runtime.runtimeWorkspaceTaskResume(input)).workspaceTask;
 assert.equal(task.sessions.antigravity.sessionId,original.sessions.antigravity.sessionId);
 assert.equal(task.resume.verification,null);
 assert.equal(task.status,login?'AWAITING_INPUT':'RUNNING');
 const before=await runtime.readWorkspaceTask(f.root,f.taskId);
 const savedResume=JSON.parse(readFileSync(f.taskFile)).resume;
 if(login) await assert.rejects(runtime.dispatchWorkspaceTask(f.root,f.taskId,'round-not-ready',()=>assert.fail('must not dispatch'),{caller:caller(task,'codex')}),/ready/i);
 const done=await report('DONE','round-inflight','original executor completed');
 assert.equal(done.status,'DONE');assert.equal(done.revision,before.cooperation.revision+1);
 await assert.rejects(runtime.reportWorkspaceTask(f.root,f.taskId,'DONE','round-inflight','missing caller',{notify:()=>{}}),/caller|runtime/i);
 await assert.rejects(runtime.reportWorkspaceTask(f.root,f.taskId,'DONE','round-inflight','wrong generation',{caller:{...executor,runtimeGeneration:randomUUID()},notify:()=>{}}),/runtime|caller/i);
 await assert.rejects(report('DONE','round-wrong'),/round/i);
 assert.deepEqual((await runtime.readWorkspaceTask(f.root,f.taskId)).cooperation,done);
 let current=await runtime.readWorkspaceTask(f.root,f.taskId);
 assert.equal(current.collaborationEvents.length,before.collaborationEvents.length+1);assert.equal(current.collaborationEvents.at(-1).status,'DONE');
 assert.equal(notifications,1);
 assert.deepEqual(JSON.parse(readFileSync(f.taskFile)).resume,savedResume);
 const duplicate=await report('DONE','round-inflight','original executor completed');assert.equal(duplicate.revision,done.revision);assert.equal(notifications,1);
 if(login) await assert.rejects(runtime.reportWorkspaceTask(f.root,f.taskId,'REVIEWING','round-inflight','',{caller:caller(task,'codex'),notify:()=>{}}),/ready/i);
 if(login){await getExecutionSessionManager().write(f.root,task.sessions.codex.sessionId,'y',{submit:false});await runtime.runtimeWorkspaceTaskContinue(input)}
 task=await runtime.readWorkspaceTask(f.root,f.taskId);
 assert.equal(task.resume.state,'READY');
 await runtime.reportWorkspaceTask(f.root,f.taskId,'REVIEWING','round-inflight','',{caller:caller(task,'codex'),notify:()=>{}});
 await runtime.reportWorkspaceTask(f.root,f.taskId,'APPROVED','round-inflight','reviewed after confirmation',{caller:caller(task,'codex'),notify:()=>{}});
 current=await runtime.readWorkspaceTask(f.root,f.taskId);assert.equal(current.cooperation.status,'APPROVED');
 assert.equal(current.cooperation.revision,done.revision+2);
 await runtime.runtimeWorkspaceTaskClose(input);
 await assert.rejects(report('DONE','round-inflight','after close'),/ready|runtime/i);
 await runtime.runtimeWorkspaceTaskArchive(input);
 await assert.rejects(report('DONE','round-inflight','after archive'),/ready|runtime/i);
});

test('startup resume views distinguish unpublished slots from missing associated session records',async t=>{
 const f=fixture(t),record=JSON.parse(readFileSync(f.taskFile));
 record.status='STARTING';record.startup={language:'en',slots:{codex:'WAITING',antigravity:'WAITING'}};
 record.resume={schemaVersion:1,conversationId:f.id,state:'STARTING',verification:null,interruption:null};
 const save=()=>writeFileSync(f.taskFile,JSON.stringify(record));save();
 assert.equal((await runtime.readWorkspaceTask(f.root,f.taskId)).resume.state,'STARTING');
 record.sessions.codex.sessionId='session_missingcodex1234';record.sessions.codex.runtimeGeneration=randomUUID();save();
 assert.equal((await runtime.readWorkspaceTask(f.root,f.taskId)).resume.state,'FAILED');
 const directory=join(f.root,'.agent-bus','sessions');mkdirSync(directory,{recursive:true});
 writeFileSync(join(directory,record.sessions.codex.sessionId+'.json'),JSON.stringify({id:record.sessions.codex.sessionId,
  runtimeGeneration:record.sessions.codex.runtimeGeneration,command:process.execPath,adapter:'codex-cli',agent:'codex',
  taskId:f.taskId,subtaskId:'codex',cwd:f.root,state:'idle'}));
 assert.equal((await runtime.readWorkspaceTask(f.root,f.taskId)).resume.state,'STARTING');
 record.sessions.antigravity.sessionId='session_missingexecutor1234';record.sessions.antigravity.runtimeGeneration=randomUUID();save();
 const snapshot=readFileSync(f.taskFile,'utf8');
 assert.equal((await runtime.readWorkspaceTask(f.root,f.taskId)).resume.state,'PARTIAL');
 assert.equal((await runtime.readWorkspaceTasks(f.root))[0].resume.state,'PARTIAL');
 assert.equal(readFileSync(f.taskFile,'utf8'),snapshot);
});

test('slow resume launch does not block concurrent executor DONE receipts', {timeout:45000}, async t => {
 const f = fixture(t), input = { root: f.root, workspaceTaskId: f.taskId, conversationId: f.id };
 const original = await confirm(f, (await runtime.runtimeWorkspaceTaskResume(input)).workspaceTask);
 const executor = caller(original, 'antigravity');
 await runtime.dispatchWorkspaceTask(f.root, f.taskId, 'round-slow-resume', async () => {}, { caller: caller(original, 'codex') });
 await runtime.reportWorkspaceTask(f.root, f.taskId, 'WORKING', 'round-slow-resume', 'working', { caller: executor, notify: () => {} });

 await getExecutionSessionManager().close(f.root, original.sessions.codex.sessionId, { graceful: false, timeoutMs: 300 });

 let source = readFileSync(f.script, 'utf8');
 source = source.replace("console.log(slot==='codex'?'Ask Codex to do anything':'? for shortcuts');",
   "if(slot==='codex'){setTimeout(()=>console.log('Ask Codex to do anything'),1500)}else{console.log('? for shortcuts')}");
 writeFileSync(f.script, source);

 let resumeCompleted = false;
 const resumePromise = runtime.runtimeWorkspaceTaskResume(input).then(res => {
   resumeCompleted = true;
   return res;
 });

 await new Promise(done => setTimeout(done, 150));

 const done = await runtime.reportWorkspaceTask(f.root, f.taskId, 'DONE', 'round-slow-resume', 'completed during slow resume', { caller: executor, notify: () => {} });
 assert.equal(done.status, 'DONE');
 assert.equal(resumeCompleted, false, 'DONE receipt must commit before slow resume finishes');

 const resumed = (await resumePromise).workspaceTask;
 assert.equal(resumeCompleted, true);
 assert.equal(resumed.cooperation.status, 'DONE');
 assert.equal(resumed.cooperation.roundId, 'round-slow-resume');
 assert.equal(resumed.collaborationEvents.at(-1).status, 'DONE');
});

test('degraded task with live bound Codex recovers missing executor without closing Codex or requiring manual confirmation', {timeout:45000}, async t => {
 const f = fixture(t);
 const created = (await runtime.runtimeWorkspaceTaskCreate({ root: f.root, language: 'en' })).workspaceTask;
 assert.equal(created.status, 'RUNNING');
 assert.equal(created.resume, null);
 const codexId = created.sessions.codex.sessionId;
 const originalExecutorId = created.sessions.antigravity.sessionId;

 const observation = {
   schemaVersion: 1,
   projectRoot: f.root,
   taskId: created.id,
   slot: 'codex',
   adapter: 'codex-cli',
   sessionId: created.sessions.codex.sessionId,
   runtimeGeneration: created.sessions.codex.runtimeGeneration,
   conversationId: f.id,
   source: { id: 'test', version: '1' },
   observedAt: new Date().toISOString(),
   sequence: 1,
   expectedRevision: 0,
 };
 const token = Symbol('test-token');
 await runtime.createWorkspaceNativeIdentityStore({ root: f.root, verifyAttestation: val => val === token ? observation : null }).observe(token);

 await getExecutionSessionManager().close(f.root, originalExecutorId, { graceful: false, timeoutMs: 300 });
 const degraded = await runtime.readWorkspaceTask(f.root, created.id);
 assert.equal(degraded.status, 'DEGRADED');
 assert.equal(degraded.resume, null);

 const resumed = (await runtime.runtimeWorkspaceTaskResume({ root: f.root, workspaceTaskId: created.id })).workspaceTask;
 assert.equal(resumed.sessions.codex.sessionId, codexId);
 assert.ok(resumed.sessions.antigravity.sessionId);
 assert.notEqual(resumed.sessions.antigravity.sessionId, originalExecutorId);
 assert.equal(resumed.status, 'RUNNING');
 assert.equal(resumed.resume.state, 'READY');

 await runtime.dispatchWorkspaceTask(f.root, created.id, 'round-degraded-recovered', async () => {}, { caller: caller(resumed, 'codex') });
 const working = await runtime.reportWorkspaceTask(f.root, created.id, 'WORKING', 'round-degraded-recovered', 'executor working', { caller: caller(resumed, 'antigravity') });
 assert.equal(working.status, 'WORKING');
});
