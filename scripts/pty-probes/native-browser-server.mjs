// Temporary offline Workspace for actual xterm/browser QA. No user config edits.
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, copyFileSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWorkspace } from '../../inspector/server/workspace-server.mjs';
import { ExecutionSessionManager, listRecords } from '../../skills/coordinate-agents/scripts/session-manager.mjs';
const directory = realpathSync.native(mkdtempSync(join(tmpdir(), 'coordinate-native-browser-')));
const root = join(directory, 'project'); mkdirSync(root);
const home = join(directory, 'home'); mkdirSync(join(home, '.coordinate-agents'), { recursive: true });
process.env.COORDINATE_AGENTS_HOME = home;
process.env.COORDINATE_AGENTS_PTY_MODE = 'native';
const executable = join(directory, process.platform === 'win32' ? 'offline node.exe' : 'offline node');
if (process.platform === 'win32') copyFileSync(process.execPath, executable);
else linkSync(process.execPath, executable);
writeFileSync(join(home, '.coordinate-agents/config.json'), JSON.stringify({ version: 1, adapters: [], agents: Object.fromEntries(['codex', 'antigravity'].map(agent => [agent,
  { command: executable, args: [fileURLToPath(new URL('./terminal-probe.cjs', import.meta.url)), join(directory, `${agent}.json`), agent] },
])) }));
const started = await startWorkspace({ root, port: 0, projectHome: join(directory, 'projects') });
console.log(JSON.stringify({ url: started.url, directory }));
let closing = false;
async function close() {
  if (closing) return; closing = true;
  try {
    const manager = new ExecutionSessionManager();
    for (const record of listRecords(root)) await manager.close(root, record.id, { graceful: false, timeoutMs: 1000 });
    started.server.close(); started.server.closeAllConnections?.();
    rmSync(directory, { recursive: true, force: true });
  } catch { process.exitCode = 1; }
}
process.on('SIGTERM', close); process.on('SIGINT', close);
