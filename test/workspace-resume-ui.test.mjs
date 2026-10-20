import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import{readFileSync}from'node:fs';
const source=readFileSync(new URL('../inspector/web-workspace/app.js',import.meta.url),'utf8');
function ui(){
 const elements=Object.fromEntries(['conversation-resume','conversation-id','conversation-manual-check','conversation-resume-button','conversation-confirm-button','conversation-resume-status'].map(x=>['#'+x,{dataset:{},value:'',checked:false}]));
 const state={projectId:'p1',projectEpoch:0,selectedId:'workspace-one',actionBusy:false,selectedTask:{id:'workspace-one',mode:'default',status:'CLOSED',sessions:{codex:{sessionId:'old',runtimeGeneration:'old-generation',state:'exited'}}}};
 const start=source.indexOf('function renderConversationResume(');assert.notEqual(start,-1,'Task must expose native Resume UI');
 const context=vm.createContext({state,document:{querySelector:key=>elements[key]},t:key=>key,isActiveTerminalSession:s=>s?.state==='running',setBusy:()=>{},showToast:()=>{},localeCode:()=> 'en',refresh:async()=>{},renderTaskList:()=>{},renderSelectedTask:()=>{}});
 vm.runInContext(source.slice(start,source.indexOf('function renderSelectedTask(',start)),context);
 return {elements,state,context};
}
test('closed Tasks offer explicit resume; archived/custom Tasks hide the entry and pending state is labeled manual',()=>{
 const {elements:e,state,context:c}=ui();c.renderConversationResume();assert.equal(e['#conversation-resume'].hidden,false);assert.equal(e['#conversation-resume-button'].disabled,true);
 e['#conversation-id'].value='019a0000-0000-7000-8000-000000000001';c.renderConversationResume();assert.equal(e['#conversation-resume-button'].disabled,false);
 state.selectedTask.status='RUNNING';state.selectedTask.sessions.codex.state='running';state.selectedTask.resume={state:'AWAITING_CONFIRMATION',conversationId:e['#conversation-id'].value};c.renderConversationResume();
 assert.match(e['#conversation-resume-status'].textContent,/AWAITING_CONFIRMATION/);assert.equal(e['#conversation-confirm-button'].disabled,true);
 e['#conversation-manual-check'].checked=true;c.renderConversationResume();assert.equal(e['#conversation-confirm-button'].disabled,false);
 state.selectedTask.archivedAt='now';c.renderConversationResume();assert.equal(e['#conversation-resume'].hidden,true);
 delete state.selectedTask.archivedAt;state.selectedTask.mode='custom';c.renderConversationResume();assert.equal(e['#conversation-resume'].hidden,true);
});
test('manual proof captures current Task generation and ignores completion after project switch',async()=>{
 const {elements:e,state,context:c}=ui();state.selectedTask.status='RUNNING';state.selectedTask.sessions.codex.state='running';c.renderConversationResume();e['#conversation-id'].value='019a0000-0000-7000-8000-000000000001';e['#conversation-manual-check'].checked=true;
 let finish,seen;const pending=new Promise(done=>finish=done);c.postAction=async(action,params,projectId)=>{seen={action,params,projectId};return pending};let refreshes=0;c.refresh=async()=>refreshes++;
 const operation=c.conversationTaskAction('confirm');assert.equal(seen.action,'workspaceTaskConfirmConversation');assert.equal(seen.params.runtimeGeneration,'old-generation');assert.equal(seen.projectId,'p1');
 state.projectId='p2';state.projectEpoch++;finish({ok:true});await operation;assert.equal(refreshes,0);
});
