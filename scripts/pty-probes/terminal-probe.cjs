// Offline CLI with actual TTY input, window-size queries and screen redraws.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const reportPath = process.argv[2];
const report = {
  pid: process.pid, tty: [process.stdin.isTTY === true, process.stdout.isTTY === true, process.stderr.isTTY === true],
  cols: process.stdout.columns, rows: process.stdout.rows, lines: [], keys: [], interrupts: 0,
};
const persist = () => fs.writeFileSync(reportPath, JSON.stringify(report));
if (!report.tty.every(Boolean)) { persist(); process.exit(21); }
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
const marker = process.argv[3] === 'codex' ? 'Ask Codex to do anything' : '? for shortcuts';
const redraw = () => process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[32m终端测试 UTF-8\x1b[0m\r\nPROBE_READY\r\n' + marker + '\r\n');
redraw();
persist();
// Windows may not emit Node's resize event; query the real console as well.
const sizeTimer = setInterval(() => {
  const size = process.stdout.getWindowSize();
  if (size[0] !== report.cols || size[1] !== report.rows) {
    [report.cols, report.rows] = size; persist(); redraw();
  }
}, 50);
let line = '', pending = '';
process.stdin.on('data', chunk => {
  pending += chunk;
  while (pending.length) {
    if (pending.startsWith('\x1b')) {
      const escape = pending.match(/^\x1b\[(?:[ABCD]|\d+;\d+R)/);
      if (!escape) { if (pending.length < 16) break; pending = pending.slice(1); continue; }
      if (/^\x1b\[[ABCD]$/.test(escape[0])) report.keys.push(escape[0]);
      pending = pending.slice(escape[0].length); continue;
    }
    const char = Array.from(pending)[0]; pending = pending.slice(char.length);
    if (char === '\x03') { report.interrupts++; continue; }
    if (char === '\x7f' || char === '\b') { line = Array.from(line).slice(0, -1).join(''); report.keys.push('backspace'); continue; }
    if (char === '\r' || char === '\n') {
      if (line === '/exit' || line === '/crash') {
        persist(); clearInterval(sizeTimer);
        process.stdout.write('\x1b[?1049lFINAL_OUTPUT\r\n', () => process.exit(line === '/crash' ? 9 : 0)); return;
      }
      if (line === '/spawn') {
        const child = spawn(process.execPath, ['-e', 'process.on("SIGINT",()=>{});setInterval(()=>{},1000)'], { stdio: 'inherit' });
        report.descendantPid = child.pid;
      }
      report.lines.push({ text: line.length < 100 ? line : null, bytes: Buffer.byteLength(line), sha256: crypto.createHash('sha256').update(line).digest('hex') });
      process.stdout.write('INPUT_OK\r\n'); line = ''; continue;
    }
    line += char;
  }
  persist();
});
process.on('SIGINT', () => { report.interrupts++; persist(); });
