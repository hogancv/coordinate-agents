import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const help = `Coordinate Agents ${version} — local Web Workspace

Usage: coordinate-agents web [--root <directory>] [--port <0-65535>] [--json]
       coordinate-agents --help
       coordinate-agents --version

Starts a localhost Codex + Antigravity terminal pair. Configure CLI commands
and Codex model/reasoning in the Workspace settings. Node.js >=18 and Git
are required; install and sign in to your agent CLIs separately.

npm 3.x distributes Web Workspace. Structured Plugin/CLI/MCP remains in the
GitHub repository. For the previous npm CLI use:
  npx @hogancv/coordinate-agents@2.4.0 <command>
From a source checkout use: node bin/coordinate-agents-legacy.mjs <command>
`;
export async function runCli(argv = []) {
  const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : null;
  if (command && !['web', 'help'].includes(command)) {
    console.error(`Command "${command}" is not available in npm ${version}. Use npx @hogancv/coordinate-agents@2.4.0 ${argv.join(' ')} or the repository Legacy entry: node bin/coordinate-agents-legacy.mjs.`);
    process.exitCode = 1; return;
  }
  try {
    const options = { root: process.cwd(), port: 3000, json: false, help: command === 'help' || argv.length === 0, version: false };
    const args = command ? argv.slice(1) : argv;
    for (let index = 0; index < args.length; index++) {
      const option = args[index];
      if (option === '--help' || option === '-h') options.help = true;
      else if (option === '--version') options.version = true;
      else if (option === '--json') options.json = true;
      else if (option === '--root' || option === '--port') {
        const value = args[++index];
        if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}.`);
        if (option === '--root') options.root = resolve(value);
        else {
          const port = Number(value);
          if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid port: ${value}. Expected 0–65535.`);
          options.port = port;
        }
      } else throw new Error(`Unknown option: ${option}. Use coordinate-agents --help.`);
    }
    if (options.version) { console.log(version); return; }
    if (options.help) { console.log(help); return; }
    if (command !== 'web') throw new Error('Use coordinate-agents web to start the Workspace.');
    // Delay all server/session imports until a Web command is actually requested.
    const { startWorkspace } = await import('../inspector/server/workspace-server.mjs');
    const started = await startWorkspace(options);
    const onSignal = () => { started.server.close(); started.server.closeAllConnections?.(); };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    started.server.once('close', () => { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); });
    if (options.json) console.log(JSON.stringify({ ok: true, command: 'workspace.start', kind: 'workspace', root: started.root, host: started.host, port: started.port, url: started.url }));
    else console.log(`Workspace running:\n\n${started.url}`);
  } catch (error) {
    if (argv.includes('--json')) console.log(JSON.stringify({ ok: false, command: 'workspace.start', error: { code: 'WORKSPACE_START_FAILED', message: error.message } }));
    else console.error(error.message);
    process.exitCode = 1;
  }
}
