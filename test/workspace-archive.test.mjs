import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createProjectStore } from '../inspector/server/workspace-projects.mjs';
import { startWorkspace } from '../inspector/server/workspace-server.mjs';
import * as runtime from '../skills/coordinate-agents/scripts/workspace-task-runtime.mjs';
import { readConfig, writeConfig } from '../skills/coordinate-agents/scripts/config.mjs';

function fixture() {
  const home=mkdtempSync(join(tmpdir(),'workspace archive '));
  const root=join(home,'project');mkdirSync(root);const store=createProjectStore({home});const project=store.register(root,true);
  writeFileSync(join(project.root,'keep-source.txt'),'source must survive');
  return {home,root:project.root,project,store};
}
function closedTask(root,id='workspace-archive0001') {
  const directory=join(root,'.agent-bus/workspace-tasks');mkdirSync(directory,{recursive:true});
  const record={schemaVersion:1,id,title:'Historical conversation',status:'CLOSED',promptVersion:'2.3.0-web-lite-1',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),sessions:{codex:{slot:'codex',agent:'codex',role:'planner-reviewer',sessionId:null},antigravity:{slot:'antigravity',agent:'antigravity',role:'implementer',sessionId:null}},sessionHistory:[],error:null};
  writeFileSync(join(directory,id+'.json'),JSON.stringify(record));return record;
}
async function close(server) {await new Promise(done=>{server.close(done);server.closeAllConnections?.();});}

test('archived conversations stay persisted, hide from lists and cannot restart',async()=>{
 const f=fixture();try {
  const task=closedTask(f.root);
  assert.equal(typeof runtime.runtimeWorkspaceTaskArchive,'function');
  const result=await runtime.runtimeWorkspaceTaskArchive({root:f.root,workspaceTaskId:task.id});
  assert.ok(result.workspaceTask.archivedAt);
  assert.deepEqual(await runtime.readWorkspaceTasks(f.root),[]);
  assert.equal((await runtime.readWorkspaceTasks(f.root,{includeArchived:true})).length,1);
  assert.ok(existsSync(join(f.root,'.agent-bus/workspace-tasks',task.id+'.json')));
  await assert.rejects(runtime.runtimeWorkspaceTaskRestart({root:f.root,workspaceTaskId:task.id}),/archived/i);
  assert.ok(existsSync(join(f.root,'keep-source.txt')));
 }finally{rmSync(f.home,{recursive:true,force:true});}
});

test('project archive hides its conversations and persists across startup registration',async()=>{
 const f=fixture();try {
  const task=closedTask(f.root);
  assert.equal(typeof f.store.archive,'function');
  await f.store.archive(f.project.id);
  assert.deepEqual(f.store.list(),[]);
  assert.ok(f.store.list({includeArchived:true})[0].archivedAt);
  assert.deepEqual(await runtime.readWorkspaceTasks(f.root),[]);
  f.store.register(f.root,true);
  assert.deepEqual(f.store.list(),[],'startup must not silently restore the archived project');
  assert.ok(existsSync(join(f.root,'keep-source.txt')));
  assert.ok(existsSync(join(f.root,'.agent-bus/workspace-tasks',task.id+'.json')));
 }finally{rmSync(f.home,{recursive:true,force:true});}
});

test('global archive cleanup deletes only archived conversation records',async()=>{
 const f=fixture();try {
  const archived=closedTask(f.root);const active=closedTask(f.root,'workspace-keep000001');
  assert.equal(typeof f.store.archiveStatus,'function');
  await runtime.runtimeWorkspaceTaskArchive({root:f.root,workspaceTaskId:archived.id});
  assert.equal((await f.store.archiveStatus()).tasks,1);
  const result=await f.store.clearArchives();assert.equal(result.deletedTasks,1);
  assert.equal(existsSync(join(f.root,'.agent-bus/workspace-tasks',archived.id+'.json')),false);
  assert.ok(existsSync(join(f.root,'.agent-bus/workspace-tasks',active.id+'.json')));
  assert.ok(existsSync(join(f.root,'keep-source.txt')));
  assert.equal((await f.store.archiveStatus()).tasks,0);
 }finally{rmSync(f.home,{recursive:true,force:true});}
});

test('archive APIs require capability and refuse arbitrary paths or project roots',async()=>{
 const f=fixture();let started;try {
  const task=closedTask(f.root);started=await startWorkspace({root:f.root,port:0,projectHome:f.home});
  const base=started.url.replace('localhost','127.0.0.1');
  const post=(action,params={},authorized=true,path='/api/action')=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(authorized?{'x-coordinate-agents-capability':started.capability}:{})},body:JSON.stringify({action,params})});
  assert.equal((await post('workspaceArchivesClear',{},false)).status,401);
  assert.equal((await post('projectArchive',{projectId:f.project.id,path:f.home})).status,400);
  const archived=await post('workspaceTaskArchive',{workspaceTaskId:task.id},true,`/api/projects/${f.project.id}/api/action`);assert.equal(archived.status,200);assert.equal((await archived.json()).ok,true);
  const stats=await post('workspaceArchivesStatus');assert.equal((await stats.json()).tasks,1);
  const cleared=await post('workspaceArchivesClear');assert.equal((await cleared.json()).deletedTasks,1);
  const projectArchive=await post('projectArchive',{projectId:f.project.id});assert.equal((await projectArchive.json()).ok,true);
  const scoped=await post('workspaceTaskCreate',{},true,`/api/projects/${f.project.id}/api/action`);assert.equal(scoped.status,400);
  const bypass=await post('workspaceTaskCreate');assert.equal((await bypass.json()).ok,false);
  assert.ok(existsSync(join(f.root,'keep-source.txt')));
 }finally{if(started)await close(started.server);rmSync(f.home,{recursive:true,force:true});}
});

test('archiving a running pair closes owned hosts and clears its restart transcripts',async()=>{
 const f=fixture();const previous=process.env.COORDINATE_AGENTS_HOME;process.env.COORDINATE_AGENTS_HOME=f.home;
 let taskId;
 try {
  const script=join(f.root,'offline agent.cjs');
  writeFileSync(script,`console.log(process.argv[2]==='codex'?'Ask Codex to do anything':'? for shortcuts');process.stdin.setRawMode?.(true);process.stdin.resume();process.stdin.on('data',()=>{});`);
  const config=readConfig(join(f.root,'.agent-bus'));
  for(const agent of config.agents){agent.adapter='generic-cli';agent.command=process.execPath;agent.args=[script,agent.id];}
  writeConfig(join(f.root,'.agent-bus'),config);
  const created=await runtime.runtimeWorkspaceTaskCreate({root:f.root});taskId=created.workspaceTask.id;
  await runtime.runtimeWorkspaceTaskRestart({root:f.root,workspaceTaskId:taskId});
  const records=readdirSync(join(f.root,'.agent-bus/sessions')).filter(file=>file.endsWith('.json'));
  assert.equal(records.length,4);
  await runtime.runtimeWorkspaceTaskArchive({root:f.root,workspaceTaskId:taskId});
  for(const file of records){
   const record=JSON.parse(readFileSync(join(f.root,'.agent-bus/sessions',file),'utf8'));
   assert.ok(['exited','failed'].includes(record.state));
   let alive=false;try{process.kill(record.hostPid,0);alive=true;}catch{}assert.equal(alive,false);
  }
  const cleared=await f.store.clearArchives();assert.equal(cleared.deletedTasks,1);assert.equal(cleared.deletedSessions,4);
  assert.equal(readdirSync(join(f.root,'.agent-bus/sessions')).filter(file=>file.endsWith('.json')).length,0);
  assert.ok(existsSync(join(f.root,'keep-source.txt')));
 }finally{
  if(taskId&&existsSync(join(f.root,'.agent-bus/workspace-tasks',taskId+'.json'))){try{await runtime.runtimeWorkspaceTaskClose({root:f.root,workspaceTaskId:taskId});}catch{}}
  if(previous===undefined)delete process.env.COORDINATE_AGENTS_HOME;else process.env.COORDINATE_AGENTS_HOME=previous;
  rmSync(f.home,{recursive:true,force:true});
 }
});

test('clearing archives refuses symlinked records and preserves the outside target',{skip:process.platform==='win32'},async()=>{
 const f=fixture();try{
  const task=closedTask(f.root);await runtime.runtimeWorkspaceTaskArchive({root:f.root,workspaceTaskId:task.id});
  const path=join(f.root,'.agent-bus/workspace-tasks',task.id+'.json'),outside=join(f.home,'outside.json');
  writeFileSync(outside,readFileSync(path));rmSync(path);symlinkSync(outside,path);
  const result=await f.store.clearArchives();assert.equal(result.deletedTasks,0);assert.equal(result.failedProjects.length,1);assert.ok(existsSync(outside));
 }finally{rmSync(f.home,{recursive:true,force:true});}
});

test('archived startup project stays hidden after server restart, and explicit re-add restores its folder',async()=>{
 const f=fixture();let started;try{
  closedTask(f.root);await f.store.archive(f.project.id);
  started=await startWorkspace({root:f.root,port:0,projectHome:f.home});
  const response=await fetch(started.url+'/api/projects',{headers:{'x-coordinate-agents-capability':started.capability}});
  const projects=await response.json();assert.deepEqual(projects.projects,[]);assert.equal(projects.defaultProjectId,null);
  f.store.register(f.root,false,{restoreArchived:true});assert.equal(f.store.list().length,1);assert.deepEqual(await runtime.readWorkspaceTasks(f.root),[]);
 }finally{if(started)await close(started.server);rmSync(f.home,{recursive:true,force:true});}
});

test('unavailable project folders can be archived without recreating or deleting their paths',async()=>{
 const f=fixture();try{
  rmSync(f.root,{recursive:true,force:true});await f.store.archive(f.project.id);
  assert.deepEqual(f.store.list(),[]);assert.equal(existsSync(f.root),false);
  const result=await f.store.clearArchives();assert.equal(result.failedProjects.length,1);assert.equal(existsSync(f.root),false);
 }finally{rmSync(f.home,{recursive:true,force:true});}
});

test('cleanup finds owned transcripts beyond the 32-entry retained restart history',async()=>{
 const f=fixture();try{
  const task=closedTask(f.root);const directory=join(f.root,'.agent-bus/sessions');mkdirSync(directory,{recursive:true});
  const id='session_oldhistory0001';
  writeFileSync(join(directory,id+'.json'),JSON.stringify({schemaVersion:1,id,agent:'codex',command:process.execPath,resolvedCommand:process.execPath,args:[],cwd:f.root,pid:null,state:'exited',createdAt:new Date().toISOString(),lastActivityAt:new Date().toISOString(),exitCode:0,signal:null,error:null,outputTail:'old conversation transcript',endpoint:null,hostPid:null,taskId:task.id,subtaskId:'codex'}));
  await runtime.runtimeWorkspaceTaskArchive({root:f.root,workspaceTaskId:task.id});
  const cleared=await f.store.clearArchives();assert.equal(cleared.deletedSessions,1);assert.equal(existsSync(join(directory,id+'.json')),false);
 }finally{rmSync(f.home,{recursive:true,force:true});}
});

test('settings can load global archive cleanup even when selected project settings fail',async()=>{
 const {default:vm}=await import('node:vm');
 const app=readFileSync(new URL('../inspector/web-workspace/app.js',import.meta.url),'utf8');
 const source=app.slice(app.indexOf('async function openSettings()'),app.indexOf('function readCodexModel('));
 const nodes=new Map();const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{hidden:true,setAttribute(){},removeAttribute(){},focus(){}});return nodes.get(selector);};
 const state={projectId:'missing',projectEpoch:0,projects:[{id:'missing',available:false}],settingsOpen:false,settingsBusy:false,archives:{tasks:0,projects:0,unavailableProjects:0}};
 const context=vm.createContext({state,document:{querySelector:node},WORKSPACE_SETTINGS_ENDPOINT:'/api/workspace-settings',DEFAULT_TERMINAL_COMMANDS:{codex:'codex',antigravity:'agy'},fetchJson:async()=>{throw new Error('Project directory unavailable');},postAction:async()=>({tasks:2,projects:0,unavailableProjects:1}),renderSettingsForm(){},renderArchiveSummary(){},settingsError(){},closeContextMenu(){},setSettingsBusy(value){state.settingsBusy=value;},t:key=>key,readCodexEffort(){return '';},readCodexModel(){return '';}});
 vm.runInContext(source,context);await context.openSettings();assert.equal(state.archives.tasks,2);assert.equal(state.archives.unavailableProjects,1);assert.equal(state.settingsBusy,false);
});

test('archive cleanup accepts a canonical alias of the owned cwd but rejects another project', async () => {
 const f=fixture();try {
  const task=closedTask(f.root);const directory=join(f.root,'.agent-bus/sessions');mkdirSync(directory,{recursive:true});
  const id='session_pathalias0001';const path=join(directory,id+'.json');
  const session={schemaVersion:1,id,agent:'codex',command:process.execPath,resolvedCommand:process.execPath,args:[],cwd:f.root+'/.' ,pid:null,state:'exited',createdAt:new Date().toISOString(),lastActivityAt:new Date().toISOString(),exitCode:0,signal:null,error:null,outputTail:'owned transcript',endpoint:null,hostPid:null,taskId:task.id,subtaskId:'codex'};
  writeFileSync(path,JSON.stringify(session));
  await runtime.runtimeWorkspaceTaskArchive({root:f.root,workspaceTaskId:task.id});
  const other=join(f.home,'other-project');mkdirSync(other);createProjectStore({home:f.home}).register(other,true);
  writeFileSync(path,JSON.stringify({...session,cwd:other}));
  await assert.rejects(runtime.runtimeWorkspaceArchivesClear({root:f.root}),/another task/);
  assert.ok(existsSync(path));assert.ok(existsSync(join(f.root,'.agent-bus/workspace-tasks',task.id+'.json')));
  writeFileSync(path,JSON.stringify(session));
  assert.equal((await runtime.runtimeWorkspaceArchivesClear({root:f.root})).deletedSessions,1);
 }finally{rmSync(f.home,{recursive:true,force:true});}
});
