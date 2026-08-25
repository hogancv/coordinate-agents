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

function emit() {
  if (emitted) return;
  emitted = true;
  process.stdout.write(`COORDINATE_MINIMAL_EXTERNAL_ADAPTER:${JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    stdin,
  })}\n`);
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  stdin += chunk;
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
