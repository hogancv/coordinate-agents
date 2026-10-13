// Local interactive CLI only: never calls a model or reads account credentials.
import { appendFileSync } from 'node:fs';
import { emitKeypressEvents } from 'node:readline';

function runFixture() {
const factsPath = process.argv[2];
const label = process.argv[3] || 'probe';
if (process.argv.includes('--version')) { console.log('native-pty-fixture 1.0.0'); process.exit(0); }
function fact(type, values = {}) {
  const value = { type, label, ...values };
  if (factsPath) appendFileSync(factsPath, `${JSON.stringify(value)}\n`);
  process.stdout.write(`\r\nFACT:${JSON.stringify(value)}\r\n`);
}
fact('ready', { pid: process.pid, stdinTTY: Boolean(process.stdin.isTTY), stdoutTTY: Boolean(process.stdout.isTTY), cols: process.stdout.columns, rows: process.stdout.rows });
if (label === 'codex') process.stdout.write('Ask Codex to do anything\r\n');
if (label === 'antigravity') process.stdout.write('? for shortcuts\r\n');
process.stdout.on('resize', () => fact('resize', { cols: process.stdout.columns, rows: process.stdout.rows }));
process.stdin.setEncoding('utf8');
emitKeypressEvents(process.stdin);
if (process.stdin.isTTY && !process.argv.includes('--cooked')) process.stdin.setRawMode(true);
let line = '';
process.stdin.on('keypress', (text, key = {}) => {
  if (key.ctrl && key.name === 'c') { fact('ctrl-c'); return; }
  if (['up', 'down', 'left', 'right', 'backspace'].includes(key.name)) {
    fact('key', { name: key.name });
    if (key.name === 'backspace') line = [...line].slice(0, -1).join('');
    return;
  }
  if (key.name === 'return' || key.name === 'enter') {
    const value = line; line = '';
    fact('line', { value });
    // Windows does not deliver Unix SIGWINCH. Query the child console handle,
    // not the parent runtime's cached dimensions, before reporting its size.
    if (value === ':size') { process.stdout._refreshSize?.(); fact('size', { cols: process.stdout.columns, rows: process.stdout.rows }); }
    if (value === ':ansi') { process.stdout.write('\x1b[2J\x1b[H\x1b[31mRED-中文\x1b[0m\r\nREPAINT\r\n'); fact('ansi'); }
    if (value === ':long') { process.stdout.write('LONG-'.repeat(20_000)); fact('long-done'); }
    if (value === ':exit' || value === ':fail') {
      process.stdout.write('FINAL-OUTPUT-中文\r\n', () => process.exit(value === ':fail' ? 7 : 0));
    }
    return;
  }
  if (text && !key.ctrl && !key.meta) line += text;
});
process.stdin.resume();
}

// Node --test also discovers support .mjs files. Discovery must stay inert.
if (process.argv.includes('--native-pty-fixture')) runFixture();
