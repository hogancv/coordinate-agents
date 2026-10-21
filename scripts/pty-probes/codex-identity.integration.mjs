// Explicit native transport acceptance. Uses the installed real Codex TUI and
// isolated CODEX_HOME with a loopback Responses stub, never a live model account.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeWorkspace } from '../../skills/coordinate-agents/scripts/workspace-init.mjs';
import { readConfig, writeConfig } from '../../skills/coordinate-agents/scripts/config.mjs';
import { listRecords } from '../../skills/coordinate-agents/scripts/session-manager.mjs';
import { getExecutionSessionManager } from '../../skills/coordinate-agents/scripts/session-service.mjs';
import * as runtime from '../../skills/coordinate-agents/scripts/workspace-task-runtime.mjs';
import { readCodexConversation } from '../../skills/coordinate-agents/scripts/codex-conversation.mjs';

test('real Codex TUI automatically binds and reopens its original conversation without a model account', { timeout: 90000 }, async t => {
  const command = process.env.COORDINATE_AGENTS_NATIVE_CODEX || 'codex';
  const version = execFileSync(command, ['--version'], { encoding: 'utf8' }).trim();
  assert.match(version, /^codex-cli 0\.163\.\d+$/, 'native acceptance currently pins the audited 0.163 wire format');
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'native-codex-identity-'))), home = join(root, 'home');
  mkdirSync(home); execFileSync('git', ['init', '-q', root]); initializeWorkspace(root);
  const oldHome = process.env.CODEX_HOME; process.env.CODEX_HOME = home;
  let providerRequests = 0;
  const provider = createServer((request, response) => {
    providerRequests++;
    request.resume();
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const item = { id: 'msg_native_fixture', type: 'message', role: 'assistant', phase: 'final_answer', status: 'completed',
      content: [{ type: 'output_text', text: 'Native fixture ready.', annotations: [] }] };
    const events = [{ type: 'response.created', response: { id: 'resp_native_fixture', status: 'in_progress', output: [] } },
      { type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: 'Native fixture ready.' },
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: 'resp_native_fixture', status: 'completed', output: [item],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }];
    response.end(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
  });
  await new Promise(done => provider.listen(0, '127.0.0.1', done));
  t.after(async () => {
    for (const s of listRecords(root)) try { await getExecutionSessionManager().close(root, s.id, { graceful: false, timeoutMs: 500 }); } catch {}
    provider.closeAllConnections(); await new Promise(done => provider.close(done));
    if (oldHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = oldHome;
    rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
  });
  writeFileSync(join(home, 'config.toml'), `model="fixture"\nmodel_provider="native_fixture"\n[model_providers.native_fixture]\nname="Local native acceptance"\nbase_url="http://127.0.0.1:${provider.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n[projects.${JSON.stringify(root)}]\ntrust_level="trusted"\n`);
  const executor = join(root, 'executor.cjs');
  writeFileSync(executor, "if(process.argv.includes('--version'))process.exit(0);console.log('? for shortcuts');process.stdin.setRawMode?.(true);process.stdin.resume();");
  const config = readConfig(join(root, '.agent-bus'));
  Object.assign(config.agents.find(a => a.id === 'codex'), { command, args: [] });
  Object.assign(config.agents.find(a => a.id === 'antigravity'), { command: process.execPath, args: [executor] });
  writeConfig(join(root, '.agent-bus'), config);
  const created = (await runtime.runtimeWorkspaceTaskCreate({ root, language: 'en' })).workspaceTask;
  // Native rollouts are lazy until a submitted turn. Model a user's first
  // Enter explicitly; do not make production recovery retry uncertain writes.
  await getExecutionSessionManager().write(root, created.sessions.codex.sessionId, 'Native transport acceptance', { submit: false });
  await new Promise(done => setTimeout(done, 300));
  await getExecutionSessionManager().write(root, created.sessions.codex.sessionId, '\r', { submit: false });
  async function waitFor(predicate) {
    const deadline = Date.now() + 25000;
    let value;
    do {
      value = await runtime.readWorkspaceTask(root, created.id);
      if (predicate(value)) return value;
      if (value.status === 'AWAITING_INPUT') await runtime.runtimeWorkspaceTaskContinue({ root, workspaceTaskId: created.id });
      await new Promise(done => setTimeout(done, 200));
    } while (Date.now() < deadline);
    function inspect(directory) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) inspect(path);
        else if (entry.name.endsWith('.jsonl')) {
          try {
            const meta = JSON.parse(readFileSync(path, 'utf8').split('\n')[0]);
            if (meta.type !== 'session_meta') { t.diagnostic(JSON.stringify({ file: entry.name, keys: Object.keys(meta) })); continue; }
            const p = meta.payload;
            let preflight = 'ok';
            try { readCodexConversation({ root, codexHome: home, conversationId: p.id,
              provenance: { version: '0.163.0', originator: p.originator?.replace(/[^a-zA-Z0-9_.-]/g, '_') } }); }
            catch (error) { preflight = error.message; }
            t.diagnostic(JSON.stringify({ source: p.source, originator: p.originator, cli_version: p.cli_version, preflight }));
          } catch {}
        }
      }
    }
    inspect(home);
    let cursor = null, screen = '';
    for (let page = 0; page < 16; page++) {
      const output = await getExecutionSessionManager().read(root, value.sessions.codex.sessionId, { cursor, maxLines: 200, maxBytes: 32768 });
      screen = (screen + output.output).slice(-8000); cursor = output.nextCursor;
      if (!output.hasMore) break;
    }
    t.diagnostic(JSON.stringify({ providerRequests, screen: runtime.normalizeWorkspaceTerminalOutput(screen).slice(-2500) }));
    assert.fail(`Native acceptance timed out: ${JSON.stringify({ status: value.status, startup: value.startup, identity: value.sessions.codex.nativeIdentity })}`);
  }
  let task = await waitFor(value => Boolean(value.sessions.codex.nativeIdentity.binding));
  const original = task.sessions.codex.nativeIdentity.binding.conversationId;
  assert.equal(task.sessions.codex.nativeIdentity.binding.source.id, 'codex-otel');
  assert.equal(task.sessions.codex.nativeIdentity.verification.state, 'UNAVAILABLE');
  const previousGeneration = task.sessions.codex.runtimeGeneration;
  await runtime.runtimeWorkspaceTaskClose({ root, workspaceTaskId: task.id });
  task = (await runtime.runtimeWorkspaceTaskResume({ root, workspaceTaskId: task.id })).workspaceTask;
  task = await waitFor(value => value.sessions.codex.nativeIdentity.lastObservation?.runtimeGeneration === value.sessions.codex.runtimeGeneration);
  assert.equal(task.resume.conversationId, original);
  assert.notEqual(task.sessions.codex.runtimeGeneration, previousGeneration);
  assert.equal(task.resume.state, 'AWAITING_CONFIRMATION');
  assert.deepEqual(task.collaborationEvents, created.collaborationEvents);
  await runtime.runtimeWorkspaceTaskConfirmConversation({ root, workspaceTaskId: task.id, conversationId: original,
    confirmed: true, sessionId: task.sessions.codex.sessionId, runtimeGeneration: task.sessions.codex.runtimeGeneration });
  async function enter(text) {
    await getExecutionSessionManager().write(root, task.sessions.codex.sessionId, '\x15' + text, { submit: false });
    await new Promise(done => setTimeout(done, 300));
    await getExecutionSessionManager().write(root, task.sessions.codex.sessionId, '\r', { submit: false });
  }
  await enter('/new'); await new Promise(done => setTimeout(done, 1500));
  // 0.163 TUI asks where /new should run. Select its default current worktree;
  // the next text entry must be sent to the new composer, not to that picker.
  await getExecutionSessionManager().write(root, task.sessions.codex.sessionId, '\r', { submit: false });
  await new Promise(done => setTimeout(done, 1500));
  await enter('Native switch acceptance');
  task = await waitFor(value => Boolean(value.sessions.codex.nativeIdentity.firstConflict));
  assert.equal(task.sessions.codex.nativeIdentity.binding.conversationId, original);
  assert.equal(task.sessions.codex.nativeIdentity.verification.state, 'UNAVAILABLE');
  assert.equal(task.resume.state, 'AWAITING_CONFIRMATION');
  t.diagnostic(`${version}; ${process.platform}/${process.arch}; native OTLP + primary JSONL + exact resume + observed /new conflict passed; model-memory and continuous live identity are not asserted.`);
});
