// Disposable UI acceptance workbench, never uses the user's CLI/config/accounts.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startWorkspace } from '../../inspector/server/workspace-server.mjs';
import { initializeWorkspace } from '../../skills/coordinate-agents/scripts/workspace-init.mjs';
import { readConfig, writeConfig } from '../../skills/coordinate-agents/scripts/config.mjs';
import { listRecords, getExecutionSessionManager } from '../../skills/coordinate-agents/scripts/session-manager.mjs';

async function runWorkbench() {
const directory = mkdtempSync(join(tmpdir(), 'coordinate-native-web-'));
const home = join(directory, 'isolated-home'); mkdirSync(home);
process.env.COORDINATE_AGENTS_HOME = home;
const fixture = fileURLToPath(new URL('./native-pty-fixture.mjs', import.meta.url));
const roots = ['项目 A', '项目 B'].map(name => {
  const root = join(directory, name); mkdirSync(root);
  const git = spawnSync('git', ['init', '-q', root], { windowsHide: true });
  if (git.status !== 0) throw new Error('test git init failed');
  initializeWorkspace(root);
  const bus = join(root, '.agent-bus'); const config = readConfig(bus);
  config.agents = config.agents.map(agent => ({ ...agent, command: process.execPath, args: [fixture, join(root, `${agent.id}.jsonl`), agent.id, '--native-pty-fixture'] }));
  writeConfig(bus, config); return root;
});
const started = await startWorkspace({ root: roots[0], port: 0, projectHome: home });
console.log(JSON.stringify({ url: started.url, directory, roots, node: process.version }));
// A file-only stop signal remains local to this exact test-owned directory.
const watcher = setInterval(async () => {
  if (!existsSync(join(directory, 'STOP'))) return;
  clearInterval(watcher);
  const manager = getExecutionSessionManager();
  for (const root of roots) for (const record of listRecords(root)) await manager.close(root, record.id, { graceful: false, timeoutMs: 1500 });
  started.server.closeAllConnections?.();
  await new Promise(resolve => started.server.close(resolve));
  rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  console.log('NATIVE-WEB-CLEANUP: directory removed');
}, 250);
}
if (process.argv.includes('--native-web-fixture')) await runWorkbench();
