// Fault injection at the same isolated-process resource boundary as Session Host.
import { PtyRuntime } from '../../skills/coordinate-agents/scripts/pty-runtime.mjs';
const runtime = new PtyRuntime({ id: 'error-host', backendMode: 'native', command: process.execPath,
  args: ['-e', "console.log('READY');setInterval(()=>{},1000)"], cwd: process.cwd() });
let pid;
const timer = setTimeout(() => { void runtime.close({ graceful: false, timeoutMs: 500 }).finally(() => process.exit(1)); }, 6000);
try {
  runtime.open(); pid = runtime.pid;
  process.send?.({ type: 'started', pid });
  const deadline = Date.now() + 3000;
  while (!runtime.read().output.includes('READY') && Date.now() < deadline) await new Promise(done => setTimeout(done, 25));
  if (!runtime.read().output.includes('READY')) throw new Error('Readiness timeout');
  runtime.pty.emit('error', Object.assign(new Error('private-secret-value'), { code: process.argv[2] || 'EPIPE' }));
  const snapshot = await runtime.exitPromise;
  process.send?.({ type: 'result', snapshot }, () => {
    clearTimeout(timer); process.disconnect?.();
    // Unlike the raw binding probe, this fixture exercises the product's
    // dedicated Host boundary. Parent confirms both Host and child exit.
    setTimeout(() => process.exit(0), 25);
  });
} catch {
  clearTimeout(timer); await runtime.close({ graceful: false, timeoutMs: 500 }); process.exit(1);
}
