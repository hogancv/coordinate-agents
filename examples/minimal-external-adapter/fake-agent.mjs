import { spawnSync } from 'node:child_process';

const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'persistent';

if (process.argv.includes('--version')) {
  console.log('minimal-external-agent 1.0.0');
  process.exit(0);
}

process.stdout.write('minimal-external-agent-ready\n');

let emitted = false;
let stdin = '';
const completedTasks = new Set();

function emit() {
  if (emitted) return;
  emitted = true;
  process.stdout.write('COORDINATE_MINIMAL_EXTERNAL_ADAPTER:' + JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    stdin,
  }) + '\n');
}

function completeTaskFromPrompt() {
  const busTool = process.env.COORDINATE_MINIMAL_EXTERNAL_ADAPTER_BUS_TOOL;
  const root = process.env.COORDINATE_MINIMAL_EXTERNAL_ADAPTER_ROOT;
  const from = process.env.COORDINATE_MINIMAL_EXTERNAL_ADAPTER_FROM;
  const to = process.env.COORDINATE_MINIMAL_EXTERNAL_ADAPTER_TO;
  if (!busTool || !root || !from || !to) return;

  const taskMatches = stdin.matchAll(/Task ID:\s*(task-[A-Za-z0-9_-]+)[\s\S]*?Round:\s*(\d+)/g);
  for (const match of taskMatches) {
    const [, taskId, round] = match;
    const key = taskId + ':' + round;
    if (completedTasks.has(key)) continue;
    completedTasks.add(key);
    const body = 'Task ID: ' + taskId
      + '\nRound: ' + round
      + '\nimplementationCommit: minimalexternal1234'
      + '\nMinimal external offline fixture completed.';
    const result = spawnSync(process.execPath, [
      busTool,
      'send',
      '--root', root,
      '--from', from,
      '--to', to,
      '--type', 'IMPLEMENTATION_DONE',
      '--subject', 'Minimal external fixture completed ' + taskId,
      '--dedupe-key', 'task:' + taskId + ':round:' + round + ':implementation',
      '--related-commit', 'minimalexternal1234',
      '--body', body,
    ], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.stdout || 'minimal external fixture could not send completion\n');
    }
  }
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  stdin += chunk;
  completeTaskFromPrompt();
  emit();
});
process.stdin.on('end', () => {
  emit();
  process.exit(0);
});

if (mode === 'one-shot') {
  setTimeout(() => {
    emit();
    process.exit(0);
  }, 50);
}
