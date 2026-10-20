import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexCliAdapter } from '../skills/coordinate-agents/adapters/codex-cli.mjs';
const conversations = await import('../skills/coordinate-agents/scripts/codex-conversation.mjs').catch(error => { if (error.code === 'ERR_MODULE_NOT_FOUND') return {}; throw error; });
const id = '019a0000-0000-7000-8000-000000000001';

test('exact native metadata preflight rejects missing, foreign, non-CLI and mismatched UUID targets', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codex-target-')));
  const codexHome = join(root, 'home');
  const directory = join(codexHome, 'sessions', '2026', '10', '20');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `rollout-2026-10-20T00-00-00-${id}.jsonl`);
  const write = payload => writeFileSync(file, `${JSON.stringify({ type: 'session_meta', payload: { id, cwd: root, source: 'cli', ...payload } })}\n`);
  try {
    assert.equal(typeof conversations.readCodexConversation, 'function');
    assert.throws(() => conversations.readCodexConversation({ root, codexHome, conversationId: id }), /not found/i);
    write({});
    assert.equal(conversations.readCodexConversation({ root, codexHome, conversationId: id }).conversationId, id);
    write({ cwd: tmpdir() });
    assert.throws(() => conversations.readCodexConversation({ root, codexHome, conversationId: id }), /project/i);
    write({ source: { subagent: {} } });
    assert.throws(() => conversations.readCodexConversation({ root, codexHome, conversationId: id }), /CLI/i);
    write({ id: '019a0000-0000-7000-8000-000000000002' });
    assert.throws(() => conversations.readCodexConversation({ root, codexHome, conversationId: id }), /identity/i);
    for (const conversationId of ['--last', '../elsewhere', '00000000-0000-0000-0000-000000000000']) {
      assert.throws(() => conversations.readCodexConversation({ root, codexHome, conversationId }), /UUID/i);
    }
    rmSync(file); symlinkSync(join(root, 'missing'), file);
    assert.throws(() => conversations.readCodexConversation({ root, codexHome, conversationId: id }), /unsafe|not found/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('native resume preserves configured options and appends only exact UUID without a prompt', () => {
  const adapter = new CodexCliAdapter({ command: process.execPath, args: ['--model', 'user-model', '-c', 'model_reasoning_effort="high"'] });
  const launch = adapter.resolveSessionLaunch({ root: process.cwd(), workspace: true, conversationId: id });
  assert.deepEqual(launch.args.slice(-2), ['resume', id]);
  assert.ok(launch.args.includes('user-model'));
  assert.ok(launch.args.includes('--no-alt-screen'));
  assert.throws(() => adapter.resolveSessionLaunch({ root: process.cwd(), conversationId: id, initialPrompt: 'must not replay' }), /prompt/i);
  for (const args of [['--last'], ['resume'], ['exec'], ['{prompt}'], ['hello'], ['--remote', 'ws://localhost']]) {
    assert.throws(() => new CodexCliAdapter({ command: process.execPath, args }).resolveSessionLaunch({ root: process.cwd(), conversationId: id }), /resume|argument|target/i);
  }
});

test('native metadata compares canonical project paths when JS realpath retains a Windows alias',async t=>{
 const fs=(await import('node:fs')).default;const {syncBuiltinESMExports}=await import('node:module');
 const native=fs.realpathSync.native,ordinary=fs.realpathSync;
 const root=native(mkdtempSync(join(tmpdir(),'codex-native-path-'))),cwd=join(root,'project');mkdirSync(cwd);
 const alias=cwd+'/.';const home=join(root,'home'),directory=join(home,'sessions');mkdirSync(directory,{recursive:true});
 writeFileSync(join(directory,`rollout-test-${id}.jsonl`),JSON.stringify({type:'session_meta',payload:{id,cwd:alias,source:'cli'}})+'\n');
 const preserving=value=>value===alias?alias:ordinary(value);preserving.native=native;t.mock.method(fs,'realpathSync',preserving);syncBuiltinESMExports();
 try{assert.equal(conversations.readCodexConversation({root:cwd,codexHome:home,conversationId:id}).projectRoot,native(cwd));}
 finally{t.mock.restoreAll();syncBuiltinESMExports();rmSync(root,{recursive:true,force:true});}
});
